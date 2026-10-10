import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { companies, projects, marketingChannels, marketingPublishJobs, createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { marketingService } from "../services/marketing.js";
import { marketingDispatchService, type MarketingPublicationTransport } from "../services/marketing-dispatch.js";
import { marketingDigest } from "../services/marketing-publication.js";

describe("marketing dispatch native ownership and recovery", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("paperclip-marketing-dispatch-"); db = createDb(database.connectionString); }, 90000);
  afterAll(async () => { await database?.cleanup(); });
  afterEach(async () => { await db.delete(marketingPublishJobs); });
  async function fixture() {
    const id = randomUUID(); await db.insert(companies).values({ id, name: "Dispatch acceptance", issuePrefix: `D${id.slice(0, 6).toUpperCase()}`, defaultResponsibleUserId: "operator" });
    const [project] = await db.insert(projects).values({ companyId: id, name: "Marketing" }).returning();
    const service = marketingService(db);
    const first = await service.createProfile(id, { projectId: project.id, name: "First", asideAccountId: "u1", browserProfileName: "Profile 1" });
    const second = await service.createProfile(id, { projectId: project.id, name: "Second", asideAccountId: "u0", browserProfileName: "Profile 0" });
    const channels = [];
    for (const [profile, accountId] of [[first, "first_blog"], [second, "second_blog"]] as const) channels.push(await service.createChannel(id, { projectId: project.id, profileId: profile.id, platform: "naver_blog", name: accountId, accountId, accountUrl: `https://blog.naver.com/${accountId}`, concept: "Developers", tone: "Plain", audience: "Engineers", writingRules: "Sources" }));
    const drafts = [];
    for (const channel of [channels[0], channels[0], channels[1]]) drafts.push(await service.createDraft(id, { channelId: channel.id, topic: "Deployments", content: { title: "Deploy", body: "Fixture content", media: [] } }));
    const jobs = await service.queueDrafts(id, { drafts: drafts.map(draft => ({ id: draft.id, revision: 1 })) }, "operator");
    return { id, first, second, channels, drafts, jobs, service };
  }
  const success: MarketingPublicationTransport["publish"] = async input => ({ status: "published", terminal: true, verifiedAccountId: input.snapshot.channel.accountId, verifiedSnapshotHash: input.snapshotHash, postedUrl: `${input.snapshot.channel.accountUrl}/223456789012`, evidence: { fixture: true } });
  it("runs profiles sequentially with at most one browser execution", async () => {
    const f = await fixture(); let running = 0, max = 0; const order: string[] = [];
    const publish = vi.fn<MarketingPublicationTransport["publish"]>(async input => { running++; max = Math.max(max, running); order.push(input.snapshot.profile.asideAccountId); await new Promise(resolve => setTimeout(resolve, 5)); running--; return success(input); });
    const dispatcher = marketingDispatchService(db, { publish, reconcile: vi.fn() });
    const result = await dispatcher.dispatch(f.id);
    expect(result).toHaveLength(3); expect(order).toEqual(["u1", "u1", "u0"]); expect(max).toBe(1);
    expect((await f.service.overview(f.id)).jobs.every(job => job.status === "published" && job.attempts === 1)).toBe(true);
    expect(await dispatcher.dispatch(f.id)).toEqual([]);
  });
  it("requests only selected jobs without draining another approved queue", async () => {
    const f = await fixture(); const publish = vi.fn(success);
    const dispatcher = marketingDispatchService(db, { publish, reconcile: vi.fn() });
    const result = await dispatcher.dispatch(f.id, f.jobs[0].projectId, [f.jobs[1].id]);
    expect(result).toEqual([{ jobId: f.jobs[1].id, status: "published" }]);
    expect(publish).toHaveBeenCalledTimes(1);
    const state = await f.service.overview(f.id);
    expect(state.jobs.filter(job => job.status === "queued")).toHaveLength(2);
    await expect(dispatcher.dispatch(f.id, f.jobs[0].projectId, [])).rejects.toThrow();
  });
  it("stops a logged-out binding but continues another profile", async () => {
    const f = await fixture();
    const publish = vi.fn<MarketingPublicationTransport["publish"]>(async input => input.snapshot.profile.asideAccountId === "u1" ? { status: "auth_required", terminal: true, definitelyNotPosted: true, message: "Login expired", evidence: {} } : success(input));
    const dispatcher = marketingDispatchService(db, { publish, reconcile: vi.fn() });
    const result = await dispatcher.dispatch(f.id);
    expect(result.map(row => row.status)).toEqual(["auth_required", "published"]);
    expect(publish).toHaveBeenCalledTimes(2);
    const state = await f.service.overview(f.id);
    expect(state.profiles.find(profile => profile.id === f.first.id)?.blockedReason).toBe("Login expired");
    expect(state.profiles.find(profile => profile.id === f.second.id)?.blockedReason).toBeNull();
    expect(state.jobs.find(job => job.id === f.jobs[1].id)?.status).toBe("queued");
  });
  it("blocks blind replay after a lost stream until read-only reconciliation", async () => {
    const f = await fixture();
    const publish = vi.fn<MarketingPublicationTransport["publish"]>(async input => { await input.onSession("native-session-id"); throw new Error("Observation timeout"); });
    const reconcile = vi.fn<MarketingPublicationTransport["reconcile"]>(async input => success({ ...input, onSession: async () => {} }));
    const dispatcher = marketingDispatchService(db, { publish, reconcile });
    const result = await dispatcher.dispatch(f.id);
    expect(result).toEqual([{ jobId: f.jobs[0].id, status: "uncertain" }]);
    const uncertain = (await f.service.overview(f.id)).jobs.find(job => job.id === f.jobs[0].id)!;
    expect(uncertain.externalSessionId).toBe("native-session-id");
    await expect(dispatcher.retry(f.id, uncertain.id)).rejects.toThrow();
    await expect(dispatcher.dispatch(f.id)).rejects.toThrow("먼저 확인");
    expect(publish).toHaveBeenCalledTimes(1);
    await dispatcher.reconcile(f.id, uncertain.id);
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "native-session-id" }));
    expect((await f.service.overview(f.id)).jobs.find(job => job.id === uncertain.id)?.status).toBe("published");
  });
  it("requires verified account, snapshot and actual permalink, not a claimed success", async () => {
    const f = await fixture(); const publish = vi.fn<MarketingPublicationTransport["publish"]>(async input => ({ ...(await success(input)), status: "published", terminal: true, verifiedAccountId: "wrong_blog", verifiedSnapshotHash: input.snapshotHash, postedUrl: input.snapshot.channel.accountUrl, evidence: {} }));
    const result = await marketingDispatchService(db, { publish, reconcile: vi.fn() }).dispatch(f.id);
    expect(result[0].status).toBe("uncertain"); expect(publish).toHaveBeenCalledTimes(1);
    // Keep this isolated fixture from blocking later independent tests.
    await db.update(marketingPublishJobs).set({ status: "cancelled" }).where(eq(marketingPublishJobs.id, f.jobs[0].id));
  });
  it("does not replace the captured external session with a different execution", async () => {
    const f = await fixture(); let resumed = false;
    const publish = vi.fn<MarketingPublicationTransport["publish"]>(async input => {
      await input.onSession("first-native-session");
      await input.onSession("replacement-session");
      resumed = true;
      return success(input);
    });
    const result = await marketingDispatchService(db, { publish, reconcile: vi.fn() }).dispatch(f.id);
    expect(resumed).toBe(false); expect(result).toEqual([{ jobId: f.jobs[0].id, status: "uncertain" }]);
    expect((await f.service.overview(f.id)).jobs.find(job => job.id === f.jobs[0].id)?.externalSessionId).toBe("first-native-session");
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("serializes competing dispatchers with the native global lock", async () => {
    const f = await fixture(); let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const publish = vi.fn<MarketingPublicationTransport["publish"]>(async input => { entered(); await blocked; return success(input); });
    const dispatcher = marketingDispatchService(db, { publish, reconcile: vi.fn() });
    const first = dispatcher.dispatch(f.id); await started;
    try { await expect(dispatcher.dispatch(f.id)).rejects.toThrow("실행 중"); } finally { release(); }
    await first; expect(publish).toHaveBeenCalledTimes(3);
  });
  it("cancels stale approval before executing the browser", async () => {
    const f = await fixture(); await f.service.updateProfile(f.id, f.first.id, { browserProfileName: "Changed profile" });
    const publish = vi.fn(success); await marketingDispatchService(db, { publish, reconcile: vi.fn() }).dispatch(f.id);
    expect(publish).toHaveBeenCalledTimes(1); expect(publish.mock.calls[0][0].snapshot.profile.id).toBe(f.second.id);
  });
  it("freezes editorial configuration and detects changes outside the settings API", async () => {
    const f = await fixture();
    const approved = f.jobs[0].snapshot;
    expect(approved.channelConfiguration).toEqual({ name: "first_blog", concept: "Developers", tone: "Plain", audience: "Engineers", writingRules: "Sources" });
    expect(approved.channelConfigurationHash).toMatch(/^[a-f0-9]{64}$/);
    await db.update(marketingChannels).set({ writingRules: "New editorial rules" }).where(eq(marketingChannels.id, f.channels[0].id));
    const publish = vi.fn(success);
    await marketingDispatchService(db, { publish, reconcile: vi.fn() }).dispatch(f.id);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].snapshot.profile.id).toBe(f.second.id);
    const old = (await f.service.overview(f.id)).jobs.find(job => job.id === f.jobs[0].id)!;
    expect(old.status).toBe("cancelled");
    expect(old.snapshot).toEqual(approved);
  });
  it("does not silently upgrade legacy approval without its channel configuration", async () => {
    const f = await fixture();
    const legacy = { ...f.jobs[0].snapshot };
    delete legacy.channelConfiguration;
    delete legacy.channelConfigurationHash;
    await db.update(marketingPublishJobs).set({ snapshot: legacy, snapshotHash: marketingDigest(legacy) }).where(eq(marketingPublishJobs.id, f.jobs[0].id));
    const publish = vi.fn(success);
    await marketingDispatchService(db, { publish, reconcile: vi.fn() }).dispatch(f.id);
    expect(publish.mock.calls.some(([input]) => input.jobId === f.jobs[0].id)).toBe(false);
    const old = (await f.service.overview(f.id)).jobs.find(job => job.id === f.jobs[0].id)!;
    expect(old.status).toBe("cancelled");
    expect(old.snapshot).toEqual(legacy);
  });
});
