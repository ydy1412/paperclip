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
    const workspace = await request(app).post(url).send({ operation: "workspace", stage: "unprocessed" });
    expect(workspace.status).toBe(200); expect(workspace.body).toHaveLength(1);
    expect(workspace.body[0]).toMatchObject({ kind: "source", stage: "unprocessed", source: { sourceProductId: f.productId } });
    const sized = await request(app).post(url).send({ operation: "workspace", stage: "unprocessed", pageSize: 100 });
    expect(sized.status).toBe(200); expect(sized.body).toEqual(workspace.body);
    const secondPage = await request(app).post(url).send({ operation: "workspace", stage: "unprocessed", pageSize: 50, page: 2 });
    expect(secondPage.status).toBe(200); expect(secondPage.body).toEqual([]);
    expect((await request(app).post(url).send({ operation: "workspace", pageSize: 101 })).status).toBe(400);
    const candidates = await request(app).post(url).send({ operation: "candidate-import" });
    expect(candidates.status).toBe(200); expect(candidates.body).toEqual({ imported: 0 });
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
    expect(await f.service.catalogRead({ ...scope, operation: "list", view: "source", query: " 책상 10CM " }, context)).toHaveLength(1);
    expect(await f.service.catalogRead({ ...scope, operation: "list", view: "source", query: "없는 키워드" }, context)).toEqual([]);
    expect(await f.service.catalogRead({ ...scope, operation: "stages", query: "없는 키워드" }, context)).toMatchObject({ all: 0, processing: 0 });
    const counts = await f.service.catalogRead({ ...scope, operation: "stages" }, context);
    expect(counts).toMatchObject({ all: 1, processing: 1, ready: 0, queued: 0, uploaded: 0, attention: 0 });
    expect(await f.service.catalogRead({ ...scope, operation: "list", view: "source", stage: "ready" }, context)).toEqual([]);
    await expect(f.service.catalogRead({ ...scope, operation: "stages" }, { invocationScope: { companyId: "11111111-1111-4111-8111-111111111111" } })).rejects.toThrow("회사 범위");
    await expect(f.service.catalogWrite({ ...scope, operation: "save", productId: created.id, expectedRevision: 1, title: "stale", mainImage: created.mainImage, description: "", categoryCode: "", skus: created.skus }, context)).rejects.toThrow("publication_conflict");
    const agent = { invocationScope: { companyId: f.companyId, agentRun: { agentId: f.agent.id, runId: f.run.id, projectId: f.projectId } } };
    await expect(f.service.catalogWrite({ ...scope, operation: "queue", productId: created.id, expectedRevision: 2, storeIds: ["a".repeat(32)], requestId: crypto.randomUUID() }, agent)).rejects.toThrow("운영 화면");
    await expect(f.service.operatorSettings({ ...scope, operation: "business", name: "forged" }, agent)).rejects.toThrow("운영 화면");
    await expect(f.tool("save-managed-product", { productId: created.id, credentials: { secretKey: "forged" } })).rejects.toThrow();
    const readOnly = createHostClientHandlers({ pluginId: f.plugin.id, capabilities: ["auto-sourcing.products.read"], services: { autoSourcing: f.service } });
    await expect(readOnly["autoSourcing.catalogWrite"]({ ...scope, operation: "source", sourceProvider: "taobao", sourceProductId: f.productId }, context)).rejects.toBeInstanceOf(CapabilityDeniedError);
    const prices = { productId: saved.id, expectedRevision: saved.revision, title: saved.title, mainImage: saved.mainImage, description: "<p>상세 설명</p>", categoryCode: saved.categoryCode, skus: saved.skus.map(s => ({ ...s, salePrice: 12000 })) };
    await expect(f.tool("save-managed-product", prices)).rejects.toThrow("price_confirmation_required");
    const confirmed = managedProductSchema.parse((await f.tool("save-managed-product", { ...prices, confirmPriceChanges: true })).data);
    expect(confirmed.skus.every(s => s.salePrice === 12000)).toBe(true); expect(confirmed.description).toBe("<p>상세 설명</p>");
    expect(await f.service.catalogRead({ ...scope, operation: "workspace" }, context)).toMatchObject([{ kind: "product", product: { id: saved.id, revision: 3 } }]);
    await expect(f.service.catalogWrite({ ...scope, operation: "candidate-import" }, agent)).rejects.toThrow("운영 화면");
  });
});

