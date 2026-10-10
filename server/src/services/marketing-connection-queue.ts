import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, or, isNull, sql, desc, notInArray } from "drizzle-orm";
import { marketingConnectionChecks as checks, marketingConnectionMonitors as monitors, marketingChannels as channels, marketingProfiles as profiles, projects, type Db } from "@paperclipai/db";
import { conflict, notFound } from "../errors.js";

export type ConnectionCheckRow = typeof checks.$inferSelect;
export const terminalChecks = ["completed", "needs_attention", "cancelled"] as const;
const active = notInArray(checks.status, [...terminalChecks]);
const queueLock = sql`select pg_advisory_xact_lock(hashtextextended('marketing:connection:admission', 0))`;
export const monitorIntervalMs = 10 * 60 * 1000;

export function marketingConnectionQueue(db: Db) {
  async function project(companyId: string, projectId: string) {
    const [row] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)));
    if (!row || row.archivedAt) throw notFound("활성 프로젝트를 찾을 수 없습니다.");
    return row;
  }
  async function enqueue(companyId: string, projectId: string, channelIds?: string[], source: "manual" | "automatic" = "manual", now = new Date()) {
    await project(companyId, projectId);
    return db.transaction(async tx => {
      await tx.execute(queueLock);
      if (source === "automatic") {
        const [monitor] = await tx.select().from(monitors).where(and(eq(monitors.companyId, companyId), eq(monitors.projectId, projectId)));
        if (!monitor?.enabled) return [];
      }
      const bindings = await tx.select({ channel: channels, profile: profiles }).from(channels)
        .innerJoin(profiles, and(eq(profiles.id, channels.profileId), eq(profiles.companyId, channels.companyId), eq(profiles.projectId, channels.projectId)))
        .where(and(eq(channels.companyId, companyId), eq(channels.projectId, projectId), ...(channelIds ? [inArray(channels.id, channelIds)] : [])));
      if (channelIds && bindings.length !== new Set(channelIds).size) throw notFound("이 프로젝트의 채널을 찾을 수 없습니다.");
      if (bindings.length > 100) throw conflict("한 번에 100개 이하 채널을 확인하십시오.");
      const rows: ConnectionCheckRow[] = [];
      for (const { channel, profile } of bindings) {
        if (!channel.enabled || !profile.enabled) {
          if (channelIds) throw conflict("비활성 채널 또는 프로필입니다.");
          continue;
        }
        const [existing] = await tx.select().from(checks).where(and(eq(checks.channelId, channel.id), active));
        if (existing) { rows.push(existing); continue; }
        const id = randomUUID();
        const [created] = await tx.insert(checks).values({ id, threadId: id, companyId, projectId, channelId: channel.id, source,
          target: { platform: channel.platform, accountId: channel.accountId, accountUrl: channel.accountUrl, profileId: profile.id, asideAccountId: profile.asideAccountId, browserProfileName: profile.browserProfileName },
          nextPollAt: now, createdAt: now, updatedAt: now }).returning();
        rows.push(created);
      }
      return rows;
    });
  }
  async function overview(companyId: string, projectId: string) {
    await project(companyId, projectId);
    const jobs = await db.selectDistinctOn([checks.channelId]).from(checks)
      .where(and(eq(checks.companyId, companyId), eq(checks.projectId, projectId)))
      .orderBy(checks.channelId, desc(active), desc(checks.createdAt), desc(checks.updatedAt), desc(checks.id));
    const [monitor] = await db.select().from(monitors).where(and(eq(monitors.companyId, companyId), eq(monitors.projectId, projectId)));
    const connections = await db.select({ channelId: channels.id, status: channels.connectionStatus, checkedAt: channels.connectionCheckedAt }).from(channels).where(and(eq(channels.companyId, companyId), eq(channels.projectId, projectId)));
    return { jobs: jobs.map(({ id, companyId, projectId, channelId, threadId, asideSessionId, source, status, appliedStatus, rawDecision, reason, createdAt, updatedAt, resultReceivedAt, finishedAt }) => ({ id, companyId, projectId, channelId, threadId, asideSessionId, source, status, appliedStatus, rawDecision, reason, createdAt, updatedAt, resultReceivedAt, finishedAt })),
      monitor: monitor ? { companyId, projectId, enabled: monitor.enabled, nextCheckAt: monitor.nextCheckAt } : { companyId, projectId, enabled: false, nextCheckAt: null }, connections };
  }
  async function setMonitor(companyId: string, projectId: string, enabled: boolean, now = new Date()) {
    await project(companyId, projectId);
    return db.transaction(async tx => {
      await tx.execute(queueLock);
      const [row] = await tx.insert(monitors).values({ companyId, projectId, enabled, nextCheckAt: enabled ? new Date(now.getTime() + monitorIntervalMs) : null, updatedAt: now })
        .onConflictDoUpdate({ target: monitors.projectId, set: { enabled, nextCheckAt: enabled ? new Date(now.getTime() + monitorIntervalMs) : null, updatedAt: now } }).returning();
      if (!enabled) await tx.update(checks).set({ status: "cancelled", finishedAt: now, updatedAt: now })
        .where(and(eq(checks.companyId, companyId), eq(checks.projectId, projectId), eq(checks.source, "automatic"), inArray(checks.status, ["queued", "preparing"]), isNull(checks.preparationIntentAt)));
      return row;
    });
  }
  async function schedule(now = new Date()) {
    // Reserve a due interval atomically; admission rechecks OFF under the same lock.
    const due = await db.transaction(async tx => {
      await tx.execute(queueLock);
      return tx.update(monitors).set({ nextCheckAt: new Date(now.getTime() + monitorIntervalMs), updatedAt: now })
        .where(and(eq(monitors.enabled, true), lte(monitors.nextCheckAt, now))).returning();
    });
    for (const row of due) {
      try { await enqueue(row.companyId, row.projectId, undefined, "automatic", now); }
      catch { /* Archived projects cannot admit work; other intervals remain independent. */ }
    }
    return due.length;
  }
  async function claim(owner: string, now = new Date()) {
    return db.transaction(async tx => {
      await tx.execute(queueLock);
      const running = await tx.select({ id: checks.id }).from(checks).where(and(active, sql`${checks.status} <> 'queued'`));
      const due = await tx.select().from(checks).where(and(active, lte(checks.nextPollAt, now), or(isNull(checks.leaseUntil), lte(checks.leaseUntil, now)))).orderBy(checks.createdAt).limit(100);
      let slots = Math.max(0, 3 - running.length);
      const claimed: ConnectionCheckRow[] = [];
      for (const row of due) {
        if (claimed.length >= 3) break;
        if (row.status === "queued" && slots-- <= 0) continue;
        const [updated] = await tx.update(checks).set({ leaseOwner: owner, leaseUntil: new Date(now.getTime() + 60000), status: row.status === "queued" ? "preparing" : row.status, updatedAt: now }).where(eq(checks.id, row.id)).returning();
        claimed.push(updated);
      }
      return claimed;
    });
  }
  async function patch(id: string, owner: string, values: Partial<typeof checks.$inferInsert>) {
    const [row] = await db.update(checks).set({ ...values, updatedAt: new Date() }).where(and(eq(checks.id, id), eq(checks.leaseOwner, owner), sql`${checks.leaseUntil} > now()`, active)).returning();
    if (!row) throw conflict("연결 확인 실행 소유권이 변경되었습니다.");
    return row;
  }
  async function get(id: string, owner: string) {
    const [row] = await db.select().from(checks).where(and(eq(checks.id, id), eq(checks.leaseOwner, owner), sql`${checks.leaseUntil} > now()`, active));
    if (!row) throw conflict("연결 확인 실행 소유권이 변경되었습니다.");
    return row;
  }
  async function finish(id: string, owner: string, rawDecision: ConnectionCheckRow["rawDecision"], appliedStatus: "connected" | "auth_required" | "unknown", reason: string | null) {
    return db.transaction(async tx => {
      const [job] = await tx.select().from(checks).where(and(eq(checks.id, id), eq(checks.leaseOwner, owner), sql`${checks.leaseUntil} > now()`, active)).for("update");
      if (!job) throw conflict("오래된 연결 확인 결과입니다.");
      // Lock target bindings so an edit cannot interleave with the result application.
      const [binding] = await tx.select({ channel: channels, profile: profiles, project: projects }).from(channels)
        .innerJoin(profiles, eq(profiles.id, channels.profileId)).innerJoin(projects, eq(projects.id, channels.projectId))
        .where(and(eq(channels.id, job.channelId), eq(channels.companyId, job.companyId), eq(channels.projectId, job.projectId))).for("update");
      const t = job.target;
      const valid = binding && !binding.project.archivedAt && binding.channel.enabled && binding.profile.enabled
        && binding.profile.companyId === job.companyId && binding.profile.projectId === job.projectId
        && binding.channel.profileId === t.profileId && binding.channel.platform === t.platform && binding.channel.accountId === t.accountId && binding.channel.accountUrl === t.accountUrl
        && binding.profile.asideAccountId === t.asideAccountId && binding.profile.browserProfileName === t.browserProfileName;
      if (!valid) { appliedStatus = "unknown"; reason = "대상 계정 또는 프로필이 변경되었습니다. 기존 연결 상태를 유지합니다."; }
      const now = new Date();
      if (valid && appliedStatus !== "unknown") await tx.update(channels).set({ connectionStatus: appliedStatus, connectionCheckedAt: now }).where(eq(channels.id, job.channelId));
      const [row] = await tx.update(checks).set({ status: appliedStatus === "unknown" ? "needs_attention" : "completed", rawDecision, appliedStatus, reason, finishedAt: now, updatedAt: now, leaseOwner: null, leaseUntil: null }).where(eq(checks.id, id)).returning();
      return row;
    });
  }
  async function release(id: string, owner: string) {
    await db.update(checks).set({ leaseOwner: null, leaseUntil: null }).where(and(eq(checks.id, id), eq(checks.leaseOwner, owner)));
  }
  return { enqueue, overview, setMonitor, schedule, claim, patch, get, finish, release };
}
