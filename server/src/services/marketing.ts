import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  type Db, projects, marketingProfiles, marketingChannels, marketingDrafts,
  marketingPublishJobs, issueAttachments, assets, issues, agents, issueDocuments, documents, activityLog, heartbeatRuns,
} from "@paperclipai/db";
import type {
  CreateMarketingProfile, UpdateMarketingProfile, CreateMarketingChannel,
  UpdateMarketingChannel, CreateMarketingDraft, UpdateMarketingDraft, QueueMarketingDrafts,
  GenerateMarketingDrafts,
} from "@paperclipai/shared";
import { conflict, notFound, badRequest } from "../errors.js";
import { marketingGenerationResultSchema } from "@paperclipai/shared";
import { getStorageService, type StorageService } from "../storage/index.js";
import { assertMarketingDraftEditable, marketingChannelConfiguration, marketingDigest, marketingGenerationPrompt, validateMarketingAccount, verifyMarketingMediaBytes, type MarketingPublicationSnapshot } from "./marketing-publication.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
const mutableJobs = ["queued", "auth_required", "failed"] as const;

export function marketingService(db: Db, storage?: StorageService) {
  async function lock(tx: Transaction, companyId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`paperclip:marketing:${companyId}`}, 0))`);
  }
  async function project(tx: Transaction, companyId: string, projectId: string) {
    const [row] = await tx.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)));
    if (!row || row.archivedAt) throw notFound("사용 가능한 프로젝트가 없습니다.");
    return row;
  }
  async function profile(tx: Transaction, companyId: string, id: string) {
    const [row] = await tx.select().from(marketingProfiles).where(and(eq(marketingProfiles.companyId, companyId), eq(marketingProfiles.id, id)));
    if (!row) throw notFound("프로필이 없습니다.");
    await project(tx, companyId, row.projectId);
    return row;
  }
  async function channel(tx: Transaction, companyId: string, id: string) {
    const [row] = await tx.select().from(marketingChannels).where(and(eq(marketingChannels.companyId, companyId), eq(marketingChannels.id, id)));
    if (!row) throw notFound("채널이 없습니다.");
    const binding = await profile(tx, companyId, row.profileId);
    if (binding.projectId !== row.projectId) throw conflict("채널과 프로필의 프로젝트가 일치하지 않습니다.");
    return { row, binding };
  }
  async function jobsForDraft(tx: Transaction, companyId: string, draftId: string) {
    return tx.select().from(marketingPublishJobs).where(and(eq(marketingPublishJobs.companyId, companyId), eq(marketingPublishJobs.draftId, draftId)));
  }
  async function resolvedMedia(tx: Transaction, companyId: string, projectId: string, content: CreateMarketingDraft["content"], verifyBytes = false, sourceIssueId?: string | null) {
    const resolved: MarketingPublicationSnapshot["media"] = [];
    for (const item of content.media) {
      const [row] = await tx.select({ attachment: issueAttachments, asset: assets, issue: issues })
        .from(issueAttachments).innerJoin(assets, eq(assets.id, issueAttachments.assetId))
        .innerJoin(issues, eq(issues.id, issueAttachments.issueId))
        .where(and(eq(issueAttachments.id, item.attachmentId), eq(issueAttachments.companyId, companyId), eq(assets.companyId, companyId), eq(issues.companyId, companyId)));
      const sourceConversation = row && row.issue.id === sourceIssueId && row.issue.conversationAgentId;
      if (!row || (row.issue.projectId !== projectId && !sourceConversation)) throw notFound("이 프로젝트의 첨부 자료가 아닙니다.");
      if (!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/.test(row.asset.contentType)) throw badRequest("이미지 또는 영상 자료만 사용할 수 있습니다.");
      if (row.asset.byteSize <= 0 || row.asset.byteSize > 500 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(row.asset.sha256)) throw badRequest("첨부 자료의 크기 또는 체크섬이 유효하지 않습니다.");
      if (verifyBytes) {
        const files = storage ?? getStorageService();
        if (row.asset.provider !== files.provider) throw conflict("첨부 자료 저장소가 현재 설정과 다릅니다.");
        const object = await files.getObject(companyId, row.asset.objectKey);
        await verifyMarketingMediaBytes(object.stream, row.asset);
      }
      resolved.push({ attachmentId: item.attachmentId, assetId: row.asset.id, contentType: row.asset.contentType, sha256: row.asset.sha256, byteSize: row.asset.byteSize, alt: item.alt });
    }
    return resolved;
  }
  async function cancelPending(tx: Transaction, companyId: string, scope: ReturnType<typeof eq>) {
    await tx.update(marketingPublishJobs).set({ status: "cancelled", lastError: "내용 또는 채널 연결이 변경되어 재승인이 필요합니다.", finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(marketingPublishJobs.companyId, companyId), scope, inArray(marketingPublishJobs.status, [...mutableJobs])));
  }
  async function assertBindingEditable(tx: Transaction, companyId: string, scope: ReturnType<typeof eq>) {
    const active = await tx.select({ status: marketingPublishJobs.status }).from(marketingPublishJobs)
      .where(and(eq(marketingPublishJobs.companyId, companyId), scope, inArray(marketingPublishJobs.status, ["publishing", "uncertain"])));
    assertMarketingDraftEditable(active.map(row => row.status));
  }
  async function assignedIssue(tx: Transaction, companyId: string, issueId: string, agentId: string) {
    const [issue] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).for("update");
    if (!issue || !issue.projectId || issue.assigneeAgentId !== agentId || !["todo", "in_progress", "in_review"].includes(issue.status)) throw notFound("이 에이전트에게 배정된 진행 중인 프로젝트 작업이 아닙니다.");
    await project(tx, companyId, issue.projectId);
    return issue;
  }

  return {
    draftToolContext: (companyId: string, issueId: string, agentId: string) => db.transaction(async tx => {
      const issue = await assignedIssue(tx, companyId, issueId, agentId);
      const rows = await tx.select().from(marketingChannels).where(and(eq(marketingChannels.companyId, companyId), eq(marketingChannels.projectId, issue.projectId!), eq(marketingChannels.enabled, true)));
      return { issueId, projectId: issue.projectId!, channels: rows.map(row => ({ id: row.id, name: row.name, platform: row.platform, accountId: row.accountId, concept: row.concept, tone: row.tone, audience: row.audience, writingRules: row.writingRules })) };
    }),
    resumeProfile: (companyId: string, id: string, channelId: string, accountId: string, checked: { asideAccountId: string; browserProfileName: string }) => db.transaction(async tx => {
      await lock(tx, companyId);
      const { row, binding } = await channel(tx, companyId, channelId);
      if (binding.id !== id || row.accountId !== accountId || binding.asideAccountId !== checked.asideAccountId || binding.browserProfileName !== checked.browserProfileName) throw conflict("계정 확인 후 연결이 변경됐습니다. 다시 확인하십시오.");
      await assertBindingEditable(tx, companyId, eq(marketingPublishJobs.profileId, id));
      const [resumed] = await tx.update(marketingProfiles).set({ blockedReason: null, updatedAt: new Date() }).where(and(eq(marketingProfiles.companyId, companyId), eq(marketingProfiles.id, id))).returning();
      return resumed;
    }),
    generationInstructions: (companyId: string, input: GenerateMarketingDrafts) => db.transaction(async tx => {
      const [agent] = await tx.select({ id: agents.id, status: agents.status }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, input.agentId)));
      if (!agent || ["terminated", "paused"].includes(agent.status)) throw badRequest("사용 가능한 작성 에이전트를 선택하십시오.");
      const selected = [];
      for (const id of input.channelIds) {
        const { row } = await channel(tx, companyId, id);
        if (!row.enabled) throw conflict("사용 중인 채널만 초안을 제작할 수 있습니다.");
        selected.push(row);
      }
      const projectId = selected[0].projectId;
      if (selected.some(row => row.projectId !== projectId)) throw badRequest("같은 프로젝트의 채널을 선택하십시오.");
      return {
        projectId, assigneeAgentId: agent.id,
        title: `마케팅 초안: ${input.topic}`.slice(0, 200),
        description: [
          "Create channel-specific drafts only. No publication is authorized.",
          ...selected.map(row => `Channel ID: ${row.id}\n${marketingGenerationPrompt({ topic: input.topic, channel: row })}`),
          "Store the completed result as a native issue document with key marketing-drafts.",
          "The document body must be exactly one JSON object, no Markdown fences or surrounding explanation:",
          JSON.stringify({ topic: input.topic, drafts: selected.map(row => ({ channelId: row.id, content: { title: "", body: "", media: [] } })) }),
          "Fill each content object with the independently written draft. Use only this project's native attachment IDs. Mark the task done after saving the document. Do not enqueue or publish.",
        ].join("\n\n"),
      };
    }),
    importGeneratedDrafts: (companyId: string, issueId: string) => db.transaction(async tx => {
      await lock(tx, companyId);
      const [issue] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)));
      if (!issue || !issue.projectId) throw notFound("이 회사의 프로젝트 작업이 아닙니다.");
      if (issue.status !== "done") throw conflict("초안 제작 작업이 완료된 뒤 가져오십시오.");
      await project(tx, companyId, issue.projectId);
      const [document] = await tx.select({ body: documents.latestBody }).from(issueDocuments)
        .innerJoin(documents, eq(documents.id, issueDocuments.documentId))
        .where(and(eq(issueDocuments.companyId, companyId), eq(documents.companyId, companyId), eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, "marketing-drafts")));
      if (!document) throw notFound("marketing-drafts 결과 문서가 없습니다.");
      if (Buffer.byteLength(document.body, "utf8") > 5 * 1024 * 1024) throw badRequest("초안 결과 문서가 너무 큽니다.");
      let source: unknown;
      try { source = JSON.parse(document.body); } catch { throw badRequest("초안 결과 문서는 JSON 형식이어야 합니다."); }
      const parsed = marketingGenerationResultSchema.safeParse(source);
      if (!parsed.success) throw badRequest("초안 결과의 채널 또는 본문 형식이 잘못됐습니다.");
      const result: (typeof marketingDrafts.$inferSelect)[] = [];
      for (const generated of parsed.data.drafts) {
        const { row } = await channel(tx, companyId, generated.channelId);
        if (row.projectId !== issue.projectId) throw badRequest("다른 프로젝트 채널의 초안은 가져올 수 없습니다.");
        await resolvedMedia(tx, companyId, row.projectId, generated.content);
        const [existing] = await tx.select().from(marketingDrafts).where(and(eq(marketingDrafts.companyId, companyId), eq(marketingDrafts.channelId, row.id), eq(marketingDrafts.generationIssueId, issueId)));
        if (existing) { result.push(existing); continue; }
        const [draft] = await tx.insert(marketingDrafts).values({ companyId, projectId: row.projectId, channelId: row.id, generationIssueId: issueId, topic: parsed.data.topic, content: generated.content, contentHash: marketingDigest(generated.content) }).returning();
        result.push(draft);
      }
      return result;
    }),
    mediaChoices: async (companyId: string, projectId: string, sourceIssueId?: string) => {
      const drafts = await db.select({ content: marketingDrafts.content }).from(marketingDrafts)
        .where(and(eq(marketingDrafts.companyId, companyId), eq(marketingDrafts.projectId, projectId)));
      const selectedAttachments = drafts.flatMap(draft => draft.content.media.map(media => media.attachmentId));
      const rows = await db.select({ attachmentId: issueAttachments.id, title: assets.originalFilename, contentType: assets.contentType, byteSize: assets.byteSize })
        .from(issueAttachments).innerJoin(assets, eq(assets.id, issueAttachments.assetId)).innerJoin(issues, eq(issues.id, issueAttachments.issueId))
        .where(and(eq(issueAttachments.companyId, companyId), eq(assets.companyId, companyId), eq(issues.companyId, companyId),
          or(eq(issues.projectId, projectId), selectedAttachments.length ? inArray(issueAttachments.id, selectedAttachments) : undefined, sourceIssueId ? eq(issues.id, sourceIssueId) : undefined)))
        .orderBy(desc(issueAttachments.createdAt)).limit(100);
      return rows.filter(row => /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/.test(row.contentType))
        .map(row => ({ ...row, title: row.title || row.attachmentId, href: `/api/attachments/${row.attachmentId}/content` }));
    },
    overview: async (companyId: string) => {
      const drafts = await db.select().from(marketingDrafts).where(eq(marketingDrafts.companyId, companyId)).orderBy(desc(marketingDrafts.updatedAt)).limit(200);
      const authors = drafts.length ? await db.selectDistinctOn([activityLog.entityId], {
        draftId: activityLog.entityId, actorType: activityLog.actorType,
        agentId: activityLog.agentId, name: agents.name,
      }).from(activityLog).leftJoin(agents, and(eq(agents.id, activityLog.agentId), eq(agents.companyId, companyId)))
        .where(and(eq(activityLog.companyId, companyId), eq(activityLog.entityType, "marketing"),
          inArray(activityLog.entityId, drafts.map(draft => draft.id)),
          inArray(activityLog.action, ["marketing.agent_draft_submitted", "marketing.draft_created"])))
        .orderBy(activityLog.entityId, asc(activityLog.createdAt), activityLog.id) : [];
      const authorByDraft = new Map(authors.map(author => [author.draftId,
        author.actorType === "agent" && author.agentId ? { agentId: author.agentId, name: author.name || "알 수 없는 에이전트" }
          : author.actorType === "user" ? { agentId: null, name: "운영자" } : null]));
      return {
        profiles: await db.select().from(marketingProfiles).where(eq(marketingProfiles.companyId, companyId)).orderBy(marketingProfiles.name),
        channels: await db.select().from(marketingChannels).where(eq(marketingChannels.companyId, companyId)).orderBy(marketingChannels.name),
        drafts: drafts.map(draft => ({ ...draft, author: authorByDraft.get(draft.id) ?? null })),
        jobs: await db.select().from(marketingPublishJobs).where(eq(marketingPublishJobs.companyId, companyId)).orderBy(desc(marketingPublishJobs.createdAt)).limit(200),
      };
    },
    createProfile: (companyId: string, input: CreateMarketingProfile) => db.transaction(async tx => {
      await lock(tx, companyId); await project(tx, companyId, input.projectId);
      const [duplicate] = await tx.select({ id: marketingProfiles.id }).from(marketingProfiles).where(and(eq(marketingProfiles.companyId, companyId), eq(marketingProfiles.projectId, input.projectId), eq(marketingProfiles.asideAccountId, input.asideAccountId)));
      if (duplicate) throw conflict("이 프로젝트에 이미 연결된 Aside 프로필입니다.");
      const [row] = await tx.insert(marketingProfiles).values({ ...input, companyId }).returning();
      return row;
    }),
    updateProfile: (companyId: string, id: string, input: UpdateMarketingProfile) => db.transaction(async tx => {
      await lock(tx, companyId); const previous = await profile(tx, companyId, id);
      if (input.asideAccountId) {
        const [duplicate] = await tx.select({ id: marketingProfiles.id }).from(marketingProfiles).where(and(eq(marketingProfiles.companyId, companyId), eq(marketingProfiles.projectId, previous.projectId), eq(marketingProfiles.asideAccountId, input.asideAccountId), ne(marketingProfiles.id, id)));
        if (duplicate) throw conflict("이 프로젝트에 이미 연결된 Aside 프로필입니다.");
      }
      await assertBindingEditable(tx, companyId, eq(marketingPublishJobs.profileId, id));
      const [row] = await tx.update(marketingProfiles).set({ ...input, updatedAt: new Date() }).where(and(eq(marketingProfiles.companyId, companyId), eq(marketingProfiles.id, id))).returning();
      if (row.asideAccountId !== previous.asideAccountId || row.browserProfileName !== previous.browserProfileName || row.enabled !== previous.enabled) {
        await tx.update(marketingChannels).set({ connectionStatus: "unknown", connectionCheckedAt: null })
          .where(and(eq(marketingChannels.companyId, companyId), eq(marketingChannels.profileId, id)));
      }
      await cancelPending(tx, companyId, eq(marketingPublishJobs.profileId, id));
      return row;
    }),
    createChannel: (companyId: string, input: CreateMarketingChannel) => db.transaction(async tx => {
      await lock(tx, companyId); await project(tx, companyId, input.projectId);
      const binding = await profile(tx, companyId, input.profileId);
      if (binding.projectId !== input.projectId) throw conflict("같은 프로젝트의 프로필을 선택하십시오.");
      const accountUrl = validateMarketingAccount(input);
      const [duplicate] = await tx.select({ id: marketingChannels.id }).from(marketingChannels).where(and(eq(marketingChannels.companyId, companyId), eq(marketingChannels.projectId, input.projectId), eq(marketingChannels.platform, input.platform), eq(marketingChannels.accountId, input.accountId)));
      if (duplicate) throw conflict("이 프로젝트에 이미 등록된 채널 계정입니다.");
      const [row] = await tx.insert(marketingChannels).values({ ...input, accountUrl, companyId }).returning();
      return row;
    }),
    updateChannel: (companyId: string, id: string, input: UpdateMarketingChannel) => db.transaction(async tx => {
      await lock(tx, companyId); const { row: previous } = await channel(tx, companyId, id);
      await assertBindingEditable(tx, companyId, eq(marketingPublishJobs.channelId, id));
      const next = { ...previous, ...input };
      const binding = await profile(tx, companyId, next.profileId);
      if (binding.projectId !== next.projectId) throw conflict("같은 프로젝트의 프로필을 선택하십시오.");
      const accountUrl = validateMarketingAccount(next);
      const [duplicate] = await tx.select({ id: marketingChannels.id }).from(marketingChannels).where(and(eq(marketingChannels.companyId, companyId), eq(marketingChannels.projectId, next.projectId), eq(marketingChannels.platform, next.platform), eq(marketingChannels.accountId, next.accountId), ne(marketingChannels.id, id)));
      if (duplicate) throw conflict("이 프로젝트에 이미 등록된 채널 계정입니다.");
      const bindingChanged = next.profileId !== previous.profileId || next.platform !== previous.platform
        || next.accountId !== previous.accountId || accountUrl !== previous.accountUrl || next.enabled !== previous.enabled;
      const [row] = await tx.update(marketingChannels).set({ ...input, accountUrl, updatedAt: new Date(),
        ...(bindingChanged ? { connectionStatus: "unknown" as const, connectionCheckedAt: null } : {}),
      }).where(and(eq(marketingChannels.companyId, companyId), eq(marketingChannels.id, id))).returning();
      await cancelPending(tx, companyId, eq(marketingPublishJobs.channelId, id));
      return row;
    }),
    createDraft: (companyId: string, input: CreateMarketingDraft, assignment?: { issueId: string; agentId: string; runId?: string }) => db.transaction(async tx => {
      await lock(tx, companyId); const { row } = await channel(tx, companyId, input.channelId);
      if (assignment) {
        const [run] = assignment.runId ? await tx.select().from(heartbeatRuns).where(and(
          eq(heartbeatRuns.id, assignment.runId), eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, assignment.agentId), eq(heartbeatRuns.status, "running"),
        )).for("update") : [];
        if (assignment.runId && (!run || (run.nativeIssueId ?? run.contextSnapshot?.issueId) !== assignment.issueId)) throw conflict("현재 실행에 속한 작업이 아닙니다.");
        const [conversation] = run ? await tx.select().from(issues).where(and(eq(issues.id, assignment.issueId), eq(issues.companyId, companyId), eq(issues.conversationAgentId, assignment.agentId))).for("update") : [];
        const issue = conversation ?? await assignedIssue(tx, companyId, assignment.issueId, assignment.agentId);
        if (run) {
          const [writer] = await tx.select({ status: agents.status }).from(agents).where(and(eq(agents.id, assignment.agentId), eq(agents.companyId, companyId))).for("update");
          if (!writer || ["paused", "terminated"].includes(writer.status)
            || (conversation && Number(run.contextSnapshot?.conversationSessionGeneration ?? 0) !== conversation.conversationSessionGeneration)) throw conflict("현재 에이전트 또는 대화 실행이 변경되었습니다.");
        }
        if (run && (issue.workMode !== "standard" || issue.hiddenAt || ["done", "cancelled"].includes(issue.status) || (issue.executionRunId && issue.executionRunId !== run.id))) throw conflict("현재 작업은 초안 제출을 허용하지 않습니다.");
        if ((!conversation && issue.projectId !== row.projectId) || (conversation?.projectId && conversation.projectId !== row.projectId) || !row.enabled) throw conflict("작업 프로젝트의 사용 중인 채널만 작성할 수 있습니다.");
        const [existing] = await tx.select().from(marketingDrafts).where(and(eq(marketingDrafts.companyId, companyId), eq(marketingDrafts.channelId, row.id),
          assignment.runId ? eq(marketingDrafts.generationRunId, assignment.runId) : eq(marketingDrafts.generationIssueId, issue.id)));
        if (existing) {
          if (existing.topic !== input.topic || existing.contentHash !== marketingDigest(input.content)) throw conflict("이미 제출된 초안입니다. 기존 초안은 검토 화면에서 수정하십시오.");
          return existing;
        }
      }
      await resolvedMedia(tx, companyId, row.projectId, input.content, false, assignment?.runId ? assignment.issueId : undefined);
      const [draft] = await tx.insert(marketingDrafts).values({ ...input, companyId, projectId: row.projectId, generationIssueId: assignment?.issueId ?? null, generationRunId: assignment?.runId ?? null, contentHash: marketingDigest(input.content) }).returning();
      return draft;
    }),
    updateDraft: (companyId: string, id: string, input: UpdateMarketingDraft) => db.transaction(async tx => {
      await lock(tx, companyId);
      const [previous] = await tx.select().from(marketingDrafts).where(and(eq(marketingDrafts.companyId, companyId), eq(marketingDrafts.id, id))).for("update");
      if (!previous) throw notFound("초안이 없습니다.");
      if (previous.revision !== input.revision) throw conflict("다른 화면에서 수정된 초안입니다. 다시 불러오십시오.");
      await channel(tx, companyId, previous.channelId);
      assertMarketingDraftEditable((await jobsForDraft(tx, companyId, id)).map(row => row.status));
      await resolvedMedia(tx, companyId, previous.projectId, input.content, false, previous.generationIssueId);
      const [row] = await tx.update(marketingDrafts).set({ topic: input.topic, content: input.content, contentHash: marketingDigest(input.content), revision: previous.revision + 1, updatedAt: new Date() })
        .where(and(eq(marketingDrafts.companyId, companyId), eq(marketingDrafts.id, id))).returning();
      await cancelPending(tx, companyId, eq(marketingPublishJobs.draftId, id));
      return row;
    }),
    queueDrafts: (companyId: string, input: QueueMarketingDrafts, approvedBy: string, capabilities?: { platforms: string[]; media: boolean }) => db.transaction(async tx => {
      await lock(tx, companyId);
      const [last] = await tx.select({ position: sql<number>`coalesce(max(${marketingPublishJobs.position}), 0)` }).from(marketingPublishJobs).where(eq(marketingPublishJobs.companyId, companyId));
      let position = Number(last.position);
      const queued: (typeof marketingPublishJobs.$inferSelect)[] = [];
      for (const selected of input.drafts) {
        const [draft] = await tx.select().from(marketingDrafts).where(and(eq(marketingDrafts.companyId, companyId), eq(marketingDrafts.id, selected.id))).for("update");
        if (!draft) throw notFound("초안이 없습니다.");
        if (draft.revision !== selected.revision || marketingDigest(draft.content) !== draft.contentHash) throw conflict("변경된 초안을 다시 확인하십시오.");
        const jobs = await jobsForDraft(tx, companyId, draft.id);
        const same = jobs.find(job => job.revision === draft.revision);
        if (same) {
          if (["queued", "publishing", "published", "uncertain"].includes(same.status)) { queued.push(same); continue; }
          throw conflict("이 버전의 발행 작업이 이미 있습니다. 재시도하거나 새 버전을 저장하십시오.");
        }
        assertMarketingDraftEditable(jobs.map(job => job.status));
        const { row, binding } = await channel(tx, companyId, draft.channelId);
        if (capabilities && !capabilities.platforms.includes(row.platform)) throw conflict("이 채널의 발행 연결은 아직 지원되지 않습니다.");
        if (capabilities && !capabilities.media && draft.content.media.length) throw conflict("이미지·영상 발행은 아직 지원되지 않습니다. 첨부를 제거하거나 발행 연결을 확장하십시오.");
        if (!row.enabled || !binding.enabled || binding.blockedReason) throw conflict("비활성화되었거나 로그인이 필요한 채널 프로필입니다.");
        validateMarketingAccount(row);
        const media = await resolvedMedia(tx, companyId, draft.projectId, draft.content, true, draft.generationIssueId);
        const channelConfiguration = marketingChannelConfiguration(row);
        const snapshot: MarketingPublicationSnapshot = {
          companyId, projectId: draft.projectId, draftId: draft.id, revision: draft.revision,
          content: draft.content, media,
          channel: { id: row.id, name: row.name, platform: row.platform, accountId: row.accountId, accountUrl: row.accountUrl },
          profile: { id: binding.id, asideAccountId: binding.asideAccountId, browserProfileName: binding.browserProfileName },
          channelConfiguration, channelConfigurationHash: marketingDigest(channelConfiguration),
        };
        const [job] = await tx.insert(marketingPublishJobs).values({ companyId, projectId: draft.projectId, profileId: binding.id, channelId: row.id, draftId: draft.id, revision: draft.revision, snapshot: { ...snapshot }, snapshotHash: marketingDigest(snapshot), approvedBy, position: ++position }).returning();
        queued.push(job);
      }
      return queued;
    }),
    cancelJob: (companyId: string, id: string) => db.transaction(async tx => {
      await lock(tx, companyId);
      const [previous] = await tx.select().from(marketingPublishJobs).where(and(eq(marketingPublishJobs.companyId, companyId), eq(marketingPublishJobs.id, id))).for("update");
      if (!previous) throw notFound("발행 작업이 없습니다.");
      if (![...mutableJobs, "cancelled"].includes(previous.status as typeof mutableJobs[number])) throw conflict("이미 시작됐거나 게시 여부를 확인 중인 작업은 취소로 숨길 수 없습니다.");
      const [row] = await tx.update(marketingPublishJobs).set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() }).where(and(eq(marketingPublishJobs.companyId, companyId), eq(marketingPublishJobs.id, id))).returning();
      return row;
    }),
  };
}
