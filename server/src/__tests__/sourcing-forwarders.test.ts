import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { companies, projects, companySecrets, companySecretVersions, sourcingForwarders, sourcingForwarderProviders, activityLog, createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { sourcingForwarderRoutes } from "../routes/sourcing-forwarders.js";
import { sourcingForwarderService } from "../services/sourcing-forwarders.js";
import { secretService } from "../services/secrets.js";
import { errorHandler } from "../middleware/error-handler.js";
import { isSecretSensitiveHttpRequest } from "../middleware/http-log-policy.js";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;
const companyId = randomUUID(), otherCompanyId = randomUUID(), projectId = randomUUID(), otherProjectId = randomUUID();
const nextProviderId = "bdc81085-726e-451b-a4ef-57b12b4deced", customProviderId = randomUUID();
const input = { providerId: nextProviderId, loginId: "synthetic-forwarder-user", password: "synthetic-forwarder-password", enabled: true };
const open = vi.fn().mockResolvedValue({ status: "login_submitted", browser: "chrome" });
const base = `/api/companies/${companyId}/sourcing/projects/${projectId}/forwarders`;
function app() {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.actor = req.header("x-agent") ? { type: "agent", companyId, agentId: randomUUID(), source: "agent_jwt" } : { type: "board", userId: "owner", source: req.header("x-session") ? "session" : "board_key", companyIds: [companyId] }; next(); });
  app.use("/api", boardMutationGuard()); app.use("/api", sourcingForwarderRoutes(db, open)); app.use(errorHandler); return app;
}
beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "dovix-forwarders-")); vi.stubEnv("PAPERCLIP_HOME", home); vi.stubEnv("PAPERCLIP_INSTANCE_ID", "forwarders-test");
  // Never use an ambient operating key when testing credential encryption.
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", ""); vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", path.join(home, "master.key"));
  database = await startEmbeddedPostgresTestDatabase("dovix-forwarder-db-"); db = createDb(database.connectionString);
  await db.insert(sourcingForwarderProviders).values({ id: customProviderId, key: "fixture-provider", name: "Synthetic provider", homepageUrl: "https://example.com/", loginUrl: "https://example.com/login" });
  await db.insert(companies).values([{ id: companyId, name: "Forwarders test", issuePrefix: "FT" }, { id: otherCompanyId, name: "Other", issuePrefix: "FO" }]);
  await db.insert(projects).values([{ id: projectId, companyId, name: "Sourcing" }, { id: otherProjectId, companyId: otherCompanyId, name: "Other" }]);
}, 90000);
afterAll(async () => { await database?.cleanup(); vi.unstubAllEnvs(); if (home) await rm(home, { recursive: true, force: true }); });

