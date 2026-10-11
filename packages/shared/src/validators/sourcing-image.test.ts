import { expect, it } from "vitest";
import { catalogRequestSchema } from "./sourcing-catalog.js";

it("requires scoped original image identifiers, bounded integer crops and request identity", () => {
  const input = { operation: "image-process", companyId: "11111111-1111-4111-8111-111111111111", projectId: "22222222-2222-4222-8222-222222222222", productId: "a".repeat(32), imageUrl: "https://img.alicdn.com/a.jpg", expectedRevision: 1, requestId: "33333333-3333-4333-8333-333333333333", removeChinese: true, crop: { x: 0, y: 100, width: 600, height: 400 } };
  expect(catalogRequestSchema.safeParse(input).success).toBe(true);
  expect(catalogRequestSchema.safeParse({ ...input, cleanupRegions: [{ x: 20, y: 150, width: 200, height: 60 }] }).success).toBe(true);
  for (const patch of [{ cleanupRegions: Array(9).fill({ x: 0, y: 0, width: 10, height: 10 }) }, { cleanupRegions: [{ x: -1, y: 0, width: 10, height: 10 }] }, { expectedRevision: 0 }, { requestId: "missing" }, { path: "/etc/passwd" }, { crop: { ...input.crop, x: -1 } }, { crop: { ...input.crop, width: 0 } }, { outputSize: { width: 9000, height: 1 } }]) {
    expect(catalogRequestSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  }
});
