import { afterAll, beforeAll, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { startProcessingFixture } from "./helpers/sourcing-processing-fixture.js";
import { sourcingCatalogRoutes } from "../routes/sourcing-catalog.js";
import { errorHandler } from "../middleware/error-handler.js";

let f: Awaited<ReturnType<typeof startProcessingFixture>>;
beforeAll(async () => { f = await startProcessingFixture("image-processing", true); }, 90000);
afterAll(async () => { await f?.close(); });

it("executes image tools in the actual worker through host scope, native OCR/pixels and SQLite", async () => {
  const context = { invocationScope: { companyId: f.companyId } };
  const scope = { companyId: f.companyId, projectId: f.projectId };
  const product = await f.service.catalogWrite({ ...scope, operation: "source", sourceProvider: "taobao", sourceProductId: f.productId }, context) as { id: string; mainImage: string; revision: number };
  const provider = (await f.tool("get-image-provider-status", {})).data as { provider: string; configured: boolean; model: string };
  expect(provider).toMatchObject({ provider: "higgsfield", configured: false, model: "marketing_studio_image" });
  expect(JSON.stringify(provider)).not.toContain("secret");
  await expect(f.tool("process-product-image", { productId: product.id, imageUrl: product.mainImage, expectedRevision: product.revision, requestId: crypto.randomUUID(), provider: "higgsfield", removeAllText: true })).rejects.toThrow("higgsfield_not_configured");
  const image = { productId: product.id, imageUrl: product.mainImage };
  const inspected = (await f.tool("inspect-product-image", image)).data as { width: number; height: number; regions: unknown[] };
  expect(inspected).toMatchObject({ width: 600, height: 500 }); expect(inspected.regions.length).toBeGreaterThan(0);
  const input = { ...image, expectedRevision: product.revision, requestId: crypto.randomUUID(), removeChinese: true, cleanupRegions: [{ x: 15, y: 20, width: 225, height: 60 }], crop: { x: 0, y: 0, width: 600, height: 500 } };
  const processed = (await f.tool("process-product-image", input)).data as { assetId: string; imageUrl: string; sha256: string; productRevision: number; remainingChinese: unknown[]; cleanupRegions: unknown[] };
  expect(processed.productRevision).toBe(2); expect(processed.remainingChinese).toEqual([]);
  const png = (await f.tool("get-product-image", { productId: product.id, assetId: processed.assetId })).data as { base64: string; contentType: string };
  expect(Buffer.from(png.base64, "base64").subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  expect(processed.cleanupRegions).toEqual(input.cleanupRegions);
  expect((await f.tool("process-product-image", input)).data).toEqual(processed);
  await expect(f.tool("process-product-image", { ...input, requestId: crypto.randomUUID() })).rejects.toThrow("publication_conflict");
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.actor = { type: "board", source: "board_key", userId: "fixture", companyIds: [f.companyId] }; next(); });
  app.use("/api", sourcingCatalogRoutes(f.db, { processingPort: Number(new URL(f.url).port) })); app.use(errorHandler);
  const preview = await request(app).get(processed.imageUrl);
  expect(preview.status).toBe(200); expect(preview.headers["content-type"]).toContain("image/png");
  expect(preview.headers["cache-control"]).toBe("private, no-store");
  expect(preview.body).toEqual(Buffer.from(png.base64, "base64"));
  await expect(f.service.catalogRead({ ...scope, projectId: crypto.randomUUID(), operation: "image-content", productId: product.id, assetId: processed.assetId }, context)).rejects.toThrow();
}, 120000);

it("resumes the same cloud image request through the actual native plugin and owns the final preview", async () => {
  const cloud = await startProcessingFixture("higgsfield-processing", true);
  try {
    const context = { invocationScope: { companyId: cloud.companyId } };
    const scope = { companyId: cloud.companyId, projectId: cloud.projectId };
    const product = await cloud.service.catalogWrite({ ...scope, operation: "source", sourceProvider: "taobao", sourceProductId: cloud.productId }, context) as { id: string; mainImage: string; revision: number };
    expect((await cloud.tool("get-image-provider-status", {})).data).toMatchObject({ configured: true });
    const input = { productId: product.id, imageUrl: product.mainImage, expectedRevision: product.revision, requestId: crypto.randomUUID(), provider: "higgsfield", removeAllText: true };
    const pending = (await cloud.tool("process-product-image", input)).data as { status: string; requestId: string; providerRequestId: string; productId: string };
    expect(pending).toMatchObject({ status: "pending", requestId: input.requestId, productId: product.id });
    const processed = (await cloud.tool("process-product-image", input)).data as { assetId: string; imageUrl: string; sha256: string; providerRequestId: string; productRevision: number };
    expect(processed).toMatchObject({ provider: "higgsfield", providerRequestId: pending.providerRequestId, allTextRemovalRequested: true, reviewRequired: true, productRevision: product.revision + 1 });
    // The HTTPS provider fixture returns the original test pixels; OCR must expose their remaining digits.
    expect((processed as unknown as { remainingText: { text: string }[] }).remainingText.some(region => /\d/.test(region.text))).toBe(true);
    expect((await cloud.tool("process-product-image", input)).data).toEqual(processed);
    const png = (await cloud.tool("get-product-image", { productId: product.id, assetId: processed.assetId })).data as { base64: string };
    expect(Buffer.from(png.base64, "base64").subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    const current = await cloud.service.catalogRead({ ...scope, operation: "get", productId: product.id }, context) as { mainImage: string; revision: number };
    expect(current).toMatchObject({ mainImage: processed.imageUrl, revision: processed.productRevision });
    await expect(cloud.service.catalogRead({ ...scope, projectId: crypto.randomUUID(), operation: "image-provider-status" }, context)).rejects.toThrow();
  } finally { await cloud.close(); }
}, 120000);

it("exposes scoped server image jobs to agents but keeps automatic settings board owned", async () => {
  const context = { invocationScope: { companyId: f.companyId } };
  const scope = { companyId: f.companyId, projectId: f.projectId };
  expect((await f.tool("get-image-processing-jobs", {})).data).toEqual([]);
  const configured = await f.service.catalogWrite({ ...scope, operation: "image-job-configure", enabled: true, scanIntervalSeconds: 120 }, context);
  expect(configured).toMatchObject({ ...scope, enabled: true, scanIntervalSeconds: 120, workerEnabled: false });
  expect(await f.service.catalogRead({ ...scope, operation: "image-job-settings" }, context)).toEqual(configured);
  await expect(f.service.catalogRead({ ...scope, projectId: crypto.randomUUID(), operation: "image-jobs" }, context)).rejects.toThrow();
  await expect(f.service.catalogWrite({ ...scope, operation: "image-job-configure", enabled: false, scanIntervalSeconds: 60 }, { invocationScope: { companyId: f.companyId, agentRun: { agentId: f.agent.id, runId: f.run.id, projectId: f.projectId } } })).rejects.toThrow();
}, 30000);