describe("catalog price confirmation across the real HTTP and provider boundaries", () => {
  let f: Awaited<ReturnType<typeof startProcessingFixture>>;
  beforeAll(async () => { f = await startProcessingFixture("catalog-browser"); }, 90000);
  afterAll(async () => { await f?.close(); });
  it("dispatches category reads on the board HTTP route without writing products", async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "board", userId: "fixture-operator", source: "board_key", companyIds: [f.companyId] }; next(); });
    app.use("/api", boardMutationGuard()); app.use("/api", sourcingCatalogRoutes(f.db, { processingPort: Number(new URL(f.url).port) })); app.use(errorHandler);
    const url = `/api/companies/${f.companyId}/sourcing/projects/${f.projectId}/catalog`;
    const settings = await request(app).post(url).send({ operation: "settings" });
    const storeId = settings.body.stores[0].id;
    const before = await request(app).post(url).send({ operation: "list", view: "uploads" });
    const recommendation = await request(app).post(url).send({ operation: "category-recommend", storeId, productName: "책상", companyId: crypto.randomUUID(), projectId: crypto.randomUUID() });
    expect(recommendation.status).toBe(200); expect(recommendation.body).toEqual({ code: 77968, name: "일반책상" });
    const metadata = await request(app).post(url).send({ operation: "category-metadata", storeId, categoryCode: recommendation.body.code });
    expect(metadata.status).toBe(200); expect(metadata.body.attributes[0]).toMatchObject({ name: "색상", required: true });
    expect((await request(app).post(url).send({ operation: "list", view: "uploads" })).body).toEqual(before.body);
  });
  it("accepts the backend confirmation hash and confirms the changed option price", async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "board", userId: "fixture-operator", source: "board_key", companyIds: [f.companyId] }; next(); });
    app.use("/api", boardMutationGuard()); app.use("/api", sourcingCatalogRoutes(f.db, { processingPort: Number(new URL(f.url).port) })); app.use(errorHandler);
    const url = `/api/companies/${f.companyId}/sourcing/projects/${f.projectId}/catalog`;
    const products = await request(app).post(url).send({ operation: "list", view: "uploads" });
    expect(products.status).toBe(200);
    const product = managedProductSchema.parse(products.body[0]);
    const saved = await request(app).post(url).send({ operation: "save", productId: product.id, expectedRevision: product.revision,
      title: product.title, mainImage: product.mainImage, description: product.description, categoryCode: product.categoryCode,
      skus: product.skus.map(s => ({ ...s, salePrice: 12000 })), confirmPriceChanges: true });
    expect(saved.status).toBe(200);
    const storeIds = [product.listings[0].storeId];
    const preview = await request(app).post(url).send({ operation: "price-preview", productId: product.id, expectedRevision: saved.body.revision, storeIds });
    expect(preview.status).toBe(200);
    expect(preview.body.confirmation).toMatch(/^[A-F0-9]{64}$/);
    expect(preview.body.stores[0].changes[0]).toMatchObject({ before: 10000, after: 12000 });
    const queued = await request(app).post(url).send({ operation: "queue", productId: product.id, expectedRevision: saved.body.revision,
      storeIds, requestId: crypto.randomUUID(), priceConfirmation: preview.body.confirmation });
    expect(queued.status).toBe(200);
    for (let n = 0; n < 100; n++) {
      const jobs = await request(app).post(url).send({ operation: "jobs" });
      const job = jobs.body.find((j: { id: string }) => j.id === queued.body[0].id);
      if (job.state === "succeeded") return;
      expect(["queued", "preparing", "sending", "readback_pending"]).toContain(job.state);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error("Price job did not reach verified completion");
  }, 30000);
});
