import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import request from "supertest";
import { companies, projects, companyMemberships, activityLog, createDb } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { dobiOrderRoutes } from "../routes/dobi-orders.js";
import { createDobiCredentialVault } from "../services/dobi-orders.js";
import { errorHandler } from "../middleware/error-handler.js";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";
import { isSecretSensitiveHttpRequest } from "../middleware/http-log-policy.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, home: string;
let routes: ReturnType<typeof dobiOrderRoutes>;
const companyId = randomUUID(), otherCompanyId = randomUUID(), projectId = randomUUID(), otherProjectId = randomUUID();
const owner = "dobi-fixture-user";
const base = `/api/companies/${companyId}/sourcing/projects/${projectId}/order-management`;
function app() {
  const app = express(); app.use(express.json({ limit: "16mb" }));
  app.use((req, _res, next) => {
    const kind = req.get("x-actor") ?? "board";
    req.actor = kind === "none" ? { type: "none", source: "none" } : kind === "agent"
      ? { type: "agent", source: "agent_key", companyId, agentId: randomUUID() }
      : { type: "board", source: kind === "other" ? "session" : "local_implicit", userId: owner, companyIds: [kind === "other" ? otherCompanyId : companyId] };
    next();
  });
  app.use("/api", routes.bridge, boardMutationGuard(), routes.router); app.use(errorHandler); return app;
}
beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "dovix-dobi-tests-"));
  vi.stubEnv("PAPERCLIP_HOME", home); vi.stubEnv("PAPERCLIP_INSTANCE_ID", "dobi-test");
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", ""); vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", path.join(home, "master.key"));
  database = await startEmbeddedPostgresTestDatabase("dovix-dobi-db-"); db = createDb(database.connectionString);
  await db.insert(companies).values([{ id: companyId, name: "Dobi test", issuePrefix: "DT" }, { id: otherCompanyId, name: "Other", issuePrefix: "DO" }]);
  await db.insert(projects).values([{ id: projectId, companyId, name: "Orders" }, { id: otherProjectId, companyId: otherCompanyId, name: "Other" }]);
  await db.insert(companyMemberships).values({ companyId, principalId: owner, principalType: "user", status: "active", membershipRole: "owner" });
  routes = dobiOrderRoutes(db, { dataRoot: path.join(home, "orders") });
}, 90000);
afterAll(async () => { await routes?.close(); await database?.cleanup(); vi.unstubAllEnvs(); if (home) await rm(home, { recursive: true, force: true }); });

