import { createHash } from "node:crypto";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { type Db, agents, assets, companies, heartbeatRuns, issueAttachments, issues, marketingChannels, marketingProfiles, projects } from "@paperclipai/db";
import { createMarketingDraftSchema } from "@paperclipai/shared";
import type { HostServices, WorkerHostCallContext } from "@paperclipai/plugin-sdk";
import { badRequest, conflict, forbidden, HttpError } from "../errors.js";
import { getStorageService, type StorageService } from "../storage/index.js";
import { logActivity } from "./activity-log.js";
import { issueService } from "./issues.js";
import { marketingService } from "./marketing.js";
import { workspaceFileResourceService } from "./workspace-file-resources.js";
import { openRunnerApiWorkspaceFile } from "./native-runtime/runner-api-files.js";
import { logger } from "../middleware/logger.js";

const companySchema = z.object({ companyId: z.string().uuid() });
const contextSchema = companySchema.extend({ projectId: z.string().uuid().optional() }).strict();
const uploadSchema = companySchema.extend({ path: z.string().min(1).max(1000), contentType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"]) }).strict();
const submitSchema = companySchema.extend({ projectId: z.string().uuid(), ...createMarketingDraftSchema.shape }).strict();
const maxMediaBytes = 10 * 1024 * 1024;
const mediaTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm" };

export function marketingPluginService(db: Db, pluginId: string, storage?: StorageService): NonNullable<HostServices["marketing"]> {
  const marketing = marketingService(db, storage);

  async function authority(companyId: string, context: WorkerHostCallContext | undefined, mutation = false) {
    const scope = context?.invocationScope;
    const binding = scope?.agentRun;
    if (context?.invalidInvocationScope || scope?.companyId !== companyId || !binding) throw forbidden("현재 에이전트 실행에 연결된 플러그인 호출이 필요합니다.");
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, binding.runId), eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, binding.agentId), eq(heartbeatRuns.status, "running")));
    const issueId = run?.nativeIssueId ?? run?.contextSnapshot?.issueId;
    if (typeof issueId !== "string") throw forbidden("진행 중인 작업 또는 대화가 없습니다.");
    const [issue] = await db.select().from(issues).where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)));
    const [agent] = await db.select({ status: agents.status }).from(agents).where(and(eq(agents.id, binding.agentId), eq(agents.companyId, companyId)));
    const conversation = issue?.conversationAgentId === binding.agentId;
    if (!issue || !agent || ["paused", "terminated"].includes(agent.status) || issue.hiddenAt
      || (!conversation && issue.assigneeAgentId !== binding.agentId)
      || ["done", "cancelled"].includes(issue.status)
      || (conversation && Number(run.contextSnapshot?.conversationSessionGeneration ?? 0) !== issue.conversationSessionGeneration)
      || (issue.executionRunId && issue.executionRunId !== binding.runId)
      || (binding.projectId && issue.projectId && binding.projectId !== issue.projectId)) throw forbidden("현재 작업 또는 대화의 작성 권한이 없습니다.");
    if (mutation && issue.workMode !== "standard") throw forbidden("읽기 또는 계획 모드에서는 초안을 제출하거나 첨부할 수 없습니다.");
    return { binding, issue, conversation };
  }

  async function targetProject(companyId: string, selected: string | undefined, current: Awaited<ReturnType<typeof authority>>) {
    if (current.issue.projectId && selected && current.issue.projectId !== selected) throw forbidden("현재 작업의 다른 프로젝트에는 제출할 수 없습니다.");
    const projectId = current.issue.projectId ?? selected;
    if (!projectId) return null;
    if (!current.issue.projectId && !current.conversation) throw forbidden("프로젝트에 배정된 작업이 필요합니다.");
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.companyId, companyId), isNull(projects.archivedAt)));
    if (!project) throw forbidden("사용 가능한 같은 회사 프로젝트가 아닙니다.");
    return project.id;
  }

  return {
    async getContext(value, context) {
      const input = contextSchema.parse(value);
      const current = await authority(input.companyId, context);
      const projectId = await targetProject(input.companyId, input.projectId, current);
      const targets = await db.select({ projectId: projects.id, projectName: projects.name,
        profileId: marketingProfiles.id, profileName: marketingProfiles.name, channelId: marketingChannels.id,
        name: marketingChannels.name, platform: marketingChannels.platform, accountId: marketingChannels.accountId,
        concept: marketingChannels.concept, tone: marketingChannels.tone, audience: marketingChannels.audience, writingRules: marketingChannels.writingRules,
      }).from(marketingChannels).innerJoin(projects, and(eq(projects.id, marketingChannels.projectId), eq(projects.companyId, input.companyId)))
        .innerJoin(marketingProfiles, and(eq(marketingProfiles.id, marketingChannels.profileId), eq(marketingProfiles.companyId, input.companyId), eq(marketingProfiles.projectId, marketingChannels.projectId)))
        .where(and(eq(marketingChannels.companyId, input.companyId), eq(marketingChannels.enabled, true), eq(marketingProfiles.enabled, true), isNull(projects.archivedAt), projectId ? eq(projects.id, projectId) : undefined))
        .orderBy(projects.name, marketingProfiles.name, marketingChannels.name);
      return { issueId: current.issue.id, projectId, requiresProjectSelection: !projectId, targets,
        media: projectId ? await marketing.mediaChoices(input.companyId, projectId, current.conversation ? current.issue.id : undefined) : [] };
    },
    async uploadMedia(value, context) {
      const input = uploadSchema.parse(value);
      const current = await authority(input.companyId, context, true);
      const resolved = await workspaceFileResourceService(db).prepareDownload(current.issue.id, { path: input.path, workspace: "auto" });
      if (mediaTypes[path.extname(resolved.realPath).toLowerCase()] !== input.contentType) throw badRequest("파일 확장자와 이미지/영상 형식이 일치해야 합니다.");
      const file = await openRunnerApiWorkspaceFile(resolved.realPath);
      let bytes: Buffer;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || !stat.size || stat.size > maxMediaBytes) throw badRequest("비어 있지 않은 10 MiB 이하 이미지/영상 파일이 필요합니다.");
        const buffer = Buffer.alloc(maxMediaBytes + 1);
        let length = 0;
        while (length < buffer.length) {
          const read = await file.read(buffer, length, buffer.length - length, length);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (!length || length > maxMediaBytes) throw badRequest("첨부 크기 제한을 초과했습니다.");
        bytes = buffer.subarray(0, length);
      } finally { await file.close(); }
      await authority(input.companyId, context, true);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const [existing] = await db.select({ attachmentId: issueAttachments.id, title: assets.originalFilename, contentType: assets.contentType, byteSize: assets.byteSize })
        .from(issueAttachments).innerJoin(assets, eq(assets.id, issueAttachments.assetId))
        .where(and(eq(issueAttachments.companyId, input.companyId), eq(issueAttachments.issueId, current.issue.id), eq(issueAttachments.originatingRunId, current.binding.runId), eq(assets.companyId, input.companyId), eq(assets.sha256, sha256), eq(assets.contentType, input.contentType)));
      if (existing) return { ...existing, title: existing.title ?? path.basename(resolved.realPath), href: `/api/attachments/${existing.attachmentId}/content` };
      const files = storage ?? getStorageService();
      const stored = await files.putFile({ companyId: input.companyId, namespace: `issues/${current.issue.id}`, originalFilename: path.basename(resolved.realPath), contentType: input.contentType, body: bytes });
      let attachment;
      try {
        await authority(input.companyId, context, true);
        attachment = await issueService(db).createAttachment({ issueId: current.issue.id, ...stored, createdByAgentId: current.binding.agentId, createdByRunId: current.binding.runId });
      } catch (error) {
        if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
          await files.deleteObject(input.companyId, stored.objectKey).catch(err => {
            logger.warn({ err, pluginId, companyId: input.companyId }, "Failed to remove rejected Marketing upload");
          });
        }
        throw error;
      }
      await logActivity(db, { companyId: input.companyId, actorType: "agent", actorId: current.binding.agentId, agentId: current.binding.agentId, runId: current.binding.runId,
        action: "issue.attachment_added", entityType: "issue", entityId: current.issue.id, details: { attachmentId: attachment.id, contentType: stored.contentType, sourcePluginId: pluginId } });
      return { attachmentId: attachment.id, title: stored.originalFilename ?? attachment.id, contentType: stored.contentType, byteSize: stored.byteSize, href: `/api/attachments/${attachment.id}/content` };
    },
    async submitDraft(value, context) {
      const input = submitSchema.parse(value);
      const current = await authority(input.companyId, context, true);
      const projectId = await targetProject(input.companyId, input.projectId, current);
      if (!projectId) throw conflict("초안의 대상 프로젝트를 먼저 선택하십시오.");
      const [channel] = await db.select({ id: marketingChannels.id }).from(marketingChannels)
        .innerJoin(marketingProfiles, and(eq(marketingProfiles.id, marketingChannels.profileId), eq(marketingProfiles.companyId, input.companyId)))
        .where(and(eq(marketingChannels.companyId, input.companyId), eq(marketingChannels.id, input.channelId), eq(marketingChannels.projectId, projectId), eq(marketingChannels.enabled, true), eq(marketingProfiles.enabled, true)));
      if (!channel) throw forbidden("선택한 프로젝트의 사용 중인 채널이 아닙니다.");
      const draft = await marketing.createDraft(input.companyId, { channelId: input.channelId, topic: input.topic, content: input.content },
        { issueId: current.issue.id, agentId: current.binding.agentId, runId: current.binding.runId });
      await logActivity(db, { companyId: input.companyId, actorType: "agent", actorId: current.binding.agentId, agentId: current.binding.agentId, runId: current.binding.runId,
        action: "marketing.agent_draft_submitted", entityType: "marketing", entityId: draft.id, details: { issueId: current.issue.id, channelId: draft.channelId, sourcePluginId: pluginId } });
      const [company] = await db.select({ prefix: companies.issuePrefix }).from(companies).where(eq(companies.id, input.companyId));
      return { id: draft.id, projectId: draft.projectId, channelId: draft.channelId, revision: draft.revision, state: "draft",
        href: `/${company.prefix}/marketing?project=${draft.projectId}&channel=${draft.channelId}&draft=${draft.id}` };
    },
  };
}
