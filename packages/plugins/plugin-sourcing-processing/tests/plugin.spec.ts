import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("product-only processing plugin", () => {
  it("declares product and immutable source tools with scoped native capabilities", () => {
    expect(pluginManifestV1Schema.parse(manifest).tools?.map(t => t.name)).toEqual(["get-processing-source", "list-sourcing-workspace", "start-managed-processing", "list-managed-products", "get-managed-product", "list-product-stores", "save-managed-product", "recommend-coupang-category", "get-coupang-category-metadata"]);
    expect(manifest.capabilities).toEqual(["agent.tools.register", "auto-sourcing.products.read", "auto-sourcing.drafts.write"]);
  });
  it("reads original source options through the authorized processing read bridge", async () => {
    const harness = createTestHarness({ manifest });
    const source = { sourceHash: "original-hash", skus: [{ skuId: "sku", options: [{ value: "原文禁止" }] }] };
    const read = vi.spyOn(harness.ctx.autoSourcing, "processingRead").mockResolvedValue(source);
    const write = vi.spyOn(harness.ctx.autoSourcing, "processingWrite");
    const catalogWrite = vi.spyOn(harness.ctx.autoSourcing, "catalogWrite");
    await plugin.definition.setup(harness.ctx);
    const result = await harness.executeTool("get-processing-source", { companyId: "forged", projectId: "p", accountId: "a", sourceProvider: "taobao", productId: "original" }, { companyId: "actual" });
    expect(read).toHaveBeenCalledWith({ companyId: "actual", projectId: "p", accountId: "a", sourceProvider: "taobao", productId: "original", operation: "source" });
    expect(result.data).toEqual(source);
    expect(write).not.toHaveBeenCalled();
    expect(catalogWrite).not.toHaveBeenCalled();
  });
  it("routes category operations through the read bridge and run company", async () => {
    const harness = createTestHarness({ manifest });
    const read = vi.spyOn(harness.ctx.autoSourcing, "catalogRead").mockResolvedValue({ code: 77968, name: "일반책상" });
    const write = vi.spyOn(harness.ctx.autoSourcing, "catalogWrite");
    await plugin.definition.setup(harness.ctx);
    await harness.executeTool("recommend-coupang-category", { companyId: "forged", projectId: "p", storeId: "s", productName: "책상" }, { companyId: "actual" });
    expect(read).toHaveBeenLastCalledWith({ companyId: "actual", projectId: "p", operation: "category-recommend", storeId: "s", productName: "책상" });
    await harness.executeTool("get-coupang-category-metadata", { projectId: "p", storeId: "s", categoryCode: 77968 }, { companyId: "actual" });
    expect(read).toHaveBeenLastCalledWith({ companyId: "actual", projectId: "p", operation: "category-metadata", storeId: "s", categoryCode: 77968 });
    expect(write).not.toHaveBeenCalled();
  });
  it("discovers raw sources and propagates full-scope search/page using run company", async () => {
    const harness = createTestHarness({ manifest });
    const read = vi.spyOn(harness.ctx.autoSourcing, "catalogRead").mockResolvedValue({ items: [], totalCount: 0 });
    await plugin.definition.setup(harness.ctx);
    await harness.executeTool("list-sourcing-workspace", { companyId: "forged", projectId: "p", stage: "unprocessed", query: "desk", page: 2 }, { companyId: "actual" });
    expect(read).toHaveBeenLastCalledWith({ companyId: "actual", projectId: "p", operation: "workspace", stage: "unprocessed", query: "desk", page: 2 });
    await harness.executeTool("list-managed-products", { projectId: "p", view: "uploads", query: "책상", page: 3 }, { companyId: "actual" });
    expect(read).toHaveBeenLastCalledWith({ companyId: "actual", projectId: "p", operation: "list", view: "uploads", query: "책상", page: 3 });
  });
  it("starts and saves only through the native authorized write bridge", async () => {
    const harness = createTestHarness({ manifest });
    const write = vi.spyOn(harness.ctx.autoSourcing, "catalogWrite").mockResolvedValue({ id: "product", revision: 2 });
    const read = vi.spyOn(harness.ctx.autoSourcing, "catalogRead");
    await plugin.definition.setup(harness.ctx);
    await harness.executeTool("start-managed-processing", { companyId: "forged", projectId: "p", sourceProvider: "taobao", sourceProductId: "709366335630" }, { companyId: "actual" });
    expect(write).toHaveBeenLastCalledWith({ companyId: "actual", projectId: "p", operation: "source", sourceProvider: "taobao", sourceProductId: "709366335630" });
    await harness.executeTool("save-managed-product", { projectId: "p", productId: "product", expectedRevision: 1, title: "가공", skus: [{ id: "sku", salePrice: null }] }, { companyId: "actual" });
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ operation: "save", companyId: "actual", expectedRevision: 1, skus: [{ id: "sku", salePrice: null }] }));
    expect(read).not.toHaveBeenCalled();
  });
});
