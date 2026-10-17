import type { StoreProductDetail } from "@paperclipai/shared";
const decode = (url: string) => url.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'");
const normalize = (url: string) => { const value = decode(url); return value.startsWith("//") ? "https:" + value : value.replace(/^http:/i, "https:"); };
const escape = (url: string) => url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
export function composeDetailHtml(body: string, top: readonly string[], bottom: readonly string[]) {
  const present = new Set([...body.matchAll(/<img\b[^>]*?\b(?:src|data-src)\s*=\s*(["'])(.*?)\1/gi)].map(m => normalize(m[2])));
  const images = (urls: readonly string[]) => urls.filter(url => { const value = normalize(url); if (present.has(value)) return false; present.add(value); return true; }).map(url => `<img src="${escape(url)}" alt="공지 이미지">`).join("\n");
  const head = images(top), foot = images(bottom);
  return [head, body, foot].filter(Boolean).join("\n");
}
export const emptyStoreDetail = (storeId: string): StoreProductDetail => ({ storeId, categoryId: "", values: {}, topImages: [], bottomImages: [], referenceProductId: "" });
export const detailEditableValues = (details: StoreProductDetail[] | undefined) => (details ?? []).slice().sort((a,b) => a.storeId.localeCompare(b.storeId)).map(d => [d.storeId, d.categoryId, Object.entries(d.values).sort(([a],[b]) => a.localeCompare(b)), d.topImages, d.bottomImages, d.referenceProductId]);
export function validDetailImage(value: string) { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && value.length <= 4096; } catch { return false; } }
