import { z } from "zod";

const url = z.string().url().max(4096);
const money = z.number().int().min(0).max(100_000_000_000_000).nullable();
export const captureSnapshotSchema = z.object({
  provider: z.literal("taobao"), productId: z.string().regex(/^\d{1,30}$/),
  url, title: z.string().trim().min(1).max(500), capturedAt: z.string().datetime(),
  description: z.string().max(50_000).nullable(),
  skus: z.array(z.object({
    skuId: z.string().regex(/^\d{1,100}$/), currency: z.literal("CNY"),
    originalPriceMinor: money, discountedPriceMinor: money,
    originalPriceText: z.string().max(100).nullable(), discountedPriceText: z.string().max(100).nullable(),
    stockStatus: z.string().max(100).nullable(), reportedQuantity: money,
    moreQuantity: z.string().max(100).nullable(), dispatchText: z.string().max(500).nullable(),
    options: z.array(z.object({ propertyId: z.string().max(100).nullable(), valueId: z.string().max(100).nullable(), name: z.string().min(1).max(200), value: z.string().min(1).max(500) }).strict()).max(20),
    images: z.array(url).max(20),
  }).strict()).max(200),
  images: z.array(z.object({ role: z.enum(["main", "detail"]), src: url }).strict()).max(201),
}).strict();
export const captureRequestSchema = z.object({ requestId: z.string().uuid(), snapshot: captureSnapshotSchema }).strict();
export const captureResultSchema = z.object({ status: z.enum(["stored", "already_saved"]), sourceProvider: z.literal("taobao"),
  sourceProductId: z.string(), title: z.string(), missingFields: z.array(z.enum(["mainImage", "detailImages", "options", "price"])) });
