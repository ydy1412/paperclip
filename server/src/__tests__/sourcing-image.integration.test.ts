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
