import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { companyMemberships, sourcingCaptureConnections, projects } from "@paperclipai/db";
import { startProcessingFixture } from "./helpers/sourcing-processing-fixture.js";
import { sourcingCaptureRoutes } from "../routes/sourcing-capture.js";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";
import { errorHandler } from "../middleware/error-handler.js";
import { isSecretSensitiveHttpRequest } from "../middleware/http-log-policy.js";

describe("capture-only ingress through real Dovix PostgreSQL and native HTTP/SQLite", () => {
  let f: Awaited<ReturnType<typeof startProcessingFixture>>, app: ReturnType<typeof express>, base: string, token: string, id: string;
  const snapshot = () => ({ provider: "taobao", productId: "987654321", url: "https://item.taobao.com/item.htm?id=987654321", title: "브라우저 수집 검증용 상품", capturedAt: new Date().toISOString(), description: null, skus: [], images: [{ role: "main", src: "https://img.alicdn.com/fixture.jpg" }] });
  const body = () => ({ requestId: crypto.randomUUID(), snapshot: snapshot() });
  beforeAll(async () => {
    f = await startProcessingFixture();
    await f.db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "user", principalId: "fixture-operator", status: "active", membershipRole: "owner" });
    app = express(); app.use(express.json({ limit: "512kb" }));
    const routes = sourcingCaptureRoutes(f.db, { processingPort: Number(new URL(f.url).port) });
    app.use(routes.ingress);
    app.use((req, _res, next) => { req.actor = req.header("x-agent") ? { type: "agent", companyId: f.companyId } : { type: "board", source: "board_key", userId: req.header("x-other-user") ? "other" : "fixture-operator", companyIds: [f.companyId] }; next(); });
    app.use("/api", boardMutationGuard(), routes.management); app.use(errorHandler);
    base = `/api/companies/${f.companyId}/sourcing/projects/${f.projectId}/capture-connections`;
  }, 90000);
  afterAll(async () => { await f?.close(); });
  it("issues one-time tokens, stores only hashes and prevents agent issuance", async () => {
    expect((await request(app).post(base).set("x-agent", "yes").send({ name: "forged" })).status).toBe(403);
    const created = await request(app).post(base).send({ name: "검증용 크롬" });
    expect(created.status).toBe(201); ({ token, id } = created.body);
    expect(token).toMatch(/^dvc_[A-Za-z0-9_-]{43}$/);
    const rows = await f.db.select().from(sourcingCaptureConnections); expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(rows)).not.toContain(token);
    const list = await request(app).get(base); expect(list.status).toBe(200); expect(list.body.connections).toHaveLength(1); expect(JSON.stringify(list.body)).not.toContain(token); expect(JSON.stringify(list.body)).not.toContain(rows[0].tokenHash);
    expect(isSecretSensitiveHttpRequest("POST", "/api/sourcing-capture")).toBe(true);
    expect(isSecretSensitiveHttpRequest("POST", base)).toBe(true);
  });
  it("requires capture auth, rejects caller scope, stores unprocessed originals and deduplicates lost acknowledgements", async () => {
    expect((await request(app).post("/api/sourcing-capture").send(body())).status).toBe(401);
    expect((await request(app).post("/api/sourcing-capture").set("Authorization", `Bearer ${token}`).send({ ...body(), companyId: crypto.randomUUID() })).status).toBe(400);
    const saved = await request(app).post("/api/sourcing-capture").set("Authorization", `Bearer ${token}`).send(body());
    expect(saved.status).toBe(200); expect(saved.body).toMatchObject({ status: "stored", sourceProductId: "987654321", missingFields: ["detailImages", "options", "price"] });
    const again = await request(app).post("/api/sourcing-capture").set("Authorization", `Bearer ${token}`).send({ ...body(), snapshot: { ...snapshot(), title: "덮어쓰지 말 것" } });
    expect(again.body).toMatchObject({ status: "already_saved", title: "브라우저 수집 검증용 상품" });
    const workspace = await f.service.catalogRead({ companyId: f.companyId, projectId: f.projectId, operation: "workspace" }, { invocationScope: { companyId: f.companyId } }) as any[];
    expect(workspace.find(x => x.source?.sourceProductId === "987654321")).toMatchObject({ kind: "source", stage: "unprocessed", source: { missingFields: ["detailImages", "options", "price"] } });
    expect((await request(app).get(base)).body.connections[0].lastUsedAt).toBeTruthy();
  });
  it("rechecks current membership, project state, expiry and revocation", async () => {
    const membership = and(eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, "fixture-operator"));
    await f.db.update(companyMemberships).set({ membershipRole: "viewer" }).where(membership);
    expect((await request(app).post("/api/sourcing-capture").set("Authorization", `Bearer ${token}`).send(body())).status).toBe(403);
    await f.db.update(companyMemberships).set({ membershipRole: "owner" }).where(membership);
    await f.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, f.projectId));
    expect((await request(app).post("/api/sourcing-capture").set("Authorization", `Bearer ${token}`).send(body())).status).toBe(403);
    await f.db.update(projects).set({ archivedAt: null }).where(eq(projects.id, f.projectId));
    expect((await request(app).delete(`${base}/${id}`).set("x-other-user", "yes")).status).toBe(404);
    expect((await request(app).post("/api/sourcing-capture").set("Authorization", `Bearer ${token}`).send(body())).status).toBe(200);
    await f.db.update(sourcingCaptureConnections).set({ expiresAt: new Date(0) }).where(eq(sourcingCaptureConnections.id, id));
    expect((await request(app).post("/api/sourcing-capture").set("Authorization", `Bearer ${token}`).send(body())).status).toBe(401);
    await f.db.update(sourcingCaptureConnections).set({ expiresAt: new Date(Date.now() + 60000) }).where(eq(sourcingCaptureConnections.id, id));
    expect((await request(app).delete(`${base}/${id}`)).status).toBe(204);
    expect((await request(app).post("/api/sourcing-capture").set("Authorization", `Bearer ${token}`).send(body())).status).toBe(401);
  });
});
