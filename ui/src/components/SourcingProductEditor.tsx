import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ManagedProduct, PublicationJob, StoreSettings, CatalogPricePreview } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { ApiError } from "../api/client";
import { catalogErrorMessage, publicationStates } from "../lib/sourcing-catalog";
import { ProductDescription } from "./ProductDescription";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";

const fieldClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground";
const editableFields = (p: ManagedProduct) => JSON.stringify([p.title, p.mainImage, p.description, p.categoryCode, p.skus]);
export function SourcingProductEditor({ companyId, projectId, product, settings, jobs, onSaved, onQueued, onDirty }: {
  companyId: string; projectId: string; product: ManagedProduct; settings: StoreSettings; jobs: PublicationJob[];
  onSaved: (product: ManagedProduct) => void; onQueued: () => void; onDirty: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(product); const [stores, setStores] = useState<string[]>([]); const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<"save" | CatalogPricePreview | null>(null);
  const baseline = useRef(product);
  const request = useRef<Record<string, unknown> | null>(null);
  const [remoteIds, setRemoteIds] = useState<Record<string, string>>({});
  const dirty = editableFields(draft) !== editableFields(baseline.current);
  useEffect(() => { if (!dirty) { baseline.current = product; setDraft(product); } }, [product]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const save = useMutation({ mutationFn: (confirmPriceChanges: boolean) => sourcingCatalogApi.request<ManagedProduct>(companyId, projectId, { operation: "save", productId: product.id, expectedRevision: draft.revision,
    title: draft.title, mainImage: draft.mainImage, description: draft.description, categoryCode: draft.categoryCode, skus: draft.skus, ...(confirmPriceChanges ? { confirmPriceChanges: true } : {}) }),
    onSuccess: p => { baseline.current = p; setDraft(p); onSaved(p); setError(""); setConfirmation(null); }, onError: e => setError(catalogErrorMessage(e)) });
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
  const busy = save.isPending || queue.isPending || preview.isPending || !!request.current;
  return <aside aria-label="상품 편집" className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">상품 편집</h2><span className="text-xs text-muted-foreground">{dirty ? "저장하지 않은 변경 있음" : "저장됨"} · 버전 {draft.revision}</span></div>
    {draft.mainImage && <img src={draft.mainImage} alt="상품 대표 이미지" className="mx-auto size-40 rounded-md object-contain sm:size-48" loading="lazy" referrerPolicy="no-referrer" />}
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <label className="grid gap-1 text-sm">상품명<input aria-label="상품명" className={fieldClass} maxLength={100} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="grid gap-1 text-sm">대표 이미지 URL<input aria-label="대표 이미지 URL" className={fieldClass} value={draft.mainImage} onChange={e => setDraft({ ...draft, mainImage: e.target.value })} /></label>
      <label className="grid gap-1 text-sm">카테고리 코드<input aria-label="카테고리 코드" className={fieldClass} value={draft.categoryCode} disabled={!!product.listings.length} onChange={e => setDraft({ ...draft, categoryCode: e.target.value })} /><span className="text-xs text-muted-foreground">쿠팡에 이미 등록한 상품의 카테고리는 변경할 수 없습니다.</span></label>
      <ProductDescription value={draft.description} onChange={description => setDraft({ ...draft, description })} />
      <h3 className="text-sm font-medium">옵션</h3>{draft.skus.map((s, i) => <fieldset key={s.id} className="space-y-2 rounded-md border border-border p-3"><legend className="text-xs text-muted-foreground">옵션 {i + 1}</legend>
        <label className="grid gap-1 text-sm">옵션 상품명<input aria-label={`옵션 ${i + 1} 상품명`} className={fieldClass} maxLength={150} value={s.name} onChange={e => editSku(i, { name: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">옵션 이미지 URL<input aria-label={`옵션 ${i + 1} 이미지`} className={fieldClass} value={s.image} onChange={e => editSku(i, { image: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">판매가격 (원)<input aria-label={`옵션 ${i + 1} 판매가격`} type="number" min={10} max={1000000000} step={10} inputMode="numeric" className={fieldClass} value={s.salePrice ?? ""} placeholder="미지정" onChange={e => editSku(i, { salePrice: e.target.value === "" ? null : Number(e.target.value) })} /><span className="text-xs text-muted-foreground">수집 원가와 별도로 저장합니다. 쿠팡 판매가격은 10원 단위입니다.</span></label>
        {s.options.map((o, n) => <div key={n} className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs">옵션명<input aria-label={`옵션 ${i + 1}-${n + 1} 이름`} className={fieldClass} maxLength={100} value={o.name} onChange={e => editSku(i, { options: s.options.map((a, j) => j === n ? { ...a, name: e.target.value } : a) })} /></label><label className="grid gap-1 text-xs">옵션값<input aria-label={`옵션 ${i + 1}-${n + 1} 값`} className={fieldClass} maxLength={100} value={o.value} onChange={e => editSku(i, { options: s.options.map((a, j) => j === n ? { ...a, value: e.target.value } : a) })} /></label></div>)}
      </fieldset>)}
    </fieldset>
    <div className="flex gap-2"><Button disabled={!dirty || busy || invalidPrices} onClick={() => priceChanges.length ? setConfirmation("save") : save.mutate(false)}>{save.isPending ? "저장 중" : "변경 저장"}</Button><Button variant="outline" disabled={!dirty || busy} onClick={() => { baseline.current = product; setDraft(product); setError(""); }}>변경 취소</Button></div>
    <fieldset disabled={busy} className="space-y-3 border-t border-border pt-4"><legend className="text-sm font-semibold">쇼핑몰 선택</legend>
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
    {invalidPrices && <p role="alert" className="text-sm text-destructive">판매가격은 10원 이상의 10원 단위로 입력해 주세요.</p>}
    <Dialog open={confirmation !== null} onOpenChange={open => { if (!open && !save.isPending && !queue.isPending) setConfirmation(null); }}><DialogContent className="max-h-screen overflow-y-auto"><DialogHeader><DialogTitle>{confirmation === "save" ? "판매가격 변경 확인" : "쇼핑몰 가격 반영 확인"}</DialogTitle><DialogDescription>{confirmation === "save" ? "기존에 저장한 가격과 비교한 뒤 변경을 저장합니다." : "선택한 쇼핑몰의 현재 가격과 비교한 결과입니다. 확인한 가격으로 큐에 등록합니다."}</DialogDescription></DialogHeader>
      {(confirmation === "save" ? [{ storeId: "", changes: priceChanges }] : confirmation?.stores ?? []).filter(s => s.changes.length).map(s => <section key={s.storeId} className="space-y-2">{s.storeId && <h3 className="font-medium">{settings.stores.find(store => store.id === s.storeId)?.name}</h3>}<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">옵션</th><th className="p-2">기존 가격</th><th className="p-2">변경 가격</th><th className="p-2">증감</th></tr></thead><tbody>{s.changes.map(c => <tr key={c.skuId} className="border-t border-border"><td className="p-2">{c.name}</td><td className="p-2">{won(c.before)}</td><td className="p-2">{won(c.after)}</td><td className="p-2">{difference(c.before, c.after)}</td></tr>)}</tbody></table></div></section>)}
      <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={save.isPending || queue.isPending} onClick={() => setConfirmation(null)}>취소</Button><Button disabled={save.isPending || queue.isPending} onClick={() => confirmation === "save" ? save.mutate(true) : confirmation && queue.mutate(confirmation.confirmation)}>{confirmation === "save" ? "가격 변경 저장" : "확인 후 큐 등록"}</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent></Dialog>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </aside>;
}
