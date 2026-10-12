import { expect, it } from "vitest";
import { catalogRequestSchema, catalogImageProcessResultSchema } from "./sourcing-catalog.js";

it("requires scoped original image identifiers, bounded integer crops and request identity", () => {
  const input = { operation: "image-process", companyId: "11111111-1111-4111-8111-111111111111", projectId: "22222222-2222-4222-8222-222222222222", productId: "a".repeat(32), imageUrl: "https://img.alicdn.com/a.jpg", expectedRevision: 1, requestId: "33333333-3333-4333-8333-333333333333", removeChinese: true, crop: { x: 0, y: 100, width: 600, height: 400 } };
  expect(catalogRequestSchema.safeParse(input).success).toBe(true);
  expect(catalogRequestSchema.safeParse({ ...input, cleanupRegions: [{ x: 20, y: 150, width: 200, height: 60 }] }).success).toBe(true);
  for (const patch of [{ cleanupRegions: Array(9).fill({ x: 0, y: 0, width: 10, height: 10 }) }, { cleanupRegions: [{ x: -1, y: 0, width: 10, height: 10 }] }, { expectedRevision: 0 }, { requestId: "missing" }, { path: "/etc/passwd" }, { crop: { ...input.crop, x: -1 } }, { crop: { ...input.crop, width: 0 } }, { outputSize: { width: 9000, height: 1 } }]) {
    expect(catalogRequestSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  }
});

it("allows the scoped cloud edit contract and keeps a pending result distinct from a finished PNG", () => {
  const input = { operation: "image-process", companyId: crypto.randomUUID(), projectId: crypto.randomUUID(), productId: "a".repeat(32), imageUrl: "https://img.alicdn.com/a.jpg", expectedRevision: 3, requestId: crypto.randomUUID(), provider: "higgsfield", removeAllText: true };
  expect(catalogRequestSchema.parse(input)).toMatchObject({ provider: "higgsfield", removeAllText: true, removeChinese: false });
  expect(catalogRequestSchema.safeParse({ ...input, apiKey: "secret" }).success).toBe(false);
  expect(catalogRequestSchema.safeParse({ ...input, provider: "unknown" }).success).toBe(false);
  expect(catalogRequestSchema.safeParse({ operation: "image-provider-status", companyId: input.companyId, projectId: input.projectId }).success).toBe(true);
  const pending = { status: "pending", requestId: input.requestId, productId: input.productId, expectedRevision: 3, providerRequestId: crypto.randomUUID(), provider: "higgsfield", nextCheckSeconds: 3, reviewRequired: true };
  expect(catalogImageProcessResultSchema.parse(pending)).toEqual(pending);
  expect(catalogImageProcessResultSchema.safeParse({ ...pending, status: "completed" }).success).toBe(false);
  expect(catalogImageProcessResultSchema.safeParse({ ...pending, reviewRequired: false }).success).toBe(false);
});

it("validates bounded server job settings and exact legacy request adoption", () => {
  const scope = { companyId: crypto.randomUUID(), projectId: crypto.randomUUID() };
  expect(catalogRequestSchema.safeParse({ ...scope, operation: "image-job-configure", enabled: true, scanIntervalSeconds: 60 }).success).toBe(true);
  for (const seconds of [0, 4, 3601, 60.5]) expect(catalogRequestSchema.safeParse({ ...scope, operation: "image-job-configure", enabled: true, scanIntervalSeconds: seconds }).success).toBe(false);
  const input = { ...scope, operation: "image-job-adopt", productId: "a".repeat(32), imageUrl: "https://img.alicdn.com/a.jpg", expectedRevision: 3, requestId: crypto.randomUUID(), provider: "higgsfield", removeAllText: true };
  expect(catalogRequestSchema.safeParse(input).success).toBe(true);
  expect(catalogRequestSchema.safeParse({ ...input, provider: "local" }).success).toBe(false);
  expect(catalogRequestSchema.safeParse({ ...input, removeAllText: false }).success).toBe(false);
});
