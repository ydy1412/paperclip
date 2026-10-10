import { z } from "zod";
const id = z.string().regex(/^[a-f0-9]{32}$/);
export const sourcingCatalogScopeSchema = z.object({ companyId: z.string().uuid(), projectId: z.string().uuid() });
export const catalogSkuSchema = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(150), image: z.string().max(4096), options: z.array(z.object({ name: z.string().min(1).max(100), value: z.string().min(1).max(100) }).strict()).max(20) }).strict();
export const managedProductSchema = z.object({ id, title: z.string(), mainImage: z.string(), description: z.string(), categoryCode: z.string(), revision: z.number().int().positive(), sourceProvider: z.string(), sourceProductId: z.string(), stage: z.enum(["processing", "ready", "queued", "attention", "uploaded"]).optional(), skus: z.array(catalogSkuSchema).max(200), listings: z.array(z.object({ storeId: id, remoteProductId: z.string(), state: z.string(), publishedRevision: z.number() })) });
export const storeSettingsSchema = z.object({ businesses: z.array(sourcingCatalogScopeSchema.extend({ id, name: z.string(), registrationNumber: z.string() })), providers: z.array(z.object({ id: z.string(), name: z.string(), catalogSupported: z.boolean(), fields: z.array(z.object({ key: z.string(), label: z.string(), secret: z.boolean(), required: z.boolean() })) })), stores: z.array(z.object({ id, businessId: id, accountId: id, provider: z.string(), name: z.string(), enabled: z.boolean(), revision: z.number(), templateProductId: z.string(), hasCredentials: z.boolean(), catalogSupported: z.boolean(), importState: z.string(), importError: z.string() })), legacyAccounts: z.array(z.object({ id, provider: z.string(), name: z.string() })) });
export const publicationJobSchema = sourcingCatalogScopeSchema.extend({ id, productId: id, storeId: id, requestId: z.string().uuid(), intent: z.enum(["create", "update"]), productRevision: z.number(), accountRevision: z.number(), payloadDigest: z.string(), snapshotDigest: z.string(), remoteProductId: z.string(), state: z.enum(["queued", "preparing", "sending", "succeeded", "failed", "outcome_unknown", "readback_pending"]), errorCode: z.string(), ticketId: z.string(), createdAtUtcTicks: z.number(), updatedAtUtcTicks: z.number() });
export const catalogStageCountsSchema = z.object({ all: z.number().int().nonnegative(), processing: z.number().int().nonnegative(), ready: z.number().int().nonnegative(), queued: z.number().int().nonnegative(), attention: z.number().int().nonnegative(), uploaded: z.number().int().nonnegative() });
export type CatalogStageCounts = z.infer<typeof catalogStageCountsSchema>;
export const catalogRequestSchema = z.discriminatedUnion("operation", [
  sourcingCatalogScopeSchema.extend({ operation: z.literal("stages") }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("sources") }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("settings") }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("list"), view: z.enum(["source", "uploads"]), page: z.number().int().min(1).max(100000).optional(), stage: z.enum(["all", "processing", "ready", "queued", "attention", "uploaded"]).optional() }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("get"), productId: id }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("jobs") }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("import-status"), storeId: id }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("save"), productId: id, expectedRevision: z.number().int().positive(), title: z.string().trim().min(1).max(100), mainImage: z.string().max(4096), description: z.string().max(200000), categoryCode: z.string().regex(/^\d{0,30}$/), skus: z.array(catalogSkuSchema).min(1).max(200) }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("source"), sourceProvider: z.literal("taobao"), sourceProductId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("import"), storeId: id, restart: z.boolean().optional() }).strict(),
  sourcingCatalogScopeSchema.extend({ operation: z.literal("queue"), productId: id, expectedRevision: z.number().int().positive(), storeIds: z.array(id).min(1).max(20), requestId: z.string().uuid() }).strict(),
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
