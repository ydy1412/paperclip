import { z } from "zod";
const id = z.string().regex(/^[a-f0-9]{32}$/);
const categoryCode = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const catalogCategoryRecommendationSchema = z.object({ code: categoryCode, name: z.string().max(1000) });
export const catalogCategoryMetadataSchema = z.object({
  code: categoryCode, name: z.string().max(1000),
  attributes: z.array(z.object({ name: z.string().max(1000), dataType: z.string().max(100), required: z.boolean(), group: z.string().max(100), searchFilter: z.boolean(), units: z.array(z.string().max(100)).max(100) })).max(1000),
  notices: z.array(z.object({ category: z.string().max(1000), name: z.string().max(1000), required: z.boolean() })).max(1000),
  certifications: z.array(z.object({ type: z.string().max(1000), required: z.boolean(), needsCode: z.boolean() })).max(1000),
  documents: z.array(z.object({ name: z.string().max(1000), required: z.boolean(), condition: z.string().max(100).nullable().optional() })).max(1000),
  allowSingleItem: z.boolean(),
});
export const sourcingCatalogScopeSchema = z.object({ companyId: z.string().uuid(), projectId: z.string().uuid() });
const imageDimension = z.number().int().min(1).max(8000);
const imageRectangleSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: imageDimension, height: imageDimension }).strict();
const imageRegionSchema = z.object({ text: z.string().max(1000), confidence: z.number().min(0).max(1), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: imageDimension, height: imageDimension });
export const catalogImageAnalysisSchema = z.object({ width: imageDimension, height: imageDimension, regions: z.array(imageRegionSchema).max(500) });
export const catalogImageAssetSchema = catalogImageAnalysisSchema.extend({ assetId: id, imageUrl: z.string().max(4096), originalImageUrl: z.string().max(4096), sourceHash: z.string().max(128), originalSha256: z.string().regex(/^[a-f0-9]{64}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), recipeHash: z.string().regex(/^[a-f0-9]{64}$/), expectedRevision: z.number().int().positive(), productRevision: z.number().int().positive(), sourceWidth: imageDimension, sourceHeight: imageDimension, cropApplied: z.boolean(), textRemovalApplied: z.boolean(), reviewRequired: z.boolean(), removedRegions: z.array(imageRegionSchema).max(500), remainingChinese: z.array(imageRegionSchema).max(500), cleanupRegions: z.array(imageRectangleSchema).max(8).nullish().transform(value => value ?? []) });
export const catalogSkuSchema = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(150), image: z.string().max(4096), salePrice: z.number().int().positive().max(1000000000).multipleOf(10).nullable().optional(), options: z.array(z.object({ name: z.string().min(1).max(100), value: z.string().max(100) }).strict()).max(20) }).strict();
// Registered Coupang products can contain exposed attributes with empty values.
// Preserve those values on reads; save requests still use catalogSkuSchema.
const catalogSkuViewSchema = catalogSkuSchema.extend({ options: z.array(catalogSkuSchema.shape.options.element.extend({ value: z.string().max(100) })).max(20) });
export const managedProductSchema = z.object({ id, title: z.string(), mainImage: z.string(), description: z.string(), categoryCode: z.string(), revision: z.number().int().positive(), sourceProvider: z.string(), sourceProductId: z.string(), stage: z.enum(["processing", "ready", "queued", "attention", "uploaded"]).optional(), skus: z.array(catalogSkuViewSchema).max(200), listings: z.array(z.object({ storeId: id, remoteProductId: z.string(), state: z.string(), publishedRevision: z.number() })) });
export const storeSettingsSchema = z.object({ businesses: z.array(sourcingCatalogScopeSchema.extend({ id, name: z.string(), registrationNumber: z.string() })), providers: z.array(z.object({ id: z.string(), name: z.string(), catalogSupported: z.boolean(), fields: z.array(z.object({ key: z.string(), label: z.string(), secret: z.boolean(), required: z.boolean() })) })), stores: z.array(z.object({ id, businessId: id, accountId: id, provider: z.string(), name: z.string(), enabled: z.boolean(), revision: z.number(), templateProductId: z.string(), hasCredentials: z.boolean(), catalogSupported: z.boolean(), importState: z.string(), importError: z.string() })), legacyAccounts: z.array(z.object({ id, provider: z.string(), name: z.string() })) });
export const publicationJobSchema = sourcingCatalogScopeSchema.extend({ id, productId: id, storeId: id, requestId: z.string().uuid(), intent: z.enum(["create", "update"]), productRevision: z.number(), accountRevision: z.number(), payloadDigest: z.string(), snapshotDigest: z.string(), remoteProductId: z.string(), state: z.enum(["queued", "preparing", "sending", "succeeded", "failed", "outcome_unknown", "readback_pending"]), errorCode: z.string(), ticketId: z.string(), createdAtUtcTicks: z.number(), updatedAtUtcTicks: z.number() });
export const catalogStageCountsSchema = z.object({ all: z.number().int().nonnegative(), processing: z.number().int().nonnegative(), ready: z.number().int().nonnegative(), queued: z.number().int().nonnegative(), attention: z.number().int().nonnegative(), uploaded: z.number().int().nonnegative(), candidate: z.number().int().nonnegative().default(0), unprocessed: z.number().int().nonnegative().default(0) });
export const candidateSchema = z.object({ id, sourceProductId: z.string(), url: z.string(), mainKeyword: z.string(), subKeyword: z.string(), collectionState: z.enum(["idle", "queued", "collecting", "importing", "succeeded", "failed", "reconciliation_required"]), errorCode: z.string() });
export const workspaceItemSchema = z.object({ id, kind: z.enum(["candidate", "source", "product"]), title: z.string(), mainImage: z.string(), stage: z.enum(["candidate", "unprocessed", "processing", "ready", "queued", "uploaded", "attention"]), product: managedProductSchema.nullable(), candidate: candidateSchema.nullable(), source: z.object({ sourceProvider: z.string(), sourceProductId: z.string(), title: z.string(), mainImage: z.string(), url: z.string(), description: z.string(), optionCount: z.number().int().nonnegative() }).nullable() });
export const catalogPricePreviewSchema = z.object({ productRevision: z.number().int().positive(), confirmation: z.string().regex(/^[a-f0-9]{64}$/i), stores: z.array(z.object({ storeId: id, accountRevision: z.number().int().positive(), snapshotDigest: z.string(), changes: z.array(z.object({ skuId: z.string(), name: z.string(), before: z.number().int().nullable(), after: z.number().int().positive() })) })) });
export type SourcingWorkspaceItem = z.infer<typeof workspaceItemSchema>;
export type CandidateView = z.infer<typeof candidateSchema>;
export type CatalogPricePreview = z.infer<typeof catalogPricePreviewSchema>;
export type CatalogStageCounts = z.infer<typeof catalogStageCountsSchema>;
export const catalogRequestSchema = z.discriminatedUnion("operation", [
  sourcingCatalogScopeSchema.extend({ operation: z.literal("image-inspect"), productId: id, imageUrl: z.string().url().max(4096) }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("image-content"), productId: id, assetId: id }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("image-process"), productId: id, imageUrl: z.string().url().max(4096), expectedRevision: z.number().int().positive(), requestId: z.string().uuid(), removeChinese: z.boolean().default(false), crop: imageRectangleSchema.optional(), cleanupRegions: z.array(imageRectangleSchema).max(8).optional(), outputSize: z.object({ width: imageDimension.max(4000), height: imageDimension.max(4000) }).strict().optional() }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("category-recommend"), storeId: id, productName: z.string().trim().min(1).max(200) }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("category-metadata"), storeId: id, categoryCode }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("stages"), query: z.string().trim().max(200).optional() }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("sources") }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("workspace"), stage: z.enum(["all", "candidate", "unprocessed", "processing", "ready", "queued", "uploaded", "attention"]).default("all"), page: z.number().int().min(1).max(100000).default(1), query: z.string().trim().max(200).optional() }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("candidate-import") }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("candidate-collect"), candidateId: id }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("price-preview"), productId: id, expectedRevision: z.number().int().positive(), storeIds: z.array(id).min(1).max(20) }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("settings") }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("list"), view: z.enum(["source", "uploads"]), query: z.string().trim().max(200).optional(), page: z.number().int().min(1).max(100000).optional(), stage: z.enum(["all", "processing", "ready", "queued", "attention", "uploaded"]).optional() }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("get"), productId: id }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("jobs") }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("import-status"), storeId: id }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("save"), productId: id, expectedRevision: z.number().int().positive(), title: z.string().trim().min(1).max(100), mainImage: z.string().max(4096), description: z.string().max(200000), categoryCode: z.string().regex(/^\d{0,30}$/), skus: z.array(catalogSkuSchema).min(1).max(200), confirmPriceChanges: z.boolean().optional() }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("source"), sourceProvider: z.literal("taobao"), sourceProductId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("import"), storeId: id, restart: z.boolean().optional() }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("queue"), productId: id, expectedRevision: z.number().int().positive(), storeIds: z.array(id).min(1).max(20), requestId: z.string().uuid(), priceConfirmation: z.string().regex(/^[a-f0-9]{64}$/i).optional() }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("reconcile"), jobId: id, remoteProductId: z.string().regex(/^\d{1,30}$/).optional() }).strict(),
]);
export const storeSettingRequestSchema = z.discriminatedUnion("operation", [
  sourcingCatalogScopeSchema.extend({ operation: z.literal("business"), name: z.string().trim().min(1).max(120), registrationNumber: z.string().regex(/^[\d-]{0,12}$/).default("") }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("store"), businessId: id, provider: z.string().min(1).max(64), name: z.string().trim().min(1).max(120), credentials: z.record(z.string().max(64), z.string().max(4096)), storeId: id.optional(), expectedRevision: z.number().int().positive().optional(), templateProductId: z.string().regex(/^\d{0,30}$/).default(""), enabled: z.boolean().default(true) }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("attach"), businessId: id, accountId: id }).strict(),
]);
export type ManagedProduct = z.infer<typeof managedProductSchema>;
export type StoreSettings = z.infer<typeof storeSettingsSchema>;
export type PublicationJob = z.infer<typeof publicationJobSchema>;
export type CatalogRequest = z.infer<typeof catalogRequestSchema>;
export type StoreSettingRequest = z.infer<typeof storeSettingRequestSchema>;
