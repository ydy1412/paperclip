import { useQuery } from "@tanstack/react-query";
import { sourcingCatalogApi } from "../api/sourcing";
import { composeDetailHtml, emptyStoreDetail } from "../lib/product-detail-composition";
import { StoreDetailImagesEditor } from "./SourcingStoreProductDetail";
import { useEffect, useState } from "react";
import type { DetailDefault, StoreProductDetail, StoreSettings, SourcingWorkspaceItem } from "@paperclipai/shared";
import { ProductDescription } from "./ProductDescription";
import { Button } from "./ui/button";

/** Collected evidence stays read-only until the explicit source operation. */
export function SourcingSourcePreview({ item, busy, onStart, companyId, projectId, settings, onDirty }: { item: SourcingWorkspaceItem; busy: boolean; onStart: (details?: StoreProductDetail[]) => void; companyId: string; projectId: string; settings?: StoreSettings; onDirty?: (value: boolean) => void }) {
  const [section, setSection] = useState("basic");
  const source = item.source!;
  const [storeId, setStoreId] = useState(settings?.stores.find(s => s.enabled)?.id ?? "");
  const [overrides, setOverrides] = useState<Record<string, StoreProductDetail>>({});
  useEffect(() => { if (!storeId && settings?.stores.length) setStoreId(settings.stores.find(s => s.enabled)?.id ?? settings.stores[0].id); }, [settings, storeId]);
  const defaults = useQuery({ queryKey: ["store-detail-defaults", companyId, projectId, storeId], queryFn: () => sourcingCatalogApi.request<DetailDefault>(companyId, projectId, { operation: "detail-defaults", storeId }), enabled: !!storeId, retry: false });
  const detail = overrides[storeId] ?? { ...emptyStoreDetail(storeId), topImages: defaults.data?.topImages ?? [], bottomImages: defaults.data?.bottomImages ?? [], referenceProductId: defaults.data?.referenceProductId ?? "" };
  const dirty = Object.keys(overrides).length > 0;
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  useEffect(() => { if (!dirty) return; const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  const safeUrl = /^https?:\/\//.test(source.url) ? source.url : undefined;
  return <aside aria-label="가공 전 상품 정보" className="min-w-0 space-y-5 bg-card">
    <header className="space-y-2"><div className="flex items-start justify-between gap-3"><h2 className="text-base font-semibold">{item.title}</h2>{safeUrl && <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-muted-foreground underline">원본 보기 ↗</a>}</div><p className="text-xs text-muted-foreground">가공 전 · {source.sourceProvider === "taobao" ? "타오바오" : source.sourceProvider} · 옵션 {source.optionCount}개</p></header>
    <nav aria-label="원본 상품 구획" className="commerce-editor-tabs">{[["basic", "기본정보"], ["images", "이미지"], ["options", "옵션·가격"], ["stores", "쇼핑몰"]].map(([id, label]) => <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}</nav>
    <div className="commerce-editor-body space-y-5"><div hidden={section !== "basic"} className="space-y-6">
      <div className="commerce-product-fields"><div>{source.mainImage ? <><img src={source.mainImage} alt="상품 대표 이미지" className="commerce-product-photo" referrerPolicy="no-referrer" /><img src={source.mainImage} alt="원본 대표 이미지 썸네일" className="mt-2 size-12 rounded border border-border object-contain" referrerPolicy="no-referrer" /></> : <p className="text-sm text-muted-foreground">대표 이미지 없음</p>}</div><div className="min-w-0 space-y-5"><div className="space-y-2"><h3 className="text-xs text-muted-foreground">상품명</h3><p className="text-sm leading-relaxed">{source.title}</p></div><div className="space-y-2"><h3 className="text-xs text-muted-foreground">카테고리</h3><p className="text-sm">가공 시작 후 판매 카테고리를 지정합니다.</p></div><details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm">원본 정보</summary><p className="text-sm">수집한 원본 · 옵션 {source.optionCount}개</p><p className="text-xs text-muted-foreground">원본을 보존한 채 별도의 상품 초안을 만듭니다.</p></details></div></div>
      <section className="space-y-3 border-t border-border pt-4"><ProductDescription value={composeDetailHtml(source.description, detail.topImages, detail.bottomImages)} />{storeId && <p className="text-xs text-muted-foreground">{settings?.stores.find(s => s.id === storeId)?.name} 기본 공지와 원본문의 미리보기입니다. 원본문은 보존합니다.</p>}</section>
      <div className="flex items-center justify-between border-t border-border py-3"><div><h3 className="text-sm font-medium">옵션·가격</h3><p className="mt-1 text-xs text-muted-foreground">수집한 옵션 {source.optionCount}개 · 판매가격은 가공 후 확인</p></div><Button variant="ghost" size="sm" onClick={() => setSection("options")}>옵션 보기 →</Button></div>
      <div className="border-t border-border py-3"><h3 className="text-sm font-medium">쇼핑몰 등록</h3><p className="mt-1 text-xs text-muted-foreground">원본 상태 · 가공 후 쇼핑몰 등록을 준비할 수 있습니다.</p></div>
    </div>
    <div hidden={section !== "images"}>{source.mainImage ? <img src={source.mainImage} alt="수집한 대표 이미지" className="commerce-product-photo" referrerPolicy="no-referrer" /> : <p className="text-sm">대표 이미지 없음</p>}<p className="mt-3 text-xs text-muted-foreground">원본 이미지입니다. 가공 시작 후 상품 이미지 도구를 사용할 수 있습니다.</p></div>
    <p hidden={section !== "options"} className="text-sm text-muted-foreground">수집한 옵션 {source.optionCount}개. 상세 옵션과 판매가격은 가공 시작 후 편집합니다.</p>
    <div hidden={section !== "stores"} className="space-y-4"><label className="grid gap-1 text-sm">상세 설정 쇼핑몰<select aria-label="상세 설정 쇼핑몰" className="rounded-md border border-input bg-background p-2" value={storeId} onChange={e => setStoreId(e.target.value)}><option value="">선택</option>{settings?.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{storeId && <fieldset disabled={busy} className="min-w-0"><StoreDetailImagesEditor key={storeId} companyId={companyId} projectId={projectId} storeId={storeId} body={source.description} value={detail} onChange={next => setOverrides(current => ({ ...current, [next.storeId]: next }))} /></fieldset>}<p className="text-xs text-muted-foreground">선택·미리보기만으로 상품을 만들지 않습니다. 상세 편집 시작을 누르면 공지 구성을 복사한 상품 초안을 만들며 유료 이미지 생성이나 업로드는 실행하지 않습니다.</p></div>
    <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">원본 상세</summary><dl className="space-y-2 py-3 text-xs text-muted-foreground"><dt>원본 상품 번호</dt><dd>{source.sourceProductId}</dd><dt>원본 주소</dt><dd className="break-all">{source.url}</dd></dl></details>
    {source.missingFields?.length ? <p role="status" className="text-xs text-destructive">원본 추가 확인: {source.missingFields.map(field => ({ mainImage: "대표 이미지", detailImages: "상세 이미지", options: "옵션", price: "가격" })[field] ?? field).join(", ")}</p> : null}
    </div><footer className="commerce-savebar"><span className="text-xs text-muted-foreground">수집한 원본 · 편집 전</span><Button disabled={busy} onClick={() => onStart(Object.keys(overrides).length ? Object.values(overrides) : undefined)}>{busy ? "가공 준비 중" : dirty ? "이 구성으로 상세 편집 시작" : "가공 시작"}</Button></footer>
  </aside>;
}
