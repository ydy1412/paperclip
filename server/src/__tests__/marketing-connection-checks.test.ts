import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, companies, projects, marketingChannels, marketingConnectionChecks as checks } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { marketingService } from "../services/marketing.js";
import { marketingConnectionQueue, monitorIntervalMs } from "../services/marketing-connection-queue.js";
import { createMarketingConnectionWorkflow, appliedConnectionVerdict } from "../services/marketing-connection-workflow.js";
import { parseConnectionFinal, type ConnectionObservation } from "../services/marketing-connection-aside.js";
import { marketingRoutes } from "../routes/marketing.js";
import { errorHandler } from "../middleware/error-handler.js";

const model = { status: "connected" as const, choice: "connected" as const, probability: 0.96, probabilities: { connected: 0.96, auth_required: 0.02, unknown: 0.02 }, model: "local/laya-marketing-rlcd" as const, usage: { inputTokens: 10, outputTokens: 10 }, truncated: false as const };
describe("durable connection checks", () => {
  const openWorkflows = new Set<Awaited<ReturnType<typeof createMarketingConnectionWorkflow>>>();
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("paperclip-connections-"); db = createDb(database.connectionString); }, 90000);
  afterAll(async () => { for (const workflow of openWorkflows) await workflow.close(); await database?.cleanup(); });
  afterEach(async () => { await db.update(checks).set({ status: "cancelled", leaseOwner: null, leaseUntil: null }); });
  async function fixture() {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Connections", issuePrefix: `C${companyId.slice(0, 6)}`, defaultResponsibleUserId: "operator" });
    const [project] = await db.insert(projects).values({ companyId, name: "Checks" }).returning();
    const service = marketingService(db);
    const profile = await service.createProfile(companyId, { projectId: project.id, name: "Selected", asideAccountId: "u1", browserProfileName: "Profile 1" });
    const channel = await service.createChannel(companyId, { projectId: project.id, profileId: profile.id, platform: "naver_blog", name: "Blog", accountId: "test_owner", accountUrl: "https://blog.naver.com/test_owner", concept: "Test", tone: "", audience: "", writingRules: "" });
    return { companyId, project, profile, channel, queue: marketingConnectionQueue(db) };
  }
  function app(companyId: string, actorType = "board") {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: actorType, source: "session", userId: "operator", companyIds: [companyId], companyId } as typeof req.actor; next(); });
    app.use("/api", marketingRoutes(db)); app.use(errorHandler); return app;
  }
  function observed(job: Awaited<ReturnType<ReturnType<typeof marketingConnectionQueue>["get"]>>): ConnectionObservation {
    return { jobId: job.id, channelId: job.channelId, sessionId: job.asideSessionId!, platform: "naver_blog", accountId: job.target.accountId, observation: "대상 계정의 소유자 전용 메뉴가 보이며 로그인 화면이나 로딩 오류가 없습니다.",
      evidence: { checkedAt: new Date().toISOString(), ownerMatches: true, authenticationRequired: false, ownerControlsPresent: true, loadingFailed: false, conflicting: false },
      sideEffects: { preExistingTabsPreserved: true, contentMutated: false, accountsChanged: false } };
  }
  it("accepts 202 without invoking Aside, deduplicates and blocks foreign/agent access", async () => {
    const f = await fixture(), foreign = await fixture(), endpoint = `/api/companies/${f.companyId}/marketing/connection-checks`;
    const body = { projectId: f.project.id, channelIds: [f.channel.id] };
    const a = await request(app(f.companyId)).post(endpoint).send(body), b = await request(app(f.companyId)).post(endpoint).send(body);
    expect(a.status).toBe(202); expect(b.body.jobs[0].id).toBe(a.body.jobs[0].id);
    expect((await f.queue.overview(f.companyId, f.project.id)).jobs[0].asideSessionId).toBeNull();
    expect((await request(app(f.companyId, "agent")).post(endpoint).send(body)).status).toBe(403);
    expect((await request(app(foreign.companyId)).get(endpoint).query({ projectId: f.project.id })).status).toBe(403);
    expect((await request(app(f.companyId)).post(endpoint).send({ projectId: foreign.project.id })).status).toBe(404);
    expect((await request(app(f.companyId)).post(endpoint).send({ projectId: f.project.id, channelIds: [foreign.channel.id] })).status).toBe(404);
  });
  it("deduplicates concurrent admission and fences expired owners", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.queue.enqueue(f.companyId, f.project.id), f.queue.enqueue(f.companyId, f.project.id)]);
    expect(a[0].id).toBe(b[0].id);
    const owner = randomUUID(); await f.queue.claim(owner);
    await expect(f.queue.patch(a[0].id, randomUUID(), { reason: "late" })).rejects.toThrow("소유권");
    await db.update(checks).set({ leaseUntil: new Date(0) }).where(eq(checks.id, a[0].id));
    await expect(f.queue.finish(a[0].id, owner, null, "connected", null)).rejects.toThrow("오래된");
    await db.update(checks).set({ status: "cancelled" }).where(eq(checks.id, a[0].id));
  });
  it("keeps every channel's latest check after another channel accumulates over 200 results", async () => {
    const f = await fixture();
    const [older] = await f.queue.enqueue(f.companyId, f.project.id);
    const [other] = await db.insert(marketingChannels).values({ ...f.channel, id: randomUUID(), name: "Second", accountId: "second", accountUrl: "https://blog.naver.com/second" }).returning();
    await db.insert(checks).values(Array.from({ length: 205 }, (_, i) => {
      const id = randomUUID();
      return { companyId: f.companyId, projectId: f.project.id, channelId: other.id, id, threadId: id, source: "manual", status: "completed", target: { ...older.target, accountId: "second", accountUrl: other.accountUrl }, createdAt: new Date(older.createdAt.getTime() + i + 1) };
    }));
    const state = await f.queue.overview(f.companyId, f.project.id);
    expect(state.jobs.find(job => job.channelId === f.channel.id)?.id).toBe(older.id);
    expect(state.jobs.filter(job => job.channelId === other.id)).toHaveLength(1);
    expect(state.jobs).toHaveLength(2);
  });
  it("invalidates verification on rebinding, preserves it for content edits and fences the previous result", async () => {
    const f = await fixture(), service = marketingService(db);
    const checkedAt = new Date();
    await db.update(marketingChannels).set({ connectionStatus: "connected", connectionCheckedAt: checkedAt }).where(eq(marketingChannels.id, f.channel.id));
    await service.updateChannel(f.companyId, f.channel.id, { concept: "New concept" });
    expect((await f.queue.overview(f.companyId, f.project.id)).connections[0]).toMatchObject({ status: "connected", checkedAt });
    const [job] = await f.queue.enqueue(f.companyId, f.project.id);
    const owner = randomUUID(); await f.queue.claim(owner);
    await service.updateChannel(f.companyId, f.channel.id, { accountId: "new_owner", accountUrl: "https://blog.naver.com/new_owner" });
    expect((await f.queue.overview(f.companyId, f.project.id)).connections[0]).toMatchObject({ status: "unknown", checkedAt: null });
    await f.queue.finish(job.id, owner, model, "connected", null);
    expect((await f.queue.overview(f.companyId, f.project.id)).connections[0].status).toBe("unknown");
    await db.update(marketingChannels).set({ connectionStatus: "connected", connectionCheckedAt: checkedAt }).where(eq(marketingChannels.id, f.channel.id));
    await service.updateProfile(f.companyId, f.profile.id, { name: "Renamed" });
    expect((await f.queue.overview(f.companyId, f.project.id)).connections[0].status).toBe("connected");
    await service.updateProfile(f.companyId, f.profile.id, { asideAccountId: "u2", browserProfileName: "Profile 2" });
    expect((await f.queue.overview(f.companyId, f.project.id)).connections[0]).toMatchObject({ status: "unknown", checkedAt: null });
  });
  it("defaults monitoring OFF, schedules only due intervals and OFF cancels automatic queued checks only", async () => {
    const f = await fixture();
    expect((await f.queue.overview(f.companyId, f.project.id)).monitor.enabled).toBe(false);
    const start = new Date(); await f.queue.setMonitor(f.companyId, f.project.id, true, start);
    await f.queue.schedule(new Date(start.getTime() + monitorIntervalMs - 1));
    expect((await f.queue.overview(f.companyId, f.project.id)).jobs).toHaveLength(0);
    await f.queue.schedule(new Date(start.getTime() + monitorIntervalMs));
    expect((await f.queue.overview(f.companyId, f.project.id)).jobs).toHaveLength(1);
    await f.queue.setMonitor(f.companyId, f.project.id, false);
    expect((await f.queue.overview(f.companyId, f.project.id)).jobs[0].status).toBe("cancelled");
    const [manual] = await f.queue.enqueue(f.companyId, f.project.id);
    await f.queue.setMonitor(f.companyId, f.project.id, false);
    expect((await f.queue.overview(f.companyId, f.project.id)).jobs.find(row => row.id === manual.id)?.status).toBe("queued");
    await db.update(checks).set({ status: "cancelled" }).where(eq(checks.id, manual.id));
  });
  it("resumes real PostgresSaver checkpoints with the same session and no duplicate request", async () => {
    const f = await fixture();
    const [job] = await f.queue.enqueue(f.companyId, f.project.id);
    const aside = { prepare: vi.fn(async (_job, save) => { await save("saved-session-12345"); return "saved-session-12345"; }), request: vi.fn(async () => {}), poll: vi.fn(async () => null as ConnectionObservation | null) };
    const classify = vi.fn(async () => model);
    let workflow = await createMarketingConnectionWorkflow(db, { connectionString: database.connectionString, aside, classify });
    openWorkflows.add(workflow);
    async function advance() {
      await db.update(checks).set({ nextPollAt: new Date(0) }).where(eq(checks.id, job.id));
      const owner = randomUUID(), claims = await f.queue.claim(owner);
      const selected = claims.find(row => row.id === job.id); expect(selected).toBeDefined();
      for (const row of claims) if (row.id !== job.id) await f.queue.release(row.id, owner);
      await workflow.advance(selected!);
    }
    await advance(); expect(aside.request).toHaveBeenCalledTimes(1); expect(classify).not.toHaveBeenCalled();
    await workflow.close(); openWorkflows.delete(workflow);
    workflow = await createMarketingConnectionWorkflow(db, { connectionString: database.connectionString, aside, classify });
    openWorkflows.add(workflow);
    await advance(); // Still no result: idle/progress is insufficient and stays interrupted.
    expect(aside.request).toHaveBeenCalledTimes(1); expect(classify).not.toHaveBeenCalled();
    aside.poll.mockImplementation(async row => observed(row));
    await advance(); expect((await f.queue.overview(f.companyId, f.project.id)).jobs[0].status).toBe("result_received");
    await advance();
    const result = (await f.queue.overview(f.companyId, f.project.id));
    expect(result.jobs[0]).toMatchObject({ status: "completed", asideSessionId: "saved-session-12345", appliedStatus: "connected" });
    expect(result.connections[0].status).toBe("connected"); expect(classify.mock.calls[0][0]).toEqual({ platform: "naver_blog", accountId: "test_owner", observation: expect.any(String) });
    expect(aside.prepare).toHaveBeenCalledTimes(1); expect(aside.request).toHaveBeenCalledTimes(1);
    await workflow.close(); openWorkflows.delete(workflow);
  });
  it("does not resend a crash-window request intent, and rejects wrong/stale final results", async () => {
    const f = await fixture(); const [job] = await f.queue.enqueue(f.companyId, f.project.id);
    await db.update(checks).set({ asideSessionId: "saved-session-12345", preparationIntentAt: new Date(), requestIntentAt: new Date(), status: "waiting" }).where(eq(checks.id, job.id));
    const aside = { prepare: vi.fn(), request: vi.fn(), poll: vi.fn(async () => null) };
    const workflow = await createMarketingConnectionWorkflow(db, { connectionString: database.connectionString, aside, classify: async () => model });
    openWorkflows.add(workflow);
    const claims = await f.queue.claim(randomUUID()), selected = claims.find(row => row.id === job.id)!;
    for (const row of claims) if (row.id !== job.id) await f.queue.release(row.id, row.leaseOwner!);
    await workflow.advance(selected); expect(aside.request).not.toHaveBeenCalled(); expect(aside.prepare).not.toHaveBeenCalled();
    const final = observed(selected), prefix = "PAPERCLIP_CONNECTION_FINAL ";
    expect(parseConnectionFinal([prefix + JSON.stringify(final)], selected)?.jobId).toBe(job.id);
    expect(parseConnectionFinal([prefix + JSON.stringify({ ...final, channelId: randomUUID() })], selected)).toBeNull();
    expect(parseConnectionFinal([prefix + JSON.stringify({ ...final, evidence: { ...final.evidence, checkedAt: new Date(0).toISOString() } })], selected)).toBeNull();
    await db.update(checks).set({ status: "cancelled" }).where(eq(checks.id, job.id)); await workflow.close(); openWorkflows.delete(workflow);
  });
  it("accepts verified owner evidence despite auxiliary loading or model abstention", async () => {
    const f = await fixture(); const [job] = await f.queue.enqueue(f.companyId, f.project.id);
    const observation = observed({ ...job, asideSessionId: "saved-session-12345" });
    observation.evidence.loadingFailed = true;
    for (const decision of [model, { status: "unknown" as const, choice: "unknown" as const, probability: 0.9772 }, { status: "auth_required" as const, choice: "auth_required" as const, probability: 0.8918 }, { ...model, probability: 0.5 }]) {
      expect(appliedConnectionVerdict(observation, decision)).toBe("connected");
    }
  });
  it("keeps unknown identities, conflicting owners and authentication gates unconfirmed", async () => {
    const f = await fixture(); const [job] = await f.queue.enqueue(f.companyId, f.project.id);
    const observation = observed({ ...job, asideSessionId: "saved-session-12345" });
    for (const evidence of [
      { ownerMatches: null, authenticationRequired: null, loadingFailed: true },
      { ownerMatches: false }, { conflicting: true }, { authenticationRequired: true },
      { ownerControlsPresent: false }, { authenticationRequired: null },
    ]) {
      expect(appliedConnectionVerdict({ ...observation, evidence: { ...observation.evidence, ...evidence } }, model)).toBe("unknown");
    }
    const signedOut = { ...observation, evidence: { ...observation.evidence, ownerMatches: null, authenticationRequired: true, ownerControlsPresent: false } };
    const auth = { status: "auth_required" as const, choice: "auth_required" as const, probability: 0.95 };
    expect(appliedConnectionVerdict(signedOut, auth)).toBe("auth_required");
    expect(appliedConnectionVerdict({ ...signedOut, evidence: { ...signedOut.evidence, loadingFailed: true } }, auth)).toBe("unknown");
  });
  it("corrects the real timeout counterexample using verified owner proof and rejects changed targets", async () => {
    const f = await fixture(); const [job] = await f.queue.enqueue(f.companyId, f.project.id);
    await db.update(marketingChannels).set({ connectionStatus: "connected" }).where(eq(marketingChannels.id, f.channel.id));
    const claims = await f.queue.claim(randomUUID()), selected = claims.find(row => row.id === job.id)!;
    for (const row of claims) if (row.id !== job.id) await f.queue.release(row.id, row.leaseOwner!);
    const observation = observed({ ...selected, asideSessionId: "saved-session-12345" }); observation.evidence.loadingFailed = true;
    const wrong = { status: "auth_required" as const, choice: "auth_required" as const, probability: 0.8918 };
    const applied = appliedConnectionVerdict(observation, wrong);
    expect(applied).toBe("connected");
    await f.queue.finish(job.id, selected.leaseOwner!, wrong, applied, null);
    expect((await f.queue.overview(f.companyId, f.project.id)).jobs[0]).toMatchObject({ status: "completed", rawDecision: wrong, appliedStatus: "connected" });
    expect((await f.queue.overview(f.companyId, f.project.id)).connections[0].status).toBe("connected");
    const [next] = await f.queue.enqueue(f.companyId, f.project.id); const owner = randomUUID(); await f.queue.claim(owner);
    await db.update(marketingChannels).set({ accountId: "changed_owner" }).where(eq(marketingChannels.id, f.channel.id));
    await f.queue.finish(next.id, owner, model, "connected", null);
    expect((await f.queue.overview(f.companyId, f.project.id)).jobs[0].appliedStatus).toBe("unknown");
  });
  it("admits at most three Aside jobs across competing workers", async () => {
    const fixtures = []; for (let i = 0; i < 5; i++) fixtures.push(await fixture());
    for (const f of fixtures) await f.queue.enqueue(f.companyId, f.project.id);
    const queue = fixtures[0].queue;
    const [a, b] = await Promise.all([queue.claim(randomUUID()), queue.claim(randomUUID())]);
    expect(a.length + b.length).toBe(3); expect(new Set([...a, ...b].map(row => row.id)).size).toBe(3);
  });
  it("serializes Laya inference across competing durable workflows", async () => {
    const a = await fixture(), b = await fixture();
    const [first] = await a.queue.enqueue(a.companyId, a.project.id);
    const [second] = await b.queue.enqueue(b.companyId, b.project.id);
    const aside = { prepare: vi.fn(async (_job, save) => { await save("saved-session-12345"); return "saved-session-12345"; }), request: vi.fn(async () => {}), poll: vi.fn(async row => observed(row)) };
    let started!: () => void, unblock!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    const classify = vi.fn(async () => { started(); await blocked; return model; });
    const one = await createMarketingConnectionWorkflow(db, { connectionString: database.connectionString, aside, classify });
    const two = await createMarketingConnectionWorkflow(db, { connectionString: database.connectionString, aside, classify });
    openWorkflows.add(one); openWorkflows.add(two);
    async function claimed(id: string) {
      await db.update(checks).set({ nextPollAt: new Date(0) }).where(eq(checks.id, id));
      const owner = randomUUID(), rows = await a.queue.claim(owner);
      for (const row of rows) if (row.id !== id) await a.queue.release(row.id, owner);
      const row = rows.find(job => job.id === id); expect(row).toBeDefined(); return row!;
    }
    await one.advance(await claimed(first.id)); await two.advance(await claimed(second.id));
    const inFlight = one.advance(await claimed(first.id));
    try {
      await startedPromise;
      await two.advance(await claimed(second.id));
      expect(classify).toHaveBeenCalledTimes(1);
      expect((await b.queue.overview(b.companyId, b.project.id)).jobs[0].status).toBe("result_received");
    } finally { unblock(); await inFlight; }
    await two.advance(await claimed(second.id));
    expect(classify).toHaveBeenCalledTimes(2);
    expect((await b.queue.overview(b.companyId, b.project.id)).jobs[0].status).toBe("completed");
    await one.close(); openWorkflows.delete(one); await two.close(); openWorkflows.delete(two);
  });
  it("cancels a leased automatic job before preparation but lets started work finish", async () => {
    const f = await fixture(); await f.queue.setMonitor(f.companyId, f.project.id, true);
    const [job] = await f.queue.enqueue(f.companyId, f.project.id, undefined, "automatic");
    const owner = randomUUID(); await f.queue.claim(owner);
    await f.queue.setMonitor(f.companyId, f.project.id, false);
    await expect(f.queue.patch(job.id, owner, { preparationIntentAt: new Date() })).rejects.toThrow("소유권");
    await f.queue.setMonitor(f.companyId, f.project.id, true);
    const [running] = await f.queue.enqueue(f.companyId, f.project.id, undefined, "automatic");
    await f.queue.claim(owner); await f.queue.patch(running.id, owner, { preparationIntentAt: new Date() });
    await f.queue.setMonitor(f.companyId, f.project.id, false);
    expect((await f.queue.get(running.id, owner)).status).toBe("preparing");
  });
});
