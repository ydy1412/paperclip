import { describe, expect, it } from "vitest";
import { catalogRequestSchema, managedProductSchema } from "./sourcing-catalog.js";

const product = {
  id: "a".repeat(32), title: "Registered product", mainImage: "https://example.test/product.jpg",
  description: "", categoryCode: "123", revision: 1, sourceProvider: "coupang", sourceProductId: "12345",
  skus: [{ id: "sku-1", name: "Existing option", image: "", options: [{ name: "Color", value: "" }] }],
  listings: [{ storeId: "b".repeat(32), remoteProductId: "12345", state: "registered", publishedRevision: 1 }],
};

describe("registered catalog product readback", () => {
  it("reads existing empty option values without changing them or dropping the product", () => {
    const result = managedProductSchema.array().parse([product]);
    expect(result).toHaveLength(1);
    expect(result[0].skus[0].options).toEqual([{ name: "Color", value: "" }]);
    expect(result[0].listings).toEqual(product.listings);
  });

  it("still requires option values when saving a product", () => {
    const input = {
      operation: "save", companyId: "10000000-0000-4000-8000-000000000001",
      projectId: "10000000-0000-4000-8000-000000000002", productId: product.id,
      expectedRevision: product.revision, title: product.title, mainImage: product.mainImage,
      description: product.description, categoryCode: product.categoryCode, skus: product.skus,
    };
    expect(catalogRequestSchema.safeParse(input).success).toBe(false);
    expect(catalogRequestSchema.safeParse({ ...input, skus: [{ ...product.skus[0], options: [{ name: "Color", value: "Blue" }] }] }).success).toBe(true);
  });
});
