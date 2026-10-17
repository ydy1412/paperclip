import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ManagedProduct, PublicationJob, StoreSettings, CatalogPricePreview } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { clearProductDraft, readProductDraft, restoreProductDraft, writeProductDraft } from "../lib/sourcing-product-draft";
import { ApiError } from "../api/client";
import { catalogErrorMessage, publicationStates } from "../lib/sourcing-catalog";
import { ProductDescription } from "./ProductDescription";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";

const fieldClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground";
const editableFields = (p: ManagedProduct) => JSON.stringify([
  p.title, p.mainImage, p.description, p.categoryCode,
  p.skus.map(s => [s.id, s.name, s.image, s.salePrice ?? null, s.options.map(o => [o.name, o.value])]),
]);
export function SourcingProductEditor({ companyId, projectId, product, settings, jobs, onSaved, onQueued, onDirty, onNext }: {
  companyId: string; projectId: string; product: ManagedProduct; settings: StoreSettings; jobs: PublicationJob[];
  onSaved: (product: ManagedProduct) => void; onQueued: () => void; onDirty: (value: boolean) => void; onNext?: () => void;
}) {
  const [section, setSection] = useState("basic");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [initialBuffer] = useState(() => readProductDraft(companyId, projectId, product.id));
  const [pendingBuffer, setPendingBuffer] = useState(initialBuffer.record && initialBuffer.record.baseRevision !== product.revision ? initialBuffer.record : null);
  const [bufferState, setBufferState] = useState<"saved" | "failed" | "none">(initialBuffer.failed ? "failed" : initialBuffer.record ? "saved" : "none");
  const [draft, setDraft] = useState(() => initialBuffer.record?.baseRevision === product.revision ? restoreProductDraft(product, initialBuffer.record) : product); const [stores, setStores] = useState<string[]>([]); const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<"save" | CatalogPricePreview | null>(null);
  const baseline = useRef(product);
  const nextAfterSave = useRef(false);
  const categoryStore = settings.stores.find(store => store.enabled && store.catalogSupported && store.provider === "coupang");
  const category = useQuery({ queryKey: ["sourcing-category", companyId, projectId, categoryStore?.id, draft.categoryCode], queryFn: () => sourcingCatalogApi.request<{ name: string }>(companyId, projectId, { operation: "category-metadata", storeId: categoryStore!.id, categoryCode: Number(draft.categoryCode) }), enabled: !!categoryStore && /^\d+$/.test(draft.categoryCode) && Number(draft.categoryCode) > 0, staleTime: 300000, retry: false });
  const request = useRef<Record<string, unknown> | null>(null);
  const [remoteIds, setRemoteIds] = useState<Record<string, string>>({});
  const dirty = editableFields(draft) !== editableFields(baseline.current);
  useEffect(() => { if (!dirty) { baseline.current = product; setDraft(product); } }, [product]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty || pendingBuffer) return;
    setBufferState(writeProductDraft(companyId, projectId, baseline.current.revision, draft) ? "saved" : "failed");
  }, [draft, dirty, pendingBuffer, companyId, projectId]);
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const protectNavigation = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || event.metaKey || event.ctrlKey || anchor.origin !== location.origin || anchor.href === location.href || anchor.hash && anchor.pathname === location.pathname && anchor.search === location.search) return;
      if (!window.confirm("서버에 저장하지 않은 변경이 있습니다. 이 화면에서 이동할까요?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", preventLoss);
    document.addEventListener("click", protectNavigation, true);
    return () => { window.removeEventListener("beforeunload", preventLoss); document.removeEventListener("click", protectNavigation, true); };
  }, [dirty]);
  function clearBuffer() { setPendingBuffer(null); setBufferState(clearProductDraft(companyId, projectId, product.id) ? "none" : "failed"); }

  const save = useMutation({ mutationFn: (confirmPriceChanges: boolean) => sourcingCatalogApi.request<ManagedProduct>(companyId, projectId, { operation: "save", productId: product.id, expectedRevision: draft.revision,
    title: draft.title, mainImage: draft.mainImage, description: draft.description, categoryCode: draft.categoryCode, skus: draft.skus, ...(confirmPriceChanges ? { confirmPriceChanges: true } : {}) }),
    onSuccess: p => {
      if (editableFields(p) !== editableFields(draft)) {
        nextAfterSave.current = false; baseline.current = p; setDraft(current => ({ ...current, revision: p.revision })); onSaved(p); setConfirmation(null);
        setError("서버 저장 결과가 편집 내용과 다릅니다. 변경 내용을 보존했습니다. 원본과 저장 결과를 확인한 뒤 다시 저장해 주세요."); return;
      }
      clearBuffer(); baseline.current = p; setDraft(p); onSaved(p); onDirty(false); setError(""); setConfirmation(null); if (nextAfterSave.current) { nextAfterSave.current = false; onNext?.(); } }, onError: e => { nextAfterSave.current = false; setError(catalogErrorMessage(e)); } });
  const queue = useMutation({ mutationFn: (priceConfirmation: string | undefined) => {
    request.current ??= { operation: "queue", productId: product.id, expectedRevision: product.revision, storeIds: stores, requestId: crypto.randomUUID(), ...(priceConfirmation ? { priceConfirmation } : {}) };
    return sourcingCatalogApi.request<PublicationJob[]>(companyId, projectId, request.current);
  }, onSuccess: rows => { request.current = null; setConfirmation(null); const failed = rows.filter(j => j.state === "failed"); setError(failed.length ? failed.map(j => `${settings.stores.find(s => s.id === j.storeId)?.name}: ${catalogErrorMessage(new Error(j.errorCode))}`).join(" / ") : ""); onQueued(); }, onError: e => {
    // Only an explicit pre-insert rejection permits a new request. Ambiguous transport errors retain the idempotency key.
    if (e instanceof ApiError && [400, 403, 409, 422].includes(e.status)) { request.current = null; setConfirmation(null); }
    setError(catalogErrorMessage(e));
  } });
  const preview = useMutation({ mutationFn: () => sourcingCatalogApi.request<CatalogPricePreview>(companyId, projectId, { operation: "price-preview", productId: product.id, expectedRevision: product.revision, storeIds: stores }),
    onSuccess: value => { setError(""); if (value.stores.some(s => s.changes.length > 0)) setConfirmation(value); else queue.mutate(value.confirmation); }, onError: e => setError(catalogErrorMessage(e)) });
  const priceChanges = draft.skus.flatMap(s => {
    const before = baseline.current.skus.find(p => p.id === s.id)?.salePrice ?? null;
    return before === (s.salePrice ?? null) ? [] : [{ skuId: s.id, name: s.name, before, after: s.salePrice ?? null }];
  });
  const invalidPrices = draft.skus.some(s => s.salePrice != null && (!Number.isInteger(s.salePrice) || s.salePrice <= 0 || s.salePrice > 1000000000 || s.salePrice % 10 !== 0));
  const won = (value: number | null) => value === null ? "미지정" : `${value.toLocaleString("ko-KR")}원`;
  const difference = (before: number | null, after: number | null) => before && after !== null ? `${after - before >= 0 ? "+" : ""}${(after - before).toLocaleString("ko-KR")}원 (${((after / before - 1) * 100).toFixed(1)}%)` : "새 가격 지정";
  const reconcile = useMutation({ mutationFn: (jobId: string) => sourcingCatalogApi.request(companyId, projectId, { operation: "reconcile", jobId, ...(remoteIds[jobId] ? { remoteProductId: remoteIds[jobId] } : {}) }), onSuccess: onQueued, onError: e => setError(catalogErrorMessage(e)) });
  const editSku = (index: number, patch: Partial<ManagedProduct["skus"][number]>) => setDraft({ ...draft, skus: draft.skus.map((s, i) => i === index ? { ...s, ...patch } : s) });
  const busy = !!pendingBuffer || save.isPending || queue.isPending || preview.isPending || !!request.current;
  return <aside aria-label="상품 편집" className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4">
    <header className="space-y-2"><div className="flex items-start justify-between gap-3"><h2 className="text-base font-semibold">{product.title}</h2>{product.sourceProvider === "taobao" && <a href={`https://item.taobao.com/item.htm?id=${encodeURIComponent(product.sourceProductId)}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-muted-foreground underline">원본 보기 ↗</a>}</div><p className="text-xs text-muted-foreground">{({ processing: "가공 중", ready: "등록 준비", queued: "등록 대기", attention: "확인 필요", uploaded: "등록됨" })[product.stage!] ?? (product.listings.length ? "등록됨" : "상품 초안")} · {product.sourceProvider === "taobao" ? "타오바오" : product.sourceProvider === "coupang" ? "쿠팡" : product.sourceProvider} · 옵션 {product.skus.length}개</p></header>
    <nav aria-label="상품 편집 구획" className="commerce-editor-tabs">{[["basic", "기본정보"], ["images", "이미지"], ["options", "옵션·가격"], ["stores", "쇼핑몰"]].map(([id, label]) => <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}</nav>
    <div className="commerce-editor-body space-y-4">
    {pendingBuffer && <section role="alert" className="space-y-3 rounded-md border border-border bg-muted p-3"><p className="text-sm">다른 저장 버전의 브라우저 임시 저장이 있습니다.</p><p className="text-sm">현재 서버 값은 자동으로 덮어쓰지 않습니다. 복구한 내용을 검토한 뒤 직접 저장해 주세요.</p><div className="flex gap-2"><Button variant="outline" onClick={clearBuffer}>임시 저장 폐기</Button><Button onClick={() => { setDraft(restoreProductDraft(product, pendingBuffer)); setPendingBuffer(null); }}>편집기로 복구</Button></div></section>}
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <div hidden={section !== "basic"} className="space-y-5"><div className="commerce-product-fields"><div>{draft.mainImage && <img src={previewImage ?? draft.mainImage} alt="상품 대표 이미지" className="commerce-product-photo" loading="lazy" referrerPolicy="no-referrer" />}<div className="mt-2 flex flex-wrap gap-2">{[...new Set([draft.mainImage, ...draft.skus.map(s => s.image)].filter(Boolean))].slice(0, 6).map((url, i) => <button key={url} type="button" aria-label={`상품 이미지 ${i + 1} 미리보기`} aria-pressed={(previewImage ?? draft.mainImage) === url} onClick={() => setPreviewImage(url)} className="rounded border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><img src={url} alt={`상품 이미지 ${i + 1}`} className="size-12 rounded object-contain" loading="lazy" referrerPolicy="no-referrer" /></button>)}</div></div><div className="min-w-0 space-y-5"><label className="grid gap-2 text-sm">상품명<input aria-label="상품명" className={fieldClass} maxLength={100} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><div className="space-y-2"><h3 className="text-sm">카테고리</h3><p className="rounded-md border border-border p-3 text-sm text-muted-foreground">{category.data?.name || (category.data ? "카테고리 이름 미제공" : category.isFetching ? "카테고리 조회 중" : draft.categoryCode ? "카테고리 이름을 확인할 수 없습니다." : "판매 카테고리 미지정")}</p></div><details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm">원본 정보</summary><p className="mt-2 break-words text-xs text-muted-foreground">{product.sourceProvider} · {product.sourceProductId}</p></details></div></div>
      <ProductDescription value={draft.description} onChange={description => setDraft({ ...draft, description })} />
      <div className="flex items-center justify-between rounded-md border border-border p-3"><div><h3 className="text-sm font-medium">옵션 {draft.skus.length}개</h3><p className="mt-1 text-xs text-muted-foreground">{invalidPrices ? "판매가 수정 필요" : draft.skus.some(s => s.salePrice == null) ? "판매가 확인 필요" : priceChanges.length ? "판매가 변경 확인 후 저장" : "판매가 저장됨 · 쇼핑몰 반영은 별도"}</p></div><Button type="button" variant="ghost" size="sm" onClick={() => setSection("options")}>옵션·가격 보기 →</Button></div>
      <div className="flex items-center justify-between rounded-md border border-border p-3"><div><h3 className="text-sm font-medium">쇼핑몰 등록 상태</h3><p className="mt-1 text-xs text-muted-foreground">{product.listings.length ? product.listings.map(l => `${settings.stores.find(store => store.id === l.storeId)?.name ?? "쇼핑몰"} · 등록됨`).join(" / ") : "등록된 쇼핑몰 없음"}</p></div><Button type="button" variant="ghost" size="sm" onClick={() => setSection("stores")}>쇼핑몰 보기 →</Button></div>
      <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm">원본·고급 상세</summary><dl className="space-y-2 py-3 text-xs text-muted-foreground"><div><dt>원본</dt><dd className="break-all">{product.sourceProvider} · {product.sourceProductId}</dd></div><div><dt>저장 버전</dt><dd>{draft.revision}</dd></div></dl><label className="grid gap-1 text-sm">카테고리 코드<input aria-label="카테고리 코드" className={fieldClass} value={draft.categoryCode} disabled={!!product.listings.length} onChange={e => setDraft({ ...draft, categoryCode: e.target.value })} /><span className="text-xs text-muted-foreground">쿠팡에 이미 등록한 상품의 카테고리는 변경할 수 없습니다.</span></label>
</details></div>
      <div hidden={section !== "images"} className="space-y-3">      <label className="grid gap-1 text-sm">대표 이미지 URL<input aria-label="대표 이미지 URL" className={fieldClass} value={draft.mainImage} onChange={e => setDraft({ ...draft, mainImage: e.target.value })} /></label>
<p className="text-xs text-muted-foreground">옵션별 사진은 옵션·가격에서 수정할 수 있습니다.</p></div>
      <div hidden={section !== "options"} className="space-y-3"><h3 className="text-sm font-medium">옵션·가격</h3>{draft.skus.map((s, i) => <fieldset key={s.id} className="space-y-2 rounded-md border border-border p-3"><legend className="text-xs text-muted-foreground">옵션 {i + 1}</legend>
        <label className="grid gap-1 text-sm">옵션 상품명<input aria-label={`옵션 ${i + 1} 상품명`} className={fieldClass} maxLength={150} value={s.name} onChange={e => editSku(i, { name: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">옵션 이미지 URL<input aria-label={`옵션 ${i + 1} 이미지`} className={fieldClass} value={s.image} onChange={e => editSku(i, { image: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">판매가격 (원)<input aria-label={`옵션 ${i + 1} 판매가격`} type="number" min={10} max={1000000000} step={10} inputMode="numeric" className={fieldClass} value={s.salePrice ?? ""} placeholder="미지정" onChange={e => editSku(i, { salePrice: e.target.value === "" ? null : Number(e.target.value) })} /><span className="text-xs text-muted-foreground">수집 원가와 별도로 저장합니다. 쿠팡 판매가격은 10원 단위입니다.</span></label>
        {s.options.map((o, n) => <div key={n} className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs">옵션명<input aria-label={`옵션 ${i + 1}-${n + 1} 이름`} className={fieldClass} maxLength={100} value={o.name} onChange={e => editSku(i, { options: s.options.map((a, j) => j === n ? { ...a, name: e.target.value } : a) })} /></label><label className="grid gap-1 text-xs">옵션값<input aria-label={`옵션 ${i + 1}-${n + 1} 값`} className={fieldClass} maxLength={100} value={o.value} onChange={e => editSku(i, { options: s.options.map((a, j) => j === n ? { ...a, value: e.target.value } : a) })} /></label></div>)}
      </fieldset>)}</div>
    </fieldset>
    <div hidden={section !== "stores"} className="space-y-3"><fieldset disabled={busy} className="space-y-3 border-t border-border pt-4"><legend className="text-sm font-semibold">쇼핑몰 선택</legend>
      {settings.businesses.map(b => <div key={b.id} className="space-y-2"><h3 className="text-sm font-medium">{b.name}</h3>{settings.stores.filter(s => s.businessId === b.id).map(s => {
        const listing = product.listings.find(l => l.storeId === s.id); const job = jobs.find(j => j.productId === product.id && j.storeId === s.id);
        return <div key={s.id} className="space-y-1"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={stores.includes(s.id)} disabled={!s.enabled || !s.catalogSupported} onChange={e => setStores(e.target.checked ? [...stores, s.id] : stores.filter(id => id !== s.id))} /><span>{s.name} · {listing ? "등록됨 / 수정" : "미등록 / 추가 등록"}{!s.catalogSupported && " · 연동 준비 중"}</span></label>{listing && <p className="pl-6 text-xs text-muted-foreground">등록 상품 {listing.remoteProductId} · 반영 버전 {listing.publishedRevision}</p>}{job && <p className="pl-6 text-xs text-muted-foreground">{publicationStates[job.state]}{job.errorCode ? ` · ${catalogErrorMessage(new Error(job.errorCode))}` : ""}</p>}</div>;
      })}</div>)}
      {!settings.stores.length && <p className="text-sm text-muted-foreground">쇼핑몰 관리 설정에서 쇼핑몰을 등록해 주세요.</p>}
    </fieldset>
    <p className="text-xs text-muted-foreground">선택한 쇼핑몰별로 작업을 큐에 넣습니다. 등록된 상품은 수정하고, 미등록 쇼핑몰에는 추가 등록합니다. 쿠팡 검수 승인은 별도입니다.</p>
    <Button disabled={dirty || queue.isPending || preview.isPending || !stores.length} onClick={() => request.current ? queue.mutate(undefined) : preview.mutate()}>{preview.isPending ? "기존 가격 확인 중" : queue.isPending ? "큐에 넣는 중" : request.current ? "등록 결과 다시 확인" : "선택 쇼핑몰 업로드"}</Button>
    {jobs.filter(j => j.productId === product.id && j.state === "readback_pending").map(j => <Button key={j.id} variant="outline" disabled={reconcile.isPending} onClick={() => reconcile.mutate(j.id)}>{settings.stores.find(s => s.id === j.storeId)?.name} 반영 확인</Button>)}
    {jobs.filter(j => j.productId === product.id && j.state === "outcome_unknown").map(j => <div key={j.id} className="space-y-2 rounded-md border border-border p-3"><p className="text-sm text-destructive">{settings.stores.find(s => s.id === j.storeId)?.name}: 중복 등록을 막기 위해 자동 재전송을 중지했습니다.</p>{!j.remoteProductId && <label className="grid gap-1 text-sm">쿠팡에서 확인한 등록 상품 ID<input aria-label="결과 확인 상품 ID" className={fieldClass} value={remoteIds[j.id] ?? ""} inputMode="numeric" onChange={e => setRemoteIds({ ...remoteIds, [j.id]: e.target.value })} /></label>}<Button variant="outline" disabled={reconcile.isPending || !j.remoteProductId && !/^\d{1,30}$/.test(remoteIds[j.id] ?? "")} onClick={() => reconcile.mutate(j.id)}>등록 결과 확인</Button></div>)}
    </div>
    {bufferState === "failed" && <p role="alert" className="text-xs text-destructive">브라우저 임시 저장을 보관하거나 정리하지 못했습니다. 현재 편집은 서버 저장 전이며 이전 임시 저장이 남아 있을 수 있습니다.</p>}
    </div><footer className="commerce-savebar"><span role="status" className="text-xs text-muted-foreground">{pendingBuffer ? "다른 버전 임시 저장 확인 필요" : dirty ? bufferState === "saved" ? "브라우저 임시 저장됨 · 서버 저장 전" : "서버 저장 전 · 변경 있음" : "서버에 저장됨"}</span><div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={!dirty || busy} onClick={() => { nextAfterSave.current = false; clearBuffer(); baseline.current = product; setDraft(product); setError(""); }}>변경 취소</Button><Button variant="outline" disabled={!dirty || busy || invalidPrices} onClick={() => { nextAfterSave.current = false; priceChanges.length ? setConfirmation("save") : save.mutate(false); }}>{save.isPending ? "저장 중" : "변경 저장"}</Button>{onNext && <><Button disabled={!dirty || busy || invalidPrices} onClick={() => { nextAfterSave.current = true; priceChanges.length ? setConfirmation("save") : save.mutate(false); }}>저장하고 다음 상품 →</Button><Button variant="ghost" disabled={dirty || busy} onClick={onNext}>다음 상품</Button></>}</div></footer>
    {invalidPrices && <p role="alert" className="text-sm text-destructive">판매가격은 10원 이상의 10원 단위로 입력해 주세요.</p>}
    <Dialog open={confirmation !== null} onOpenChange={open => { if (!open && !save.isPending && !queue.isPending) { nextAfterSave.current = false; setConfirmation(null); } }}><DialogContent className="max-h-screen overflow-y-auto"><DialogHeader><DialogTitle>{confirmation === "save" ? "판매가격 변경 확인" : "쇼핑몰 가격 반영 확인"}</DialogTitle><DialogDescription>{confirmation === "save" ? "기존에 저장한 가격과 비교한 뒤 변경을 저장합니다." : "선택한 쇼핑몰의 현재 가격과 비교한 결과입니다. 확인한 가격으로 큐에 등록합니다."}</DialogDescription></DialogHeader>
      {(confirmation === "save" ? [{ storeId: "", changes: priceChanges }] : confirmation?.stores ?? []).filter(s => s.changes.length).map(s => <section key={s.storeId} className="space-y-2">{s.storeId && <h3 className="font-medium">{settings.stores.find(store => store.id === s.storeId)?.name}</h3>}<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">옵션</th><th className="p-2">기존 가격</th><th className="p-2">변경 가격</th><th className="p-2">증감</th></tr></thead><tbody>{s.changes.map(c => <tr key={c.skuId} className="border-t border-border"><td className="p-2">{c.name}</td><td className="p-2">{won(c.before)}</td><td className="p-2">{won(c.after)}</td><td className="p-2">{difference(c.before, c.after)}</td></tr>)}</tbody></table></div></section>)}
      <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={save.isPending || queue.isPending} onClick={() => { nextAfterSave.current = false; setConfirmation(null); }}>취소</Button><Button disabled={save.isPending || queue.isPending} onClick={() => confirmation === "save" ? save.mutate(true) : confirmation && queue.mutate(confirmation.confirmation)}>{confirmation === "save" ? "가격 변경 저장" : "확인 후 큐 등록"}</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent></Dialog>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </aside>;
}
