import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DetailReference, ManagedProduct } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { validDetailImage } from "../lib/product-detail-composition";
import { Button } from "./ui/button";
const fieldClass = "min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground";
export function DetailImages({ label, images, onChange }: { label: string; images: string[]; onChange: (images: string[]) => void }) {
  const [url, setUrl] = useState(""); const [error, setError] = useState("");
  return <fieldset className="min-w-0 space-y-2 rounded-md border border-border p-3"><legend className="px-1 text-sm font-medium">{label}</legend>
    {images.map((image, index) => <div key={`${index}:${image}`} className="flex min-w-0 items-center gap-2"><img src={image} alt={`${label} ${index + 1}`} className="size-12 shrink-0 rounded border border-border object-contain" referrerPolicy="no-referrer" /><span className="min-w-0 flex-1 truncate text-xs" title={image}>{image}</span><Button type="button" size="sm" variant="ghost" aria-label={`${label} ${index + 1} 위로`} disabled={index === 0} onClick={() => { const next = [...images]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}>↑</Button><Button type="button" size="sm" variant="ghost" aria-label={`${label} ${index + 1} 아래로`} disabled={index === images.length - 1} onClick={() => { const next = [...images]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onChange(next); }}>↓</Button><Button type="button" size="sm" variant="ghost" onClick={() => onChange(images.filter((_, i) => i !== index))}>삭제</Button></div>)}
    <div className="flex gap-2"><input aria-label={`${label} 이미지 주소`} className={fieldClass} type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="공개 HTTPS 이미지 주소" /><Button type="button" size="sm" variant="outline" disabled={images.length >= 20} onClick={() => { const value = url.trim(); if (!validDetailImage(value)) { setError("공개 HTTPS 이미지 주소를 입력해 주세요."); return; } onChange([...images, value]); setUrl(""); setError(""); }}>추가</Button></div>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </fieldset>;
}
export function DetailReferencePicker({ companyId, projectId, storeId, onChoose, topImages = [], bottomImages = [] }: { topImages?: readonly string[]; bottomImages?: readonly string[]; companyId: string; projectId: string; storeId: string; onChoose: (url: string, position: "top" | "bottom", productId: string) => void }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState(""), [productId, setProductId] = useState("");
  const products = useQuery({ queryKey: ["notice-reference-products", companyId, projectId, search], queryFn: () => sourcingCatalogApi.request<ManagedProduct[]>(companyId, projectId, { operation: "list", view: "uploads", query: search }), enabled: open });
  const reference = useQuery({ queryKey: ["notice-reference", companyId, projectId, storeId, productId], queryFn: () => sourcingCatalogApi.request<DetailReference>(companyId, projectId, { operation: "detail-reference", storeId, productId }), enabled: open && !!productId, retry: false });
  return <details onToggle={e => setOpen(e.currentTarget.open)} className="min-w-0 space-y-3 rounded-md border border-border p-3"><summary className="cursor-pointer text-sm">기존 상품 공지 가져오기</summary><p className="text-xs text-muted-foreground">이 쇼핑몰의 등록 상품과 이미지를 확인한 뒤 상단·하단을 직접 선택하세요. 다른 공지나 본문은 자동 삭제하지 않습니다.</p>
    <input aria-label="공지 참고 상품 검색" className={fieldClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="등록 상품명 검색" />
    <select aria-label="공지 참고 상품" className={fieldClass} value={productId} onChange={e => setProductId(e.target.value)}><option value="">상품 선택</option>{products.data?.filter(p => p.listings.some(l => l.storeId === storeId)).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
    {(products.isError || reference.isError) && <p role="alert" className="text-sm text-destructive">참고 상품 이미지를 불러오지 못했습니다.</p>}{reference.isFetching && <p className="text-xs">이미지 확인 중…</p>}
    {reference.data && !reference.data.images.some(validDetailImage) && <p className="text-xs text-muted-foreground">이 상품에는 가져올 수 있는 상세 이미지가 없습니다.</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{reference.data?.images.filter(validDetailImage).map(url => <div key={url} className="min-w-0 space-y-2 rounded border border-border p-2"><img src={url} alt="기존 상품 상세 이미지 후보" className="h-32 w-full object-contain" referrerPolicy="no-referrer" /><div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="outline" disabled={topImages.length >= 20 || topImages.includes(url)} onClick={() => onChoose(url, "top", reference.data!.productId)}>상단 선택</Button><Button type="button" size="sm" variant="outline" disabled={bottomImages.length >= 20 || bottomImages.includes(url)} onClick={() => onChoose(url, "bottom", reference.data!.productId)}>하단 선택</Button></div></div>)}</div>
  </details>;
}
