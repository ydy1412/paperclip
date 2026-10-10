import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ManagedProduct, PublicationJob, StoreSettings } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { catalogErrorMessage, publicationStates } from "../lib/sourcing-catalog";
import { Button } from "./ui/button";

const fieldClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground";
const editableFields = (p: ManagedProduct) => JSON.stringify([p.title, p.mainImage, p.description, p.categoryCode, p.skus]);
export function SourcingProductEditor({ companyId, projectId, product, settings, jobs, onSaved, onQueued, onDirty }: {
  companyId: string; projectId: string; product: ManagedProduct; settings: StoreSettings; jobs: PublicationJob[];
  onSaved: (product: ManagedProduct) => void; onQueued: () => void; onDirty: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(product); const [stores, setStores] = useState<string[]>([]); const [error, setError] = useState("");
  const baseline = useRef(product);
  const request = useRef<Record<string, unknown> | null>(null);
  const [remoteIds, setRemoteIds] = useState<Record<string, string>>({});
  const dirty = editableFields(draft) !== editableFields(baseline.current);
  useEffect(() => { if (!dirty) { baseline.current = product; setDraft(product); } }, [product]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const save = useMutation({ mutationFn: () => sourcingCatalogApi.request<ManagedProduct>(companyId, projectId, { operation: "save", productId: product.id, expectedRevision: draft.revision,
    title: draft.title, mainImage: draft.mainImage, description: draft.description, categoryCode: draft.categoryCode, skus: draft.skus }),
    onSuccess: p => { baseline.current = p; setDraft(p); onSaved(p); setError(""); }, onError: e => setError(catalogErrorMessage(e)) });
  const queue = useMutation({ mutationFn: () => {
    request.current ??= { operation: "queue", productId: product.id, expectedRevision: product.revision, storeIds: stores, requestId: crypto.randomUUID() };
    return sourcingCatalogApi.request<PublicationJob[]>(companyId, projectId, request.current);
  }, onSuccess: rows => { request.current = null; const failed = rows.filter(j => j.state === "failed"); setError(failed.length ? failed.map(j => `${settings.stores.find(s => s.id === j.storeId)?.name}: ${catalogErrorMessage(new Error(j.errorCode))}`).join(" / ") : ""); onQueued(); }, onError: e => setError(catalogErrorMessage(e)) });
  const reconcile = useMutation({ mutationFn: (jobId: string) => sourcingCatalogApi.request(companyId, projectId, { operation: "reconcile", jobId, ...(remoteIds[jobId] ? { remoteProductId: remoteIds[jobId] } : {}) }), onSuccess: onQueued, onError: e => setError(catalogErrorMessage(e)) });
  const editSku = (index: number, patch: Partial<ManagedProduct["skus"][number]>) => setDraft({ ...draft, skus: draft.skus.map((s, i) => i === index ? { ...s, ...patch } : s) });
  const busy = save.isPending || queue.isPending || !!request.current;
  return <aside aria-label="상품 편집" className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">상품 편집</h2><span className="text-xs text-muted-foreground">{dirty ? "저장하지 않은 변경 있음" : "저장됨"} · 버전 {draft.revision}</span></div>
    {draft.mainImage && <img src={draft.mainImage} alt="상품 대표 이미지" className="mx-auto size-40 rounded-md object-contain sm:size-48" loading="lazy" referrerPolicy="no-referrer" />}
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <label className="grid gap-1 text-sm">상품명<input aria-label="상품명" className={fieldClass} maxLength={100} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="grid gap-1 text-sm">대표 이미지 URL<input aria-label="대표 이미지 URL" className={fieldClass} value={draft.mainImage} onChange={e => setDraft({ ...draft, mainImage: e.target.value })} /></label>
      <label className="grid gap-1 text-sm">카테고리 코드<input aria-label="카테고리 코드" className={fieldClass} value={draft.categoryCode} disabled={!!product.listings.length} onChange={e => setDraft({ ...draft, categoryCode: e.target.value })} /><span className="text-xs text-muted-foreground">쿠팡에 이미 등록한 상품의 카테고리는 변경할 수 없습니다.</span></label>
      <label className="grid gap-1 text-sm">상세 설명<textarea aria-label="상세 설명" className={fieldClass} rows={5} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <h3 className="text-sm font-medium">옵션</h3>{draft.skus.map((s, i) => <fieldset key={s.id} className="space-y-2 rounded-md border border-border p-3"><legend className="text-xs text-muted-foreground">옵션 {i + 1}</legend>
        <label className="grid gap-1 text-sm">옵션 상품명<input aria-label={`옵션 ${i + 1} 상품명`} className={fieldClass} maxLength={150} value={s.name} onChange={e => editSku(i, { name: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">옵션 이미지 URL<input aria-label={`옵션 ${i + 1} 이미지`} className={fieldClass} value={s.image} onChange={e => editSku(i, { image: e.target.value })} /></label>
        {s.options.map((o, n) => <div key={n} className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs">옵션명<input aria-label={`옵션 ${i + 1}-${n + 1} 이름`} className={fieldClass} maxLength={100} value={o.name} onChange={e => editSku(i, { options: s.options.map((a, j) => j === n ? { ...a, name: e.target.value } : a) })} /></label><label className="grid gap-1 text-xs">옵션값<input aria-label={`옵션 ${i + 1}-${n + 1} 값`} className={fieldClass} maxLength={100} value={o.value} onChange={e => editSku(i, { options: s.options.map((a, j) => j === n ? { ...a, value: e.target.value } : a) })} /></label></div>)}
      </fieldset>)}
    </fieldset>
    <div className="flex gap-2"><Button disabled={!dirty || busy} onClick={() => save.mutate()}>{save.isPending ? "저장 중" : "변경 저장"}</Button><Button variant="outline" disabled={!dirty || busy} onClick={() => { baseline.current = product; setDraft(product); setError(""); }}>변경 취소</Button></div>
    <fieldset disabled={busy} className="space-y-3 border-t border-border pt-4"><legend className="text-sm font-semibold">쇼핑몰 선택</legend>
      {settings.businesses.map(b => <div key={b.id} className="space-y-2"><h3 className="text-sm font-medium">{b.name}</h3>{settings.stores.filter(s => s.businessId === b.id).map(s => {
        const listing = product.listings.find(l => l.storeId === s.id); const job = jobs.find(j => j.productId === product.id && j.storeId === s.id);
        return <div key={s.id} className="space-y-1"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={stores.includes(s.id)} disabled={!s.enabled || !s.catalogSupported} onChange={e => setStores(e.target.checked ? [...stores, s.id] : stores.filter(id => id !== s.id))} /><span>{s.name} · {listing ? "등록됨 / 수정" : "미등록 / 추가 등록"}{!s.catalogSupported && " · 연동 준비 중"}</span></label>{listing && <p className="pl-6 text-xs text-muted-foreground">등록 상품 {listing.remoteProductId} · 반영 버전 {listing.publishedRevision}</p>}{job && <p className="pl-6 text-xs text-muted-foreground">{publicationStates[job.state]}{job.errorCode ? ` · ${catalogErrorMessage(new Error(job.errorCode))}` : ""}</p>}</div>;
      })}</div>)}
      {!settings.stores.length && <p className="text-sm text-muted-foreground">쇼핑몰 관리 설정에서 쇼핑몰을 등록해 주세요.</p>}
    </fieldset>
    <p className="text-xs text-muted-foreground">선택한 쇼핑몰별로 작업을 큐에 넣습니다. 등록된 상품은 수정하고, 미등록 쇼핑몰에는 추가 등록합니다. 쿠팡 검수 승인은 별도입니다.</p>
    <Button disabled={dirty || queue.isPending || !stores.length} onClick={() => queue.mutate()}>{queue.isPending ? "큐에 넣는 중" : request.current ? "등록 결과 다시 확인" : "선택 쇼핑몰 업로드"}</Button>
    {jobs.filter(j => j.productId === product.id && j.state === "readback_pending").map(j => <Button key={j.id} variant="outline" disabled={reconcile.isPending} onClick={() => reconcile.mutate(j.id)}>{settings.stores.find(s => s.id === j.storeId)?.name} 반영 확인</Button>)}
    {jobs.filter(j => j.productId === product.id && j.state === "outcome_unknown").map(j => <div key={j.id} className="space-y-2 rounded-md border border-border p-3"><p className="text-sm text-destructive">{settings.stores.find(s => s.id === j.storeId)?.name}: 중복 등록을 막기 위해 자동 재전송을 중지했습니다.</p>{!j.remoteProductId && <label className="grid gap-1 text-sm">쿠팡에서 확인한 등록 상품 ID<input aria-label="결과 확인 상품 ID" className={fieldClass} value={remoteIds[j.id] ?? ""} inputMode="numeric" onChange={e => setRemoteIds({ ...remoteIds, [j.id]: e.target.value })} /></label>}<Button variant="outline" disabled={reconcile.isPending || !j.remoteProductId && !/^\d{1,30}$/.test(remoteIds[j.id] ?? "")} onClick={() => reconcile.mutate(j.id)}>등록 결과 확인</Button></div>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </aside>;
}
