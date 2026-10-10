import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHostClientHandlers, CapabilityDeniedError } from "@paperclipai/plugin-sdk";
import { managedProductSchema, storeSettingsSchema } from "@paperclipai/shared";
import { startProcessingFixture } from "./helpers/sourcing-processing-fixture.js";
import express from "express";
import request from "supertest";
import { sourcingCatalogRoutes } from "../routes/sourcing-catalog.js";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";
import { errorHandler } from "../middleware/error-handler.js";
import { isSecretSensitiveHttpRequest } from "../middleware/http-log-policy.js";

describe("catalog real worker/host/HTTP/SQLite and credential vault", () => {
  let f: Awaited<ReturnType<typeof startProcessingFixture>>;
  beforeAll(async () => { f = await startProcessingFixture(); }, 90000);
  afterAll(async () => { await f?.close(); });
  it("requires a board actor and trusted mutation origin on the actual HTTP settings route", async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = req.header("x-agent") ? { type: "agent", companyId: f.companyId, agentId: f.agent.id, source: "agent_jwt" } : { type: "board", userId: "fixture-operator", source: req.header("x-session") ? "session" : "board_key", companyIds: [f.companyId] }; next(); });
    app.use("/api", boardMutationGuard()); app.use("/api", sourcingCatalogRoutes(f.db, { processingPort: Number(new URL(f.url).port) })); app.use(errorHandler);
    const url = `/api/companies/${f.companyId}/sourcing/projects/${f.projectId}/catalog`;
    expect((await request(app).post(url).set("x-agent", "yes").send({ operation: "settings" })).status).toBe(403);
    expect((await request(app).post(url).set("x-session", "yes").set("Origin", "https://untrusted.example.test").send({ operation: "business", name: "forged" })).status).toBe(403);
    const response = await request(app).post(url).send({ operation: "settings", companyId: "11111111-1111-4111-8111-111111111111" });
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.businesses).toEqual([]);
    expect(isSecretSensitiveHttpRequest("POST", url)).toBe(true);
  });
  it("registers multiple businesses/stores, scopes existing accounts and never returns connection secrets", async () => {
    const scope = { companyId: f.companyId, projectId: f.projectId }; const context = { invocationScope: { companyId: f.companyId } };
    const one = storeSettingsSchema.parse(await f.service.operatorSettings({ ...scope, operation: "business", name: "사업자 A", registrationNumber: "1234567890" }, context));
    const businessId = one.businesses[0].id;
    await f.service.operatorSettings({ ...scope, operation: "business", name: "사업자 B" }, context);
    const attach = storeSettingsSchema.parse(await f.service.operatorSettings({ ...scope, operation: "attach", businessId, accountId: f.accountId }, context));
    expect(attach.stores).toHaveLength(1);
    const settings = storeSettingsSchema.parse(await f.service.operatorSettings({ ...scope, operation: "store", businessId, provider: "coupang", name: "쿠팡 두 번째", credentials: { vendorId: "synthetic-second", accessKey: "synthetic-access", secretKey: "synthetic-secret" } }, context));
    expect(settings.businesses).toHaveLength(2); expect(settings.stores).toHaveLength(2); expect(JSON.stringify(settings)).not.toContain("synthetic-secret");
    const agentSettings = storeSettingsSchema.parse((await f.tool("list-product-stores")).data);
    expect(agentSettings.businesses.every(b => b.registrationNumber === "")).toBe(true); expect(JSON.stringify(agentSettings)).not.toContain("synthetic-secret");
    await expect(f.service.operatorSettings({ ...scope, operation: "attach", businessId, accountId: "b".repeat(32) }, context)).rejects.toThrow("허용된 기존");
    await expect(f.service.operatorSettings({ ...scope, operation: "business", name: "forged" }, { invocationScope: { companyId: "11111111-1111-4111-8111-111111111111" } })).rejects.toThrow("회사 범위");
  });
  it("uses the same editable product through native agent tools and blocks publishing and credentials from agent RPC", async () => {
    const scope = { companyId: f.companyId, projectId: f.projectId }; const context = { invocationScope: { companyId: f.companyId } };
    const created = managedProductSchema.parse(await f.service.catalogWrite({ ...scope, operation: "source", sourceProvider: "taobao", sourceProductId: f.productId }, context));
    const saved = managedProductSchema.parse((await f.tool("save-managed-product", { productId: created.id, expectedRevision: created.revision, title: "책상 10cm", mainImage: created.mainImage, description: created.description, categoryCode: created.categoryCode, skus: created.skus })).data);
    expect(saved.revision).toBe(2); expect(saved.skus).toHaveLength(2);
    const read = managedProductSchema.parse((await f.tool("get-managed-product", { productId: created.id })).data); expect(read.title).toBe("책상 10cm");
    const list = (await f.tool("list-managed-products", { view: "source" })).data as unknown[]; expect(list).toHaveLength(1);
    await expect(f.service.catalogWrite({ ...scope, operation: "save", productId: created.id, expectedRevision: 1, title: "stale", mainImage: created.mainImage, description: "", categoryCode: "", skus: created.skus }, context)).rejects.toThrow("publication_conflict");
    const agent = { invocationScope: { companyId: f.companyId, agentRun: { agentId: f.agent.id, runId: f.run.id, projectId: f.projectId } } };
    await expect(f.service.catalogWrite({ ...scope, operation: "queue", productId: created.id, expectedRevision: 2, storeIds: ["a".repeat(32)], requestId: crypto.randomUUID() }, agent)).rejects.toThrow("운영 화면");
    await expect(f.service.operatorSettings({ ...scope, operation: "business", name: "forged" }, agent)).rejects.toThrow("운영 화면");
    await expect(f.tool("save-managed-product", { productId: created.id, credentials: { secretKey: "forged" } })).rejects.toThrow();
    const readOnly = createHostClientHandlers({ pluginId: f.plugin.id, capabilities: ["auto-sourcing.products.read"], services: { autoSourcing: f.service } });
    await expect(readOnly["autoSourcing.catalogWrite"]({ ...scope, operation: "source", sourceProvider: "taobao", sourceProductId: f.productId }, context)).rejects.toBeInstanceOf(CapabilityDeniedError);
  });
});
