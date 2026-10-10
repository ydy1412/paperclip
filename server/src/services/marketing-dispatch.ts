import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { withDedicatedDbConnection, marketingPublishJobs, marketingProfiles, marketingChannels, marketingDrafts, projects, issueAttachments, assets, issues, type Db } from "@paperclipai/db";
import { marketingContentSchema } from "@paperclipai/shared";
import { conflict } from "../errors.js";
import { assertMarketingJobRetryable, marketingChannelConfiguration, marketingDigest, validateMarketingPostedUrl, type MarketingPublicationSnapshot } from "./marketing-publication.js";

export type MarketingPublicationReceipt =
  | { status: "published"; terminal: true; verifiedAccountId: string; verifiedSnapshotHash: string; postedUrl: string; evidence: Record<string, unknown> }
  | { status: "auth_required" | "failed"; terminal: true; definitelyNotPosted: true; message: string; evidence: Record<string, unknown> }
  | { status: "uncertain"; terminal: boolean; message: string; evidence: Record<string, unknown> };
export interface MarketingPublicationTransport {
  capabilities?: { platforms: string[]; media: boolean };
  publish(input: { jobId: string; snapshot: MarketingPublicationSnapshot; snapshotHash: string; onSession: (id: string) => Promise<void> }): Promise<MarketingPublicationReceipt>;
  reconcile(input: { jobId: string; snapshot: MarketingPublicationSnapshot; snapshotHash: string; sessionId: string | null }): Promise<MarketingPublicationReceipt>;
}
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Job = typeof marketingPublishJobs.$inferSelect;
const globalKey = "paperclip:marketing:aside-dispatch";
const scope = (companyId: string, jobId: string) => and(eq(marketingPublishJobs.companyId, companyId), eq(marketingPublishJobs.id, jobId));