describe("shipping forwarder credentials and authorization", () => {
  it("reflects DB catalog entries immediately and rejects URL injection, unknown and disabled providers", async () => {
    const providers = await request(app()).get(`${base}/providers`); expect(providers.status).toBe(200);
    expect(providers.body).toContainEqual(expect.objectContaining({ id: nextProviderId, name: "넥스트배송" }));
    const id = randomUUID(); await db.insert(sourcingForwarderProviders).values({ id, key: `test-${id}`, name: "New catalog fixture", homepageUrl: "https://fixture.example/", loginUrl: "https://fixture.example/login" });
    expect((await request(app()).get(`${base}/providers`)).body).toContainEqual(expect.objectContaining({ id }));
    const service = sourcingForwarderService(db, open), registered = await service.create(companyId, projectId, { ...input, providerId: id });
    expect(registered).toMatchObject({ providerId: id, homepageUrl: "https://fixture.example/", loginUrl: "https://fixture.example/login" });
    expect((await request(app()).post(base).send({ ...input, loginUrl: "https://untrusted.invalid" })).status).toBe(400);
    expect((await request(app()).post(base).send({ ...input, providerId: randomUUID() })).status).toBe(400);
    await db.update(sourcingForwarderProviders).set({ enabled: false }).where(eq(sourcingForwarderProviders.id, id));
    expect((await request(app()).post(base).send({ ...input, providerId: id })).status).toBe(400);
    await expect(service.open(companyId, projectId, registered.id)).rejects.toThrow("사용 가능한");
  });
  it("keeps same-provider accounts independent when opening or deleting one of several registrations", async () => {
    const service = sourcingForwarderService(db, open);
    const first = await service.create(companyId, projectId, input);
    const secondAccount = { loginId: "synthetic-second-user", password: "synthetic-second-password" };
    const second = await service.create(companyId, projectId, { ...input, ...secondAccount });
    expect(first.id).not.toBe(second.id);
    const [firstStored] = await db.select().from(sourcingForwarders).where(eq(sourcingForwarders.id, first.id));
    const [secondStored] = await db.select().from(sourcingForwarders).where(eq(sourcingForwarders.id, second.id));
    expect(firstStored.credentialSecretId).not.toBe(secondStored.credentialSecretId);
    expect(await service.list(companyId, projectId)).toEqual(expect.arrayContaining([first, second]));
    await service.open(companyId, projectId, first.id);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ id: first.id, credentials: { loginId: input.loginId, password: input.password } }));
    await service.open(companyId, projectId, second.id);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ id: second.id, credentials: secondAccount }));
    await service.remove(companyId, projectId, first.id);
    const remaining = await service.list(companyId, projectId);
    expect(remaining).not.toContainEqual(first);
    expect(remaining).toContainEqual(second);
    await service.open(companyId, projectId, second.id);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ id: second.id, credentials: secondAccount }));
  });
  it("persists encrypted credentials, returns redacted metadata after reload and submits only server-resolved credentials", async () => {
    const res = await request(app()).post(base).send(input);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ name: expect.stringContaining("넥스트배송"), providerId: nextProviderId, credentialConfigured: true, automaticLogin: true });
    expect(JSON.stringify(res.body)).not.toContain(input.password); expect(JSON.stringify(res.body)).not.toContain(input.loginId);
    expect(res.headers["cache-control"]).toBe("no-store");
    const [stored] = await db.select().from(sourcingForwarders).where(eq(sourcingForwarders.id, res.body.id));
    const versions = await db.select().from(companySecretVersions).where(eq(companySecretVersions.secretId, stored.credentialSecretId));
    expect(JSON.stringify(versions)).not.toContain(input.password); expect(JSON.stringify(versions)).not.toContain(input.loginId);
    const reloaded = await request(app()).get(base); expect(reloaded.body).toContainEqual(res.body);
    const launched = await request(app()).post(`${base}/${res.body.id}/open`).send({});
    expect(launched.status).toBe(200); expect(launched.body).toEqual({ status: "login_submitted", browser: "chrome" });
    expect(open).toHaveBeenLastCalledWith({ id: res.body.id, companyId, loginUrl: "https://www.next1688.com/Front/Join/Login.asp?gMnu1=207&gMnu2=20702", credentials: { loginId: input.loginId, password: input.password } });
    const audits = await db.select().from(activityLog).where(eq(activityLog.entityId, res.body.id));
    expect(audits.map(row => row.action)).toContain("sourcing.forwarder_opened");
    expect(JSON.stringify(audits)).not.toContain(input.password); expect(JSON.stringify(audits)).not.toContain(input.loginId);
  });
  it("preserves blank-update credentials, rotates a replacement and removes the secret on deletion", async () => {
    const service = sourcingForwarderService(db, open); const row = await service.create(companyId, projectId, input);
    const { loginId: _loginId, password: _password, ...metadata } = input;
    await service.update(companyId, projectId, row.id, { ...metadata, name: "Renamed" });
    const [stored] = await db.select().from(sourcingForwarders).where(eq(sourcingForwarders.id, row.id));
    const secrets = secretService(db);
    expect(JSON.parse(await secrets.resolveSecretValue(companyId, stored.credentialSecretId, "latest"))).toEqual({ loginId: input.loginId, password: input.password });
    await service.update(companyId, projectId, row.id, { ...metadata, loginId: "replacement-user", password: "replacement-password" });
    expect(JSON.parse(await secrets.resolveSecretValue(companyId, stored.credentialSecretId, "latest"))).toEqual({ loginId: "replacement-user", password: "replacement-password" });
    await service.remove(companyId, projectId, row.id);
    expect(await service.list(companyId, projectId)).not.toContainEqual(row);
    await expect(secrets.resolveSecretValue(companyId, stored.credentialSecretId, "latest")).rejects.toThrow();
  });
  it("blocks unauthenticated agents, other-company projects and cross-project ID access before opening", async () => {
    const row = await sourcingForwarderService(db, open).create(companyId, projectId, input); open.mockClear();
    expect((await request(app()).post(base).set("x-agent", "yes").send(input)).status).toBe(403);
    expect((await request(app()).get(base.replace(companyId, otherCompanyId))).status).toBe(403);
    expect((await request(app()).post(base.replace(projectId, otherProjectId)).send(input)).status).toBe(404);
    const [sameCompanyProject] = await db.insert(projects).values({ companyId, name: "Other sourcing" }).returning();
    expect((await request(app()).post(`${base.replace(projectId, sameCompanyProject.id)}/${row.id}/open`).send({})).status).toBe(404);
    expect(open).not.toHaveBeenCalled();
  });
  it("rejects invalid URLs and mismatched credential updates without writing secrets", async () => {
    const before = await db.select().from(companySecrets).where(eq(companySecrets.companyId, companyId));
    for (const url of ["not-a-url", "", "http://www.next1688.com/", "https://user:password@www.next1688.com/", "https://www.next1688.com/#secret"]) {
      expect((await request(app()).post(base).send({ ...input, homepageUrl: url })).status).toBe(400);
    }
    expect((await request(app()).post(base).send({ ...input, loginUrl: "https://example.com/login" })).status).toBe(400);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.companyId, companyId))).toHaveLength(before.length);
    const row = await sourcingForwarderService(db, open).create(companyId, projectId, input);
    const { password: _password, ...incomplete } = input;
    expect((await request(app()).patch(`${base}/${row.id}`).send(incomplete)).status).toBe(400);
    const { loginId: _loginId, ...metadata } = incomplete;
    expect((await request(app()).patch(`${base}/${row.id}`).send({ ...metadata, homepageUrl: "https://example.com/", loginUrl: "https://example.com/login" })).status).toBe(400);
  });
  it("never opens disabled or archived resources and custom sites receive no decrypted credentials", async () => {
    const service = sourcingForwarderService(db, open); const row = await service.create(companyId, projectId, { ...input, enabled: false }); open.mockClear();
    await expect(service.open(companyId, projectId, row.id)).rejects.toThrow("비활성"); expect(open).not.toHaveBeenCalled();
    const custom = await service.create(companyId, projectId, { ...input, providerId: customProviderId });
    await service.open(companyId, projectId, custom.id); expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ credentials: { loginId: "", password: "" } }));
    await db.update(projects).set({ archivedAt: new Date() }).where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)));
    try { await expect(service.open(companyId, projectId, custom.id)).rejects.toThrow("프로젝트"); }
    finally { await db.update(projects).set({ archivedAt: null }).where(eq(projects.id, projectId)); }
  });
  it("classifies credential-bearing failures as private HTTP events", () => {
    expect(isSecretSensitiveHttpRequest("POST", base)).toBe(true);
    expect(isSecretSensitiveHttpRequest("PATCH", `${base}/${randomUUID()}`)).toBe(true);
    expect(isSecretSensitiveHttpRequest("POST", `${base}/${randomUUID()}/open`)).toBe(true);
  });
  it("preserves the browser-session origin guard before credential mutations", async () => {
    const before = await db.select().from(sourcingForwarders);
    expect((await request(app()).post(base).set("x-session", "yes").set("Origin", "https://untrusted.invalid").send(input)).status).toBe(403);
    expect(await db.select().from(sourcingForwarders)).toHaveLength(before.length);
  });
  it("pins credentials to their URL snapshot instead of picking up unrelated latest-secret rotations", async () => {
    const service = sourcingForwarderService(db, open);
    const row = await service.create(companyId, projectId, input);
    const [stored] = await db.select().from(sourcingForwarders).where(eq(sourcingForwarders.id, row.id));
    await secretService(db).rotate(stored.credentialSecretId, { value: JSON.stringify({ loginId: "other-site-user", password: "other-site-password" }) });
    await service.open(companyId, projectId, row.id);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ credentials: { loginId: input.loginId, password: input.password } }));
    const { loginId: _loginId, password: _password, ...metadata } = input;
    await service.update(companyId, projectId, row.id, { ...metadata, loginId: "updated-user", password: "updated-password" });
    await service.open(companyId, projectId, row.id);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ credentials: { loginId: "updated-user", password: "updated-password" } }));
  });
});
