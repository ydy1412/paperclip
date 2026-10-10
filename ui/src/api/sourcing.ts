import type { SourcingForwarder, SourcingForwarderProvider, CreateSourcingForwarder, UpdateSourcingForwarder, SourcingForwarderOpenResult } from "@paperclipai/shared";
import { api } from "./client";
import { pluginsApi } from "./plugins";
import type { CatalogRequest, StoreSettingRequest } from "@paperclipai/shared";

export type SourcingAccount = { id: string; displayName: string; provider: string; enabled: boolean };
export type SourcingCarrier = { code: string; name: string; lengths: number[]; format: "numeric" | "alphanumeric"; trackingSupported: boolean };
export type OrderItem = { itemId: string; productId: string | null; quantity: number; cancelledQuantity: number; pendingCancellationQuantity: number; unitPrice: number | null; orderPrice: number | null; currency: string | null; productName?: string | null };
export type SourcingOrder = { shipmentId: string; orderId: string; state: string; orderedAt: string | null; observedAt: string; quantity: number; amount: number | null; currency: string | null; items: OrderItem[]; buyerName?: string | null; recipientName?: string | null };
export type OrderSummary = { totalOrders: number; totalQuantity: number; newOrders: number; preparingOrders: number; shippingOrders: number; deliveredOrders: number; unknownAmountOrders: number; revenue: { currency: string; amount: number }[] };
export type SourcingOrderPage = { orders: SourcingOrder[]; total: number; page: number; pageSize: number; summary?: OrderSummary | null };
export type OrderSyncState = { state: string; jobId: string | null; startedAt: string | null; finishedAt: string | null; items: number | null; errorCode: string | null };
export type DispatchTicket = { id: string; targetId: string; state: string; expiresAt: string; readbackVerified: boolean;
  results: { targetId: string; succeeded: boolean; code: string }[] };
export type DispatchResult = { ticket: DispatchTicket | null; errorCode: string | null };
export type DispatchRequest = { shipmentId: string; operation: "preview" | "dispatch" | "status" | "prepare-preview" | "prepare" | "prepare-status"; carrierCode?: string; invoiceNumber?: string; confirmation?: string };

export const sourcingApi = {
  plugin: async () => (await pluginsApi.list()).find(plugin => plugin.pluginKey === "paperclipai.plugin-auto-sourcing" && plugin.status === "ready") ?? null,
  data: async <T>(pluginId: string, companyId: string, projectId: string, key: string, params: Record<string, unknown> = {}) =>
    (await pluginsApi.bridgeGetData(pluginId, key, { ...params, projectId }, companyId)).data as T,
  sync: async (pluginId: string, companyId: string, projectId: string, accountId: string, from: string, to: string) =>
    (await pluginsApi.bridgePerformAction(pluginId, "sync-orders", { projectId, accountId, from, to }, companyId)).data as OrderSyncState,
  shipping: async (pluginId: string, companyId: string, projectId: string, accountId: string, input: DispatchRequest) =>
    (await pluginsApi.bridgePerformAction(pluginId, "shipping-order", { projectId, accountId, ...input }, companyId)).data as DispatchResult,
};

const forwarderPath = (companyId: string, projectId: string) => `/companies/${encodeURIComponent(companyId)}/sourcing/projects/${encodeURIComponent(projectId)}/forwarders`;
export const sourcingForwardersApi = {
  providers: (companyId: string, projectId: string) => api.get<SourcingForwarderProvider[]>(`${forwarderPath(companyId, projectId)}/providers`),
  list: (companyId: string, projectId: string) => api.get<SourcingForwarder[]>(forwarderPath(companyId, projectId)),
  create: (companyId: string, projectId: string, input: CreateSourcingForwarder) => api.post<SourcingForwarder>(forwarderPath(companyId, projectId), input),
  update: (companyId: string, projectId: string, id: string, input: UpdateSourcingForwarder) => api.patch<SourcingForwarder>(`${forwarderPath(companyId, projectId)}/${encodeURIComponent(id)}`, input),
  remove: (companyId: string, projectId: string, id: string) => api.delete<void>(`${forwarderPath(companyId, projectId)}/${encodeURIComponent(id)}`),
  open: (companyId: string, projectId: string, id: string) => api.post<SourcingForwarderOpenResult>(`${forwarderPath(companyId, projectId)}/${encodeURIComponent(id)}/open`, {}),
};

export const sourcingCatalogApi = {
  request: <T>(companyId: string, projectId: string, input: Omit<CatalogRequest, "companyId" | "projectId"> | Omit<StoreSettingRequest, "companyId" | "projectId"> | Record<string, unknown>) =>
    api.post<T>(`/companies/${encodeURIComponent(companyId)}/sourcing/projects/${encodeURIComponent(projectId)}/catalog`, input),
};

export type ProcessingSource = { provider: string; productId: string; title: string; url: string; sourceHash: string;
  skus: { skuId: string; currency: string; originalPriceMinor: number | null; discountedPriceMinor: number | null; reportedQuantity: number | null;
    options: { name: string; value: string }[]; images: string[] }[];
  images: { skuId: string | null; src: string }[]; files: { locator: string; hash: string; size: number }[] };
export type ProcessingCrop = { sourceSkuId: string; imageUrl: string; sourceWidth: number; sourceHeight: number; x: number; y: number; width: number; height: number; outputWidth: number; outputHeight: number; purpose: string };
export type ProcessingItem = { sourceSkuId: string; originalName: string; name: string; representativeImageUrl: string;
  options: { ordinal: number; originalName: string; originalValue: string; name: string; value: string }[] };
export type ProcessingView = { draft: { id: string; revision: number; originalName: string; name: string; items: ProcessingItem[]; cropPlans: ProcessingCrop[];
  categoryCode: number | null; categoryName: string; issues: { code: string; field: string; message: string; blocking: boolean }[] };
  source: ProcessingSource; reviewReady: boolean; categoryStatus: string; cropStatus: string };
export type ProcessingSummary = { id: string; name: string; productId: string; revision: number };
export const processingApi = {
  read: <T>(pluginId: string, companyId: string, projectId: string, accountId: string, operation: string, input: Record<string, unknown> = {}) =>
    sourcingApi.data<T>(pluginId, companyId, projectId, "processing", { ...input, accountId, operation }),
  write: async (pluginId: string, companyId: string, projectId: string, accountId: string, operation: "create" | "save", input: Record<string, unknown>) =>
    (await pluginsApi.bridgePerformAction(pluginId, "processing-draft", { ...input, projectId, accountId, operation }, companyId)).data as ProcessingView,
};
export function processingSavePayload(view: ProcessingView) {
  return { draftId: view.draft.id, expectedRevision: view.draft.revision, name: view.draft.name,
    items: view.draft.items.map(i => ({ sourceSkuId: i.sourceSkuId, name: i.name, representativeImageUrl: i.representativeImageUrl,
      options: i.options.map(o => ({ ordinal: o.ordinal, name: o.name, value: o.value })) })),
    cropPlans: view.draft.cropPlans.map(c => ({ sourceSkuId: c.sourceSkuId, imageUrl: c.imageUrl, sourceWidth: c.sourceWidth, sourceHeight: c.sourceHeight,
      x: c.x, y: c.y, width: c.width, height: c.height, outputWidth: c.outputWidth, outputHeight: c.outputHeight, purpose: c.purpose })) };
}
