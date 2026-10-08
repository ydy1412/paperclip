import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, companies, agents, agentTaskSessions, agentHandoffs, issues, heartbeatRuns, heartbeatRunEvents, nativeRunFinalizations, activityLog } from "@paperclipai/db";
import { handoffContentSchema, saveHandoffSchema, seatAliasSchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentContinuityService, pendingSessionHandoff, renderStructuredHandoff } from "../services/agent-continuity.js";
import { agentService } from "../services/agents.js";
import { agentContinuityRoutes } from "../routes/agent-continuity.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createNativeSessionHandoffLoader } from "../services/native-runtime/native-session-handoff.js";
import { heartbeatService } from "../services/heartbeat.js";
import { currentNativeControllerIdentity } from "../services/native-runtime/native-restart-recovery.js";

const content = { goal: "Continue Task X", changedFiles: ["server/task.ts"], completed: ["Design"], inProgress: ["Implementation"], acceptanceCriteria: ["Data survives restart"], tests: [{ command: "pnpm test", result: "passed" as const, details: "Unit tests passed" }], decisions: ["Use canonical DB"], unresolved: ["Provider verification"], blockers: [], nextActions: ["Run integration tests"] };
const operator = { type: "user" as const, id: "operator" };
vi.mock("../services/access.js", () => ({ accessService: () => ({ decide: async () => ({ allowed: true }) }) }));
const execute = vi.hoisted(() => vi.fn(async (context: { agent: { id: string }; runtime: { sessionId: string | null }; context: Record<string, unknown> }) => ({
  exitCode: 0, signal: null, timedOut: false, sessionId: "a0000000-0000-4000-8000-000000000001",
  sessionParams: { sessionId: "a0000000-0000-4000-8000-000000000001" }, sessionDisplayId: "a0000000-0000-4000-8000-000000000001", summary: "Fresh context received", resultJson: { summary: "Fresh context received" },
})));
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: (type: string) => ({ ...actual.getServerAdapter(type), execute }) };
});

describe("continuity validators", () => {
  it("normalizes aliases and rejects invalid/incomplete/oversized checkpoints", () => {
    expect(seatAliasSchema.parse("Backend@Smartfarm")).toBe("backend@smartfarm");
    expect(seatAliasSchema.safeParse("backend").success).toBe(false);
    expect(handoffContentSchema.safeParse({ ...content, nextActions: [] }).success).toBe(false);
    expect(handoffContentSchema.safeParse({ ...content, completed: Array(20).fill("x".repeat(1500)) }).success).toBe(false);
    expect(saveHandoffSchema.safeParse({ issueId: randomUUID(), policy: "fresh_with_handoff", content }).success).toBe(false);
  });
});

