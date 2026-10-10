import { z } from "zod";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const scope = z.object({ companyId: z.string().uuid(), projectId: z.string().uuid(), accountId: id });
const source = { sourceProvider: z.literal("taobao"), productId: id };
const draft = { draftId: z.string().regex(/^[a-f0-9]{32}$/) };
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const option = z.object({ ordinal: z.number().int().nonnegative(), name: z.string().min(1).max(100), value: z.string().min(1).max(150) }).strict();
const dimension = z.number().int().min(1).max(50000);
export const cropSchema = z.object({ sourceSkuId: id, imageUrl: z.string().max(2000), sourceWidth: dimension, sourceHeight: dimension,
  x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: dimension, height: dimension,
  outputWidth: dimension, outputHeight: dimension, purpose: z.string().min(1).max(200) });
export const processingReadSchema = z.discriminatedUnion("operation", [
  scope.extend({ operation: z.literal("source"), ...source }).strict(),
  scope.extend({ operation: z.literal("list") }).strict(),
  scope.extend({ operation: z.literal("get"), ...draft }).strict(),
  scope.extend({ operation: z.literal("validate"), ...draft, expectedRevision: revision }).strict(),
]);
export const processingWriteSchema = z.discriminatedUnion("operation", [
  scope.extend({ operation: z.literal("create"), ...source, skuIds: z.array(id).min(1).max(200).refine(ids => new Set(ids).size === ids.length) }).strict(),
  scope.extend({ operation: z.literal("save"), ...draft, expectedRevision: revision, name: z.string().min(1).max(100),
    items: z.array(z.object({ sourceSkuId: id, name: z.string().min(1).max(150), representativeImageUrl: z.string().max(2000), options: z.array(option).max(100) }).strict()).min(1).max(200),
    cropPlans: z.array(cropSchema.strict()).max(200),
  }).strict(),
]);
export const processingSourceSchema = z.object({ provider: z.literal("taobao"), productId: id, url: z.string(), title: z.string(), sourceHash: z.string(),
  skus: z.array(z.object({ skuId: id, currency: z.string(), originalPriceMinor: z.number().nullable(), discountedPriceMinor: z.number().nullable(),
    originalPriceText: z.string().nullable(), discountedPriceText: z.string().nullable(), stockStatus: z.string().nullable(), reportedQuantity: z.number().nullable(),
    moreQuantity: z.string().nullable(), dispatchText: z.string().nullable(),
    options: z.array(z.object({ propertyId: z.string().nullable(), valueId: z.string().nullable(), name: z.string(), value: z.string() })), images: z.array(z.string()) })),
  images: z.array(z.object({ role: z.string(), ordinal: z.number(), skuId: z.string().nullable(), src: z.string(), lazySrc: z.string().nullable(), alt: z.string().nullable() })),
  files: z.array(z.object({ locator: z.string(), hash: z.string(), size: z.number() })),
});
export const processingListSchema = z.array(z.object({ id: draft.draftId, ...source, name: z.string(), revision, state: z.string() }));
export const processingViewSchema = z.object({ draft: z.object({ id: draft.draftId, accountId: id,
  processingCompanyId: z.string().uuid(), processingProjectId: z.string().uuid(), ...source, sourceHash: z.string(), originalName: z.string(), name: z.string(), revision,
  state: z.literal("Blocked"), categoryCode: z.number().nullable(), categoryName: z.string(),
  items: z.array(z.object({ ordinal: z.number(), sourceSkuId: id, originalName: z.string(), name: z.string(), costCnyMinor: z.number().nullable(), priceWon: z.number().nullable(), representativeImageUrl: z.string(),
    options: z.array(z.object({ ordinal: z.number(), originalName: z.string(), originalValue: z.string(), name: z.string(), value: z.string() })) })),
  cropPlans: z.array(cropSchema.extend({ ordinal: z.number() })),
  issues: z.array(z.object({ ordinal: z.number(), code: z.string(), field: z.string(), message: z.string(), blocking: z.boolean() })),
}), source: processingSourceSchema, reviewReady: z.literal(false), categoryStatus: z.literal("unverified"), cropStatus: z.enum(["not_requested", "pending"]) });
