// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import type { ManagedProduct } from "@paperclipai/shared";
import { clearProductDraft, productDraftKey, readProductDraft, restoreProductDraft, writeProductDraft } from "./sourcing-product-draft";
const product: ManagedProduct = { id: "d".repeat(32), title: "원본", mainImage: "", description: "", categoryCode: "100", revision: 7, sourceProvider: "taobao", sourceProductId: "123", skus: [], listings: [] };
beforeEach(() => window.localStorage.clear());
it("round-trips large existing descriptions and 247 options, including unfinished invalid server input", () => {
  const large = { ...product, description: "긴".repeat(200001), skus: Array.from({ length: 247 }, (_, i) => ({ id: String(i), name: "", image: "", salePrice: -1, options: [{ name: "", value: "" }] })) };
  expect(writeProductDraft("company", "project", 7, large)).toBe(true);
  const read = readProductDraft("company", "project", product.id); expect(read.failed).toBe(false);
  expect(read.record?.product.description).toBe(large.description); expect(read.record?.product.skus).toEqual(large.skus);
  const current = { ...product, revision: 8, listings: [{ storeId: "s", remoteProductId: "new", state: "registered", publishedRevision: 8 }] };
  expect(restoreProductDraft(current, read.record!)).toMatchObject({ revision: 8, listings: current.listings, skus: large.skus });
});
it("never reports persistence success for a buffer that cannot pass the read contract", () => {
  expect(writeProductDraft("company", "project", 7, { ...product, description: "a".repeat(2000001) })).toBe(false);
  expect(window.localStorage.getItem(productDraftKey("company", "project", product.id))).toBeNull();
});
it("keeps other scope data separate and handles malformed records and denied storage", () => {
  writeProductDraft("one", "project", 7, product);
  expect(readProductDraft("two", "project", product.id)).toEqual({ record: null, failed: false });
  window.localStorage.setItem(productDraftKey("two", "project", product.id), "invalid");
  expect(readProductDraft("two", "project", product.id).failed).toBe(true);
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!;
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new DOMException("Denied"); } });
  try { expect(readProductDraft("one", "project", product.id).failed).toBe(true); expect(writeProductDraft("one", "project", 7, product)).toBe(false); expect(clearProductDraft("one", "project", product.id)).toBe(false); } finally { Object.defineProperty(window, "localStorage", descriptor); }
});