describe("Dobi Orders hosted domain", () => {
  it("requires board membership and rejects another company's project", async () => {
    expect((await request(app()).get(`${base}/bootstrap`).set("x-actor", "none")).status).toBe(403);
    expect((await request(app()).get(`${base}/orders`).set("x-actor", "agent")).status).toBe(403);
    expect((await request(app()).get(`${base}/orders`).set("x-actor", "other")).status).toBe(403);
    expect((await request(app()).get(base.replace(projectId, otherProjectId) + "/orders")).status).toBe(404);
  });
  it("persists real SQLite orders and preserves versions, local work and export", async () => {
    const created = await request(app()).post(`${base}/orders`).send({ channel: "쿠팡", account: "테스트", orderNo: "SYNTHETIC-1", lineId: "A", product: "합성 테스트 상품", quantity: 1, unitPrice: 10000 });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await request(app()).patch(`${base}/orders/${id}`).send({ expectedVersion: 1, patch: { workMemo: "검수 완료" } })).status).toBe(200);
    expect((await request(app()).patch(`${base}/orders/${id}`).send({ expectedVersion: 1, patch: { workMemo: "오래된 수정" } })).status).toBe(409);
    expect((await request(app()).get(`${base}/orders/${id}`)).body.order.workMemo).toBe("검수 완료");
    expect((await request(app()).get(`${base}/export?format=xlsx`)).headers["content-type"]).toContain("spreadsheetml");
    const other = (await db.insert(projects).values({ companyId, name: "Separate orders" }).returning())[0];
    expect((await request(app()).get(base.replace(projectId, other.id) + "/orders")).body.total).toBe(0);
    await routes.close(); routes = dobiOrderRoutes(db, { dataRoot: path.join(home, "orders") });
    expect((await request(app()).get(`${base}/orders/${id}`)).body.order.workMemo).toBe("검수 완료");
  });
  it("uses encrypted host credentials and reloads references without exposing values", async () => {
    const vault = await createDobiCredentialVault(db, companyId, projectId);
    await vault.set("fixture-key", { token: "SYNTHETIC-DOBI-SECRET" });
    const reloaded = await createDobiCredentialVault(db, companyId, projectId);
    expect(reloaded.has("fixture-key")).toBe(true); expect((await reloaded.get("fixture-key")).token).toBe("SYNTHETIC-DOBI-SECRET");
    expect((await request(app()).get(`${base}/backup`)).text).not.toContain("SYNTHETIC-DOBI-SECRET");
    expect((await readFile(path.join(home, "orders", companyId, projectId, "orders.sqlite"))).includes(Buffer.from("SYNTHETIC-DOBI-SECRET"))).toBe(false);
    await reloaded.set("fixture-key", { token: "SYNTHETIC-ROTATED" }); expect((await reloaded.get("fixture-key")).token).toBe("SYNTHETIC-ROTATED");
    await reloaded.remove("fixture-key"); expect(reloaded.has("fixture-key")).toBe(false);
  });
  it("reflects DB reference edits and supports persisted drafts and business mapping", async () => {
    expect((await request(app()).put(`${base}/reference/carriers`).send(["합성 택배사"])).status).toBe(200);
    expect((await request(app()).get(`${base}/bootstrap`)).body.carriers).toEqual(["합성 택배사"]);
    await request(app()).put(`${base}/drafts/order-new`).send({ values: { product: "입력 중인 상품" }, version: "" });
    expect((await request(app()).get(`${base}/drafts/order-new`)).body.values.product).toBe("입력 중인 상품");
    const business = await request(app()).post(`${base}/businesses`).send({ name: "합성 사업자" }); expect(business.status).toBe(201);
    await request(app()).post(`${base}/account-business`).send({ channel: "쿠팡", account: "테스트", businessId: business.body.id });
    expect((await request(app()).get(`${base}/orders?businessId=${business.body.id}`)).body.total).toBe(1);
  });
  it("pairs the browser helper with a scoped, revocable owner grant", async () => {
    const code = (await request(app()).post(`${base}/bridge/pair-code`).send({})).body.code;
    const origin = "chrome-extension://" + "a".repeat(32);
    const pair = await request(app()).post(`${base}/bridge/pair`).set("x-actor", "none").set("Origin", origin).send({ code });
    expect(pair.status).toBe(200); expect(pair.headers["access-control-allow-origin"]).toBe(origin);
    await vi.waitFor(async () => {
      const events = await db.select().from(activityLog).where(eq(activityLog.companyId, companyId));
      const event = events.find(e => e.action === "dobi_orders.bridge_changed");
      expect(event).toMatchObject({ actorType: "user", actorId: owner, details: { method: "POST", operation: "pair" } });
      expect(JSON.stringify(event)).not.toContain(pair.body.token);
    });
    expect((await request(app()).get(`${base}/bridge/context`).set("x-actor", "none").set("x-dobi-bridge", pair.body.token)).status).toBe(200);
    expect((await request(app()).get(`${base}/orders`).set("x-actor", "none").set("x-dobi-bridge", pair.body.token)).status).toBe(403);
    expect((await request(app()).get(`${base}/bridge/context`).set("x-actor", "none").set("x-dobi-bridge", pair.body.token).set("Origin", "https://untrusted.example")).status).toBe(403);
    expect((await request(app()).post(`${base}/bridge/pair`).set("x-actor", "none").send({ code })).status).toBe(403);
  });
  it("redacts hosted credential and private import request bodies", () => {
    expect(isSecretSensitiveHttpRequest("POST", `${base}/connections`)).toBe(true);
    expect(isSecretSensitiveHttpRequest("POST", `${base}/connections/id/wing-login`)).toBe(true);
    expect(isSecretSensitiveHttpRequest("POST", `${base}/connections/id/seller-login`)).toBe(true);
    expect(isSecretSensitiveHttpRequest("PUT", `${base}/drafts/order-new`)).toBe(true);
  });
  it("scopes login status and mutations and rejects the Windows login action", async () => {
    const created = await request(app()).post(`${base}/connections`).send({ providerId: "coupang", name: "Synthetic session account", mode: "wing", sellerId: "synthetic-wing", credentials: { password: "synthetic-password" } });
    expect(created.status).toBe(201);
    const login = `${base}/connections/${created.body.id}/wing-login`;
    expect((await request(app()).get(login)).body.pending).toBe(false);
    for (const actor of ["none", "agent", "other"]) {
      expect((await request(app()).get(login).set("x-actor", actor)).status).toBe(403);
      expect((await request(app()).post(login).set("x-actor", actor).send({ step: "start" })).status).toBe(403);
    }
    expect((await request(app()).post(login).send({ step: "native" })).status).toBe(409);
    expect((await request(app()).post(login).send({ step: "cancel" })).body.cancelled).toBe(true);
  });
});