describe("continuity real PostgreSQL/API", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let cwd: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("paperclip-continuity-"); db = createDb(database.connectionString); cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-continuity-workspace-")); }, 90_000);
  afterAll(async () => { await database?.cleanup(); if (cwd) await rm(cwd, { recursive: true, force: true }); });
  async function fixture() {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Continuity", issuePrefix: `C${companyId.slice(0, 6).toUpperCase()}` });
    const team = await db.insert(agents).values(["A", "B", "C"].map(name => ({ companyId, name, adapterType: "codex_local", adapterConfig: { cwd } }))).returning();
    const [issue] = await db.insert(issues).values({ companyId, title: "Task X", assigneeAgentId: team[0].id, status: "in_progress" }).returning();
    const [session] = await db.insert(agentTaskSessions).values({ companyId, agentId: team[0].id, adapterType: "codex_local", taskKey: issue.id, sessionDisplayId: "old-provider", sessionParamsJson: { sessionId: "old-provider", cwd } }).returning();
    return { companyId, team, issue, session, svc: agentContinuityService(db) };
  }
  function app(f: Awaited<ReturnType<typeof fixture>>, actorId = f.team[0].id, board = false) {
    const instance = express(); instance.use(express.json());
    instance.use((req, _res, next) => { req.actor = board ? { type: "board", source: "local_implicit", userId: "operator", isInstanceAdmin: true, companyIds: [f.companyId] } : { type: "agent", agentId: actorId, companyId: f.companyId, source: "agent_key" } as typeof req.actor; next(); });
    instance.use("/api", agentContinuityRoutes(db)); instance.use(errorHandler); return instance;
  }
  const requestCheckpoint = (f: Awaited<ReturnType<typeof fixture>>, policy: "resume" | "checkpoint_only" | "fresh_with_handoff" = "fresh_with_handoff") => ({ issueId: f.issue.id, expectedSessionId: f.session.sessionDisplayId, policy, content });

  it("migrates nullable aliases, company uniqueness and stable UUID history", async () => {
    const f = await fixture(); const other = await fixture();
    expect(f.team[0].seatAlias).toBeNull(); expect(f.session.continuityPolicy).toBe("resume");
    const service = agentService(db);
    await service.update(f.team[0].id, { seatAlias: "backend@smartfarm" });
    expect((await service.resolveByReference(f.companyId, "backend@smartfarm")).agent?.id).toBe(f.team[0].id);
    await expect(service.update(f.team[1].id, { seatAlias: "backend@smartfarm" })).rejects.toMatchObject({ status: 409 });
    await service.update(other.team[0].id, { seatAlias: "backend@smartfarm" });
    await service.update(f.team[0].id, { seatAlias: "reviewer@smartfarm" });
    expect((await db.select().from(agentTaskSessions).where(eq(agentTaskSessions.id, f.session.id)))[0].sessionDisplayId).toBe("old-provider");
    expect((await db.select().from(issues).where(eq(issues.id, f.issue.id)))[0].assigneeAgentId).toBe(f.team[0].id);
  });
  it("sends/broadcasts, unread/read/thread and task link without ownership or wake changes", async () => {
    const f = await fixture(); const sender = f.team[0].id; const recipient = f.team[1].id;
    const sent = await request(app(f)).post(`/api/agents/${sender}/mailbox`).send({ recipientIds: [recipient, f.team[2].id, recipient], body: "Review feedback", relatedIssueId: f.issue.id });
    expect(sent.status).toBe(201); expect(sent.body).toHaveLength(2);
    const inbox = await request(app(f, recipient)).get(`/api/agents/${recipient}/mailbox?unread=true`);
    expect(inbox.body[0].relatedIssueId).toBe(f.issue.id);
    const read = await request(app(f, recipient)).post(`/api/agents/${recipient}/mailbox/${inbox.body[0].id}/read`);
    expect(read.status).toBe(200); expect(read.body.readAt).toBeTruthy();
    expect((await f.svc.mailbox(f.companyId, recipient, true))).toHaveLength(0);
    expect((await f.svc.mailbox(f.companyId, sender, false, sent.body[0].threadId))).toHaveLength(2);
    expect((await db.select().from(issues).where(eq(issues.companyId, f.companyId)))).toHaveLength(1);
    expect((await db.select().from(issues).where(eq(issues.id, f.issue.id)))[0].assigneeAgentId).toBe(sender);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId)))).toHaveLength(0);
    expect((await db.select().from(activityLog).where(eq(activityLog.companyId, f.companyId)))).toHaveLength(2);
  });
  it("communicates without a task; rejects spoofing, foreign recipients/task, unauthorized read", async () => {
    const f = await fixture(); const foreign = await fixture();
    expect((await f.svc.send(f.companyId, f.team[0].id, { recipientIds: [f.team[1].id], body: "FYI" }, operator))[0].relatedIssueId).toBeNull();
    await expect(f.svc.send(f.companyId, f.team[0].id, { recipientIds: [foreign.team[0].id], body: "No" }, operator)).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.send(f.companyId, f.team[0].id, { recipientIds: [f.team[1].id], relatedIssueId: foreign.issue.id, body: "No" }, operator)).rejects.toMatchObject({ status: 400 });
    expect((await request(app(f)).get(`/api/agents/${f.team[1].id}/mailbox`)).status).toBe(403);
    const [delivery] = await f.svc.mailbox(f.companyId, f.team[1].id, true);
    await expect(f.svc.read(f.companyId, f.team[2].id, delivery.id, operator)).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.send(f.companyId, f.team[2].id, { recipientIds: [f.team[1].id], threadId: delivery.threadId, body: "No" }, operator)).rejects.toMatchObject({ status: 403 });
  });
  it("stores a complete immutable handoff, preserves session until fresh dispatch, never changes task", async () => {
    const f = await fixture();
    const saved = await request(app(f, undefined, true)).post(`/api/agents/${f.team[0].id}/handoffs`).send(requestCheckpoint(f));
    expect(saved.status).toBe(201); expect(saved.body.packet.content).toEqual(content);
    const [session] = await db.select().from(agentTaskSessions).where(eq(agentTaskSessions.id, f.session.id));
    expect(session.sessionDisplayId).toBe("old-provider"); expect(session.continuityPolicy).toBe("fresh_with_handoff");
    const packet = await pendingSessionHandoff(db, session, f.issue.id);
    const load = createNativeSessionHandoffLoader({ db, companyId: f.companyId, agentId: f.team[0].id, issueId: f.issue.id, before: new Date(), structuredHandoff: packet });
    const handoff = await load(); expect(await load()).toBe(handoff);
    for (const field of ["Task X", "server/task.ts", "pnpm test", "passed", "Run integration tests", f.issue.id, "old-provider"]) expect(handoff).toContain(field);
    expect(handoff).toContain(renderStructuredHandoff(packet!));
    expect((await db.select().from(issues).where(eq(issues.id, f.issue.id)))[0].status).toBe("in_progress");
  });
  it("rejects stale/incomplete handoffs and active rotation without clearing the session", async () => {
    const f = await fixture();
    await expect(f.svc.saveHandoff(f.companyId, f.team[0].id, { ...requestCheckpoint(f), expectedSessionId: "stale" }, operator)).rejects.toMatchObject({ status: 409 });
    expect((await request(app(f, undefined, true)).post(`/api/agents/${f.team[0].id}/handoffs`).send({ ...requestCheckpoint(f), content: { ...content, goal: "" } })).status).toBe(400);
    await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.team[0].id, status: "running" });
    await expect(f.svc.saveHandoff(f.companyId, f.team[0].id, requestCheckpoint(f), operator)).rejects.toMatchObject({ status: 409 });
    await f.svc.saveHandoff(f.companyId, f.team[0].id, requestCheckpoint(f, "checkpoint_only"), { type: "agent", id: f.team[0].id });
    expect((await db.select().from(agentTaskSessions).where(eq(agentTaskSessions.id, f.session.id)))[0]).toMatchObject({ sessionDisplayId: "old-provider", continuityPolicy: "resume", handoffId: expect.any(String) });
  });
  it("dispatches a fresh heartbeat with all handoff content, then restores normal resume policy", async () => {
    const f = await fixture();
    await f.svc.saveHandoff(f.companyId, f.team[0].id, requestCheckpoint(f), operator);
    const heartbeat = heartbeatService(db, { runtimeEnv: { PAPERCLIP_INSTANCE_ID: "continuity-fixture" } });
    execute.mockClear();
    const dispatched = await heartbeat.invoke(f.team[0].id, "on_demand", { issueId: f.issue.id, taskId: f.issue.id, taskKey: f.issue.id }, "manual", { actorType: "user", actorId: "operator" });
    await heartbeat.drainActiveRunExecutions();
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, dispatched!.id));
    expect(runs.at(-1)?.status, JSON.stringify(runs.map(run => ({ status: run.status, error: run.error })))).toBe("succeeded");
    expect(execute.mock.calls.filter(call => call[0].agent.id === f.team[0].id).length).toBeGreaterThanOrEqual(1);
    const context = execute.mock.calls.find(call => call[0].agent.id === f.team[0].id)![0];
    expect(context.runtime.sessionId).toBeNull();
    expect(context.context.paperclipFreshSessionHandoffMarkdown).toContain("server/task.ts");
    expect(context.context.paperclipFreshSessionHandoffMarkdown).toContain("Run integration tests");
    expect((await db.select().from(agentTaskSessions).where(eq(agentTaskSessions.id, f.session.id)))[0]).toMatchObject({ continuityPolicy: "resume", sessionDisplayId: "a0000000-0000-4000-8000-000000000001" });
  }, 30_000);
  it("fails closed on a corrupted persisted handoff", async () => {
    const f = await fixture(); const saved = await f.svc.saveHandoff(f.companyId, f.team[0].id, requestCheckpoint(f), operator);
    await db.update(agentHandoffs).set({ packet: { ...saved.packet, content: { ...content, acceptanceCriteria: [] } } }).where(eq(agentHandoffs.id, saved.id));
    const [session] = await db.select().from(agentTaskSessions).where(eq(agentTaskSessions.id, f.session.id));
    await expect(pendingSessionHandoff(db, session, f.issue.id)).rejects.toMatchObject({ status: 409 });
    expect((await f.svc.assess(f.companyId, f.team[0].id))[0].status).toBe("attention_required");
  });
  it("retains the old session and pending handoff when fresh adapter execution fails", async () => {
    const f = await fixture();
    await f.svc.saveHandoff(f.companyId, f.team[0].id, requestCheckpoint(f), operator);
    execute.mockImplementationOnce(async () => ({ exitCode: 1, signal: null, timedOut: false, clearSession: true, errorMessage: "Fixture provider failure", sessionId: "", sessionParams: { sessionId: "" }, sessionDisplayId: "", summary: "failed", resultJson: { summary: "failed" } }));
    const heartbeat = heartbeatService(db, { runtimeEnv: { PAPERCLIP_INSTANCE_ID: "continuity-failure-fixture" } });
    await heartbeat.invoke(f.team[0].id, "on_demand", { issueId: f.issue.id, taskKey: f.issue.id }, "manual", { actorType: "user", actorId: "operator" });
    await heartbeat.drainActiveRunExecutions();
    const [session] = await db.select().from(agentTaskSessions).where(eq(agentTaskSessions.id, f.session.id));
    expect(session).toMatchObject({ sessionDisplayId: "old-provider", continuityPolicy: "fresh_with_handoff", handoffId: expect.any(String) });
    expect(await pendingSessionHandoff(db, session, f.issue.id)).toBeTruthy();
  }, 30_000);
  it("reports resumed only with native acknowledgement plus current controller ownership/lease", async () => {
    const f = await fixture(); const identity = await currentNativeControllerIdentity();
    const nativeSessionId = randomUUID(); const runnerInstanceId = randomUUID();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.team[0].id, nativeIssueId: f.issue.id, runtimeMode: "native", status: "running", nativeSessionId, runnerInstanceId }).returning();
    await db.insert(nativeRunFinalizations).values({ runId: run.id, companyId: f.companyId, issueId: f.issue.id, phase: "execution", controllerBootId: identity.bootId, controllerPid: identity.pid, controllerProcessStartedAt: identity.processStartedAt, leaseExpiresAt: new Date(Date.now() + 60_000) });
    await db.update(agentTaskSessions).set({ lastRunId: run.id, sessionParamsJson: { sessionId: nativeSessionId, cwd } }).where(eq(agentTaskSessions.id, f.session.id));
    expect((await f.svc.assess(f.companyId, f.team[0].id))[0].status).toBe("awaiting_decision");
    await db.insert(heartbeatRunEvents).values({ companyId: f.companyId, agentId: f.team[0].id, runId: run.id, seq: 1, eventType: "session.resumed", sourceInstanceId: runnerInstanceId, payload: { fixture: true } });
    expect((await f.svc.assess(f.companyId, f.team[0].id))[0].status).toBe("resumed");
    await db.update(nativeRunFinalizations).set({ controllerBootId: randomUUID() }).where(eq(nativeRunFinalizations.runId, run.id));
    expect((await agentContinuityService(db).assess(f.companyId, f.team[0].id))[0].status).toBe("awaiting_decision");
  });
  it("honestly assesses A saved ID, B handoff/no ID, C missing workspace after service restart", async () => {
    const f = await fixture(); const b = await fixture(); const c = await fixture();
    await b.svc.saveHandoff(b.companyId, b.team[0].id, requestCheckpoint(b), operator);
    await db.update(agentTaskSessions).set({ sessionDisplayId: null, sessionParamsJson: null }).where(eq(agentTaskSessions.id, b.session.id));
    await db.update(agents).set({ adapterConfig: { cwd: path.join(cwd, "missing") } }).where(eq(agents.id, c.team[0].id));
    const restarted = agentContinuityService(db);
    expect((await restarted.assess(f.companyId, f.team[0].id))[0].status).toBe("awaiting_decision");
    expect((await restarted.assess(b.companyId, b.team[0].id))[0].status).toBe("fresh_with_handoff");
    await db.update(agentTaskSessions).set({ sessionParamsJson: { cwd: path.join(cwd, "missing") } }).where(eq(agentTaskSessions.id, c.session.id));
    expect((await restarted.assess(c.companyId, c.team[0].id))[0].status).toBe("attention_required");
    await db.update(agentTaskSessions).set({ lastError: "Provider failed" }).where(eq(agentTaskSessions.id, f.session.id));
    expect((await restarted.assess(f.companyId, f.team[0].id))[0].status).toBe("failed");
  });
});
