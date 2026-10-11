import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { issues } from "@paperclipai/db";
import { managedProductSchema } from "@paperclipai/shared";
import { startProcessingFixture } from "./helpers/sourcing-processing-fixture.js";
import { processingSourceSchema } from "../services/auto-sourcing-processing-contract.js";

let f: Awaited<ReturnType<typeof startProcessingFixture>>;
beforeAll(async () => { f = await startProcessingFixture("synthetic", true); }, 90000);
afterAll(async () => { await f?.close(); });
it("processes an actual raw source through the new worker, native authority, HTTP and SQLite", async () => {
  expect((await f.tool("list-sourcing-workspace", { stage: "unprocessed" })).data).toMatchObject([{ kind: "source", source: { sourceProductId: f.productId } }]);
  const original = processingSourceSchema.parse((await f.tool("get-processing-source", { accountId: f.accountId, sourceProvider: "taobao", productId: f.productId })).data);
  const created = managedProductSchema.parse((await f.tool("start-managed-processing", { sourceProvider: "taobao", sourceProductId: f.productId })).data);
  expect(managedProductSchema.parse((await f.tool("start-managed-processing", { sourceProvider: "taobao", sourceProductId: f.productId })).data).id).toBe(created.id);
  const translated = created.skus.map((sku, index) => ({ ...sku, name: index ? "파랑 10cm 2개" : "빨강 10cm 2개", options: sku.options.map(option => ({ ...option, name: "색상", value: index ? "파랑 10cm 2개" : "빨강 10cm 2개" })) }));
  const saved = managedProductSchema.parse((await f.tool("save-managed-product", { productId: created.id, expectedRevision: created.revision, title: "한국어 상품", mainImage: created.mainImage, description: "<p>원본 기반 설명</p>", categoryCode: created.categoryCode, skus: translated })).data);
  const read = managedProductSchema.parse((await f.tool("get-managed-product", { productId: saved.id })).data);
  expect(read).toEqual(saved); expect(read.revision).toBe(2); expect(read.skus).toEqual(translated);
  expect(read.skus.map(sku => sku.id)).toEqual(created.skus.map(sku => sku.id));
  expect(read.skus[0].options[0].value).not.toBe(original.skus[0].options[0].value);
  expect(processingSourceSchema.parse((await f.tool("get-processing-source", { accountId: f.accountId, sourceProvider: "taobao", productId: f.productId })).data)).toEqual(original);
  expect((await f.tool("list-managed-products", { view: "source", query: "없는 상품" })).data).toEqual([]);
  expect((await f.tool("list-managed-products", { view: "source", query: "한국어" })).data).toHaveLength(1);
  await expect(f.tool("start-managed-processing", { sourceProvider: "taobao", sourceProductId: "unbound" })).rejects.toThrow();
  await expect(f.tool("get-processing-source", { sourceProvider: "taobao", productId: f.productId, accountId: "foreign" })).rejects.toThrow("판매 계정");
  await expect(f.tool("get-processing-source", { accountId: f.accountId, sourceProvider: "taobao", productId: "unbound" })).rejects.toThrow("허용된 원본");
  await dbMismatch();
});
async function dbMismatch() {
  await f.db.update(issues).set({ projectId: null }).where(eq(issues.id, f.issue.id));
  await expect(f.tool("get-managed-product", { productId: "a".repeat(32) })).rejects.toThrow("에이전트 작업");
}
