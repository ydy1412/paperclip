import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createDb, companies, agents, authUsers, companyMemberships, principalPermissionGrants, heartbeatRuns, agentProfiles, agentProfileVersions, agentProfileBindings, activityLog } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { agentProfileService } from "../services/agent-profiles.js";
import { agentInstructionsService } from "../services/agent-instructions.js";
import { agentInstructionRevisionService } from "../services/agent-instruction-revisions.js";
import { agentProfileRoutes } from "../routes/agent-profiles.js";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/error-handler.js";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";
import type { CreateAgentProfile } from "@paperclipai/shared";

let db: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, home: string;
const companyId = randomUUID(), otherCompanyId = randomUUID(), userId = randomUUID();
const input: CreateAgentProfile = { name: "상품 가공", description: "옵션과 상품 정보를 검토합니다.", config: { capabilities: "검토", instructions: "# Original profile", adapterType: "codex_local", runnerProvider: "codex", model: "gpt-6.1-sol", skills: [] } };
const base = `/api/companies/${companyId}/agent-profiles`;
const actor = { type: "board" as const, source: "board_key" as const, userId };
function app() {
  const server = express(); server.use(express.json());
  server.use((req, _res, next) => { req.actor = req.header("x-agent") ? { type: "agent", companyId, agentId: randomUUID(), source: "agent_jwt" } : { ...actor, companyIds: [companyId] }; next(); });
  server.use("/api", boardMutationGuard()); server.use("/api", agentProfileRoutes(db)); server.use("/api", agentRoutes(db)); server.use(errorHandler); return server;
}
async function linked() {
  const service = agentProfileService(db), profile = await service.create(companyId, input, userId);
  const [agent] = await db.insert(agents).values({ companyId, name: `Profile fixture ${randomUUID()}`, adapterType: input.config.adapterType, role: "engineer", title: "Original title", capabilities: input.config.capabilities,
    adapterConfig: { model: input.config.model, env: { FIXTURE_SETTING: { type: "plain", value: "preserve" } }, cwd: home }, runtimeConfig: { heartbeat: { enabled: false } } }).returning();
  const bundle = await agentInstructionsService(db).materializeManagedBundle(agent, { "AGENTS.md": input.config.instructions });
  await db.update(agents).set({ adapterConfig: bundle.adapterConfig }).where(eq(agents.id, agent.id));
  await service.bind(companyId, profile.id, 1, agent.id, userId);
  return { service, profile, agent };
}
beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "dovix-profiles-")); vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("dovix-profiles-db-"); db = createDb(database.connectionString);
  await db.insert(companies).values([{ id: companyId, name: "Profile fixtures", issuePrefix: "PF", defaultResponsibleUserId: userId }, { id: otherCompanyId, name: "Other", issuePrefix: "PO" }]);
  await db.insert(authUsers).values({ id: userId, name: "Synthetic owner", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "operator" });
  await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "agents:configure" });
  await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "agents:create" });
}, 90000);
afterAll(async () => { await database?.cleanup(); vi.unstubAllEnvs(); if (home) await rm(home, { recursive: true, force: true }); });
describe("versioned agent profiles", () => {
  it("uses the existing hire endpoint and links the pinned profile without copying authentication into it", async () => {
    const service = agentProfileService(db), profile = await service.create(companyId, input, userId);
    const hireBase = `/api/companies/${companyId}/agent-hires`;
    const payload = { name: `Hired fixture ${randomUUID()}`, adapterType: "codex_local", adapterConfig: { model: input.config.model, cwd: home }, runtimeConfig: { heartbeat: { enabled: false } }, profileId: profile.id, profileVersion: profile.version };
    expect((await request(app()).post(hireBase).send({ ...payload, profileVersion: 100 })).status).toBe(409);
    expect((await request(app()).post(hireBase).send({ ...payload, profileId: otherCompanyId })).status).toBe(404);
    const result = await request(app()).post(hireBase).send(payload);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body.agent).toMatchObject({ name: payload.name, role: "general", title: null, capabilities: input.config.capabilities });
    const detail = await service.get(companyId, profile.id); expect(detail.bindings).toHaveLength(1); expect(detail.bindings[0].agentId).toBe(result.body.agent.id);
    expect((await agentInstructionRevisionService(db).readCurrent({ companyId, agentId: result.body.agent.id }, actor))?.content).toBe(input.config.instructions);
  });
  it("persists versions/audit atomically and rejects stale, secret-shaped and cross-company writes", async () => {
    const server = app(); const created = await request(server).post(base).send(input); expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await request(server).get(`${base}/${id}`)).body.config).toEqual(input.config);
    expect((await request(server).post(base).set("x-agent", "1").send(input)).status).toBe(403);
    expect((await request(server).get(base.replace(companyId, otherCompanyId))).status).toBe(403);
    const patch = { ...input, expectedVersion: 1, applyToLinked: false, description: "updated" };
    expect((await request(server).patch(`${base}/${id}`).send(patch)).status).toBe(200);
    expect((await request(server).patch(`${base}/${id}`).send(patch)).status).toBe(409);
    expect((await request(server).post(base).send({ ...input, config: { ...input.config, apiKey: "synthetic-secret" } })).status).toBe(400);
    expect((await request(server).post(base).send({ ...input, config: { ...input.config, skills: ["missing-skill"] } })).status).toBe(400);
    expect(await db.select().from(agentProfileVersions).where(eq(agentProfileVersions.profileId, id))).toHaveLength(2);
    expect((await db.select().from(activityLog).where(eq(activityLog.entityId, id))).map(x => x.action)).toEqual(["agent.profile_created", "agent.profile_updated"]);
  });
  it("keeps changes opt-in, applies instructions/model after active work and preserves identity/auth/workspace", async () => {
    const { service, profile, agent } = await linked();
    const next = { ...input, config: { ...input.config, instructions: "# Updated", model: "gpt-6-sol", capabilities: "새 담당 업무" }, expectedVersion: 1, applyToLinked: false };
    await service.update(companyId, profile.id, next, userId);
    expect((await service.get(companyId, profile.id)).bindings[0].appliedVersion).toBe(1);
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, status: "running", invocationSource: "on_demand", responsibleUserId: userId }).returning();
    await service.update(companyId, profile.id, { ...next, expectedVersion: 2, applyToLinked: true }, userId);
    expect((await service.get(companyId, profile.id)).bindings[0]).toMatchObject({ appliedVersion: 1, pendingVersion: 3 });
    expect((await agentInstructionRevisionService(db).readCurrent({ companyId, agentId: agent.id }, actor))?.content).toBe(input.config.instructions);
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, run.id));
    expect(await service.applyPending(agent.id)).toBe(true);
    const [updated] = await db.select().from(agents).where(eq(agents.id, agent.id));
    expect(updated).toMatchObject({ name: agent.name, role: agent.role, title: agent.title, capabilities: "새 담당 업무", reportsTo: agent.reportsTo, runtimeConfig: agent.runtimeConfig, adapterConfig: { model: "gpt-6-sol", env: { FIXTURE_SETTING: { type: "plain", value: "preserve" } }, cwd: home } });
    expect((await agentInstructionRevisionService(db).readCurrent({ companyId, agentId: agent.id }, actor))?.content).toBe("# Updated");
    expect((await service.get(companyId, profile.id)).bindings[0]).toMatchObject({ appliedVersion: 3, pendingVersion: null, error: null });
  });
  it("preserves per-agent overrides, restores a prior version and deletes only the profile/link", async () => {
    const { service, profile, agent } = await linked();
    const [original] = await db.select().from(agents).where(eq(agents.id, agent.id));
    await db.update(agents).set({ title: "Individual title", adapterConfig: { ...original.adapterConfig, model: "custom-model" } }).where(eq(agents.id, agent.id));
    await service.update(companyId, profile.id, { ...input, config: { ...input.config, capabilities: "Profile work", model: "profile-model" }, expectedVersion: 1, applyToLinked: true }, userId);
    const [updated] = await db.select().from(agents).where(eq(agents.id, agent.id)); expect(updated.title).toBe("Individual title"); expect(updated.adapterConfig.model).toBe("custom-model");
    expect((await service.get(companyId, profile.id)).bindings[0].overrides).toEqual(expect.arrayContaining(["model"]));
    const restored = await service.restore(companyId, profile.id, { expectedVersion: 2, version: 1, applyToLinked: false }, userId); expect(restored.version).toBe(3); expect(restored.config).toEqual(input.config);
    await service.remove(companyId, profile.id, 3, userId);
    expect(await db.select().from(agents).where(eq(agents.id, agent.id))).toHaveLength(1);
    expect(await db.select().from(agentProfileBindings).where(eq(agentProfileBindings.agentId, agent.id))).toHaveLength(0);
  });
  it("clears a profile-owned model when choosing the default", async () => {
    const { service, profile, agent } = await linked();
    await service.update(companyId, profile.id, { ...input, config: { ...input.config, model: "" }, expectedVersion: 1, applyToLinked: true }, userId);
    const [updated] = await db.select().from(agents).where(eq(agents.id, agent.id)); expect(updated.adapterConfig).not.toHaveProperty("model");
  });
  it("reads legacy role/title snapshots but never propagates them or uses them for profile hires", async () => {
    const { service, profile, agent } = await linked();
    const legacy = { ...input.config, role: "ceo", title: "Legacy profile title" };
    await db.update(agentProfiles).set({ config: legacy }).where(eq(agentProfiles.id, profile.id));
    await db.update(agentProfileVersions).set({ config: legacy }).where(eq(agentProfileVersions.profileId, profile.id));
    const detail = await service.get(companyId, profile.id);
    expect(detail.config).not.toHaveProperty("role"); expect(detail.versions[0].config).not.toHaveProperty("title");
    expect((await service.list(companyId)).find(p => p.id === profile.id)!.config).not.toHaveProperty("title");
    await service.restore(companyId, profile.id, { expectedVersion: 1, version: 1, applyToLinked: true }, userId);
    const [updated] = await db.select().from(agents).where(eq(agents.id, agent.id));
    expect(updated.role).toBe(agent.role); expect(updated.title).toBe(agent.title);
    const result = await request(app()).post(`/api/companies/${companyId}/agent-profiles`).send({ ...input, config: legacy });
    expect(result.status).toBe(201); expect(result.body.config).not.toHaveProperty("role"); expect(result.body.config).not.toHaveProperty("title");
  });
  it("leaves durable pending changes visible after the editor's authorization is revoked", async () => {
    const { service, profile, agent } = await linked();
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, userId));
    try {
      await service.update(companyId, profile.id, { ...input, config: { ...input.config, capabilities: "Blocked" }, expectedVersion: 1, applyToLinked: true }, userId);
      expect((await service.get(companyId, profile.id)).bindings[0]).toMatchObject({ appliedVersion: 1, pendingVersion: 2, error: expect.any(String) });
      const [unchanged] = await db.select().from(agents).where(eq(agents.id, agent.id)); expect(unchanged.capabilities).toBe(input.config.capabilities);
    } finally { await db.update(companyMemberships).set({ status: "active" }).where(eq(companyMemberships.principalId, userId)); }
  });
});