export function marketingDispatchService(db: Db, transport: MarketingPublicationTransport) {
  async function locked<T>(operation: () => Promise<T>) {
    return withDedicatedDbConnection(db, async dedicated => {
      const rows = await dedicated.execute<{ acquired: boolean }>(sql`select pg_try_advisory_lock(hashtextextended(${globalKey}, 0)) as acquired`);
      if (!rows[0]?.acquired) throw conflict("다른 프로필 발행 작업이 실행 중입니다.");
      try { return await operation(); }
      finally { await dedicated.execute(sql`select pg_advisory_unlock(hashtextextended(${globalKey}, 0))`); }
    });
  }
  async function companyLock(tx: Transaction, companyId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`paperclip:marketing:${companyId}`}, 0))`);
  }
  function snapshot(job: Job): MarketingPublicationSnapshot {
    const value = job.snapshot as unknown as MarketingPublicationSnapshot;
    if (!value || marketingDigest(value) !== job.snapshotHash || value.companyId !== job.companyId || value.projectId !== job.projectId || value.draftId !== job.draftId || value.revision !== job.revision || value.channel?.id !== job.channelId || value.profile?.id !== job.profileId || !Array.isArray(value.media) || !marketingContentSchema.safeParse(value.content).success) {
      throw conflict("승인 스냅샷을 확인할 수 없습니다.");
    }
    return value;
  }
  async function claim(companyId: string, jobId: string) {
    return db.transaction(async tx => {
      await companyLock(tx, companyId);
      const [job] = await tx.select().from(marketingPublishJobs).where(scope(companyId, jobId)).for("update");
      if (!job || job.status !== "queued") return null;
      const approved = snapshot(job);
      const [profile] = await tx.select().from(marketingProfiles).where(and(eq(marketingProfiles.companyId, companyId), eq(marketingProfiles.id, job.profileId)));
      const [channel] = await tx.select().from(marketingChannels).where(and(eq(marketingChannels.companyId, companyId), eq(marketingChannels.id, job.channelId)));
      const [draft] = await tx.select().from(marketingDrafts).where(and(eq(marketingDrafts.companyId, companyId), eq(marketingDrafts.id, job.draftId)));
      const [project] = await tx.select({ archivedAt: projects.archivedAt }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, job.projectId)));
      if (profile?.blockedReason) return null;
      let changed = !profile?.enabled || !channel?.enabled || !project || !!project.archivedAt || !draft
        || !approved.channelConfiguration || !approved.channelConfigurationHash
        || marketingDigest(approved.channelConfiguration) !== approved.channelConfigurationHash
        || !!channel && marketingDigest(marketingChannelConfiguration(channel)) !== approved.channelConfigurationHash
        || draft.revision !== job.revision || marketingDigest(draft.content) !== marketingDigest(approved.content)
        || profile.projectId !== job.projectId || profile.asideAccountId !== approved.profile.asideAccountId || profile.browserProfileName !== approved.profile.browserProfileName
        || channel.projectId !== job.projectId || channel.profileId !== job.profileId || channel.accountId !== approved.channel.accountId || channel.accountUrl !== approved.channel.accountUrl || channel.platform !== approved.channel.platform;
      for (const media of approved.media) {
        const [current] = await tx.select({ asset: assets, projectId: issues.projectId }).from(issueAttachments)
          .innerJoin(assets, eq(assets.id, issueAttachments.assetId)).innerJoin(issues, eq(issues.id, issueAttachments.issueId))
          .where(and(eq(issueAttachments.companyId, companyId), eq(issueAttachments.id, media.attachmentId), eq(assets.companyId, companyId), eq(issues.companyId, companyId)));
        if (!current || current.projectId !== job.projectId || current.asset.id !== media.assetId || current.asset.sha256 !== media.sha256 || current.asset.byteSize !== media.byteSize || current.asset.contentType !== media.contentType) changed = true;
      }
      if (changed) {
        await tx.update(marketingPublishJobs).set({ status: "cancelled", lastError: "승인 후 내용 또는 연결이 변경되어 재승인이 필요합니다.", finishedAt: new Date(), updatedAt: new Date() }).where(scope(companyId, jobId));
        return null;
      }
      const [claimed] = await tx.update(marketingPublishJobs).set({ status: "publishing", attempts: job.attempts + 1, startedAt: new Date(), updatedAt: new Date() }).where(and(scope(companyId, jobId), eq(marketingPublishJobs.status, "queued"))).returning();
      return claimed ? { job: claimed, approved } : null;
    });
  }
  async function commit(job: Job, receipt: MarketingPublicationReceipt) {
    let result = receipt;
    if (receipt.status === "published") {
      try {
        const approved = snapshot(job);
        if (receipt.verifiedAccountId !== approved.channel.accountId || receipt.verifiedSnapshotHash !== job.snapshotHash) throw new Error("Receipt identity mismatch");
        validateMarketingPostedUrl(approved.channel, receipt.postedUrl);
      } catch {
        result = { status: "uncertain", terminal: true, message: "게시 결과의 계정·내용·주소를 확인할 수 없습니다.", evidence: { terminal: true } };
      }
    }
    await db.transaction(async tx => {
      await companyLock(tx, job.companyId);
      const evidence = { ...result.evidence, terminal: result.terminal, definitelyNotPosted: result.status === "failed" || result.status === "auth_required" };
      const updated = await tx.update(marketingPublishJobs).set({ status: result.status, postedUrl: result.status === "published" ? result.postedUrl : null, lastError: result.status === "published" ? null : result.message, evidence, finishedAt: result.terminal ? new Date() : null, updatedAt: new Date() })
        .where(and(scope(job.companyId, job.id), inArray(marketingPublishJobs.status, ["publishing", "uncertain"]))).returning();
      if (!updated.length) throw conflict("발행 작업의 상태가 변경됐습니다.");
      if (result.status === "auth_required") {
        const approved = snapshot(job);
        if (approved.channel.platform === "naver_blog") {
          await tx.update(marketingProfiles).set({ blockedReason: result.message, updatedAt: new Date() })
            .where(and(eq(marketingProfiles.companyId, job.companyId), eq(marketingProfiles.asideAccountId, approved.profile.asideAccountId)));
        }
      }
    });
    return result;
  }
  return {
    dispatch: (companyId: string, projectId?: string, jobIds?: string[]) => locked(async () => {
      if (jobIds && !jobIds.length) throw conflict("발행 요청할 작업을 선택하십시오.");
      const active = await db.select({ id: marketingPublishJobs.id }).from(marketingPublishJobs).where(inArray(marketingPublishJobs.status, ["publishing", "uncertain"])).limit(1);
      if (active.length) throw conflict("이전 발행의 실행 또는 게시 여부를 먼저 확인해야 합니다.");
      const waiting = await db.select().from(marketingPublishJobs).where(and(eq(marketingPublishJobs.companyId, companyId), eq(marketingPublishJobs.status, "queued"), projectId ? eq(marketingPublishJobs.projectId, projectId) : undefined, jobIds ? inArray(marketingPublishJobs.id, jobIds) : undefined)).orderBy(asc(marketingPublishJobs.position), asc(marketingPublishJobs.createdAt), asc(marketingPublishJobs.id));
      const profiles = [...new Set(waiting.map(job => job.profileId))];
      const results: { jobId: string; status: string }[] = [];
      for (const profileId of profiles) {
        for (const next of waiting.filter(job => job.profileId === profileId)) {
          const claimed = await claim(companyId, next.id);
          if (!claimed) continue;
          let receipt: MarketingPublicationReceipt;
          try {
            receipt = await transport.publish({ jobId: next.id, snapshot: claimed.approved, snapshotHash: next.snapshotHash, onSession: async id => {
              const persisted = await db.update(marketingPublishJobs).set({ externalSessionId: id, updatedAt: new Date() })
                .where(and(scope(companyId, next.id), eq(marketingPublishJobs.status, "publishing"), or(isNull(marketingPublishJobs.externalSessionId), eq(marketingPublishJobs.externalSessionId, id))))
                .returning({ id: marketingPublishJobs.id });
              if (!persisted.length) throw conflict("발행 작업에 Aside 세션을 저장하지 못했습니다. 실행을 중단하십시오.");
            } });
          } catch {
            receipt = { status: "uncertain", terminal: false, message: "외부 실행의 상태를 확인할 수 없습니다. 게시 여부 확인이 필요합니다.", evidence: {} };
          }
          const committed = await commit(claimed.job, receipt);
          results.push({ jobId: next.id, status: committed.status });
          if (committed.status === "uncertain") return results;
          if (committed.status === "auth_required") break;
        }
      }
      return results;
    }),
    reconcile: (companyId: string, jobId: string) => locked(async () => {
      const [job] = await db.select().from(marketingPublishJobs).where(scope(companyId, jobId));
      if (!job || !["publishing", "uncertain"].includes(job.status)) throw conflict("게시 여부 확인 대상이 아닙니다.");
      const approved = snapshot(job);
      const receipt = await transport.reconcile({ jobId, snapshot: approved, snapshotHash: job.snapshotHash, sessionId: job.externalSessionId });
      return commit(job, receipt);
    }),
    retry: (companyId: string, jobId: string) => db.transaction(async tx => {
      await companyLock(tx, companyId);
      const [job] = await tx.select().from(marketingPublishJobs).where(scope(companyId, jobId)).for("update");
      if (!job) throw conflict("발행 작업이 없습니다.");
      assertMarketingJobRetryable(job.status, job.evidence?.definitelyNotPosted === true && job.evidence?.terminal === true);
      await tx.update(marketingPublishJobs).set({ status: "queued", lastError: null, externalSessionId: null, startedAt: null, finishedAt: null, updatedAt: new Date() }).where(scope(companyId, jobId));
      return { id: jobId, status: "queued" };
    }),
  };
}
