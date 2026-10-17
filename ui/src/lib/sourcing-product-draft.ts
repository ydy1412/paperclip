import type { ManagedProduct } from "@paperclipai/shared";

export interface ProductDraftRecord { version: 1; companyId: string; projectId: string; baseRevision: number; product: ManagedProduct }
// Buffers retain unfinished names/prices; server validation still applies on save.
function isRecord(value: unknown): value is ProductDraftRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as ProductDraftRecord, p = r.product;
  const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
  return r.version === 1 && typeof r.companyId === "string" && typeof r.projectId === "string" && Number.isInteger(r.baseRevision) && r.baseRevision > 0 && !!p &&
    text(p.id, 100) && text(p.title, 100) && text(p.mainImage, 4096) && text(p.description, 2000000) && text(p.categoryCode, 100) &&
    Array.isArray(p.skus) && p.skus.length <= 1000 && p.skus.every(s => s && text(s.id, 100) && text(s.name, 1000) && text(s.image, 4096) &&
      (s.salePrice == null || typeof s.salePrice === "number" && Number.isFinite(s.salePrice)) && Array.isArray(s.options) && s.options.length <= 100 && s.options.every(o => o && text(o.name, 1000) && text(o.value, 1000)));
}
export const productDraftKey = (companyId: string, projectId: string, productId: string) => `paperclip:commerce-product:v1:${companyId}:${projectId}:${productId}`;
export function readProductDraft(companyId: string, projectId: string, productId: string): { record: ProductDraftRecord | null; failed: boolean } {
  try {
    const raw = window.localStorage.getItem(productDraftKey(companyId, projectId, productId));
    if (!raw) return { record: null, failed: false };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.companyId !== companyId || parsed.projectId !== projectId || parsed.product.id !== productId) return { record: null, failed: true };
    return { record: parsed, failed: false };
  } catch { return { record: null, failed: true }; }
}
export function writeProductDraft(companyId: string, projectId: string, baseRevision: number, product: ManagedProduct): boolean {
  try { const record = { version: 1, companyId, projectId, baseRevision, product }; if (!isRecord(record)) return false; window.localStorage.setItem(productDraftKey(companyId, projectId, product.id), JSON.stringify(record)); return true; } catch { return false; }
}
export function clearProductDraft(companyId: string, projectId: string, productId: string): boolean {
  try { window.localStorage.removeItem(productDraftKey(companyId, projectId, productId)); return true; } catch { return false; }
}
/** Only editable fields are restored; ownership, listings and revision always come from the live read. */
export function restoreProductDraft(current: ManagedProduct, record: ProductDraftRecord): ManagedProduct {
  const { title, mainImage, description, categoryCode, skus } = record.product;
  return { ...current, title, mainImage, description, categoryCode: current.listings.length ? current.categoryCode : categoryCode, skus };
}
