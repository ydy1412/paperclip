import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sourcingApi, processingApi, processingSavePayload, type SourcingAccount, type ProcessingSource, type ProcessingView, type ProcessingSummary, type ProcessingCrop } from "../api/sourcing";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function SourcingProcessing({ companyId, projectId }: { companyId: string; projectId: string }) {
  const [accountId, setAccountId] = useState("");
  const plugin = useQuery({ queryKey: ["sourcing-plugin", companyId], queryFn: sourcingApi.plugin, enabled: !!companyId, retry: false });
  const pluginId = plugin.data?.id;
  const accounts = useQuery({ queryKey: ["sourcing-accounts", companyId, projectId, pluginId],
    queryFn: () => sourcingApi.data<SourcingAccount[]>(pluginId!, companyId, projectId, "accounts"), enabled: !!pluginId && !!projectId, retry: false });
  const selected = accounts.data?.find(a => a.id === accountId && a.enabled)?.id ?? "";
  return <section aria-label="상품 가공" className="space-y-4">
    <p className="text-sm text-muted-foreground">수집 원본을 확인하고 한국어 상품명과 옵션을 초안으로 저장합니다. 카테고리 검수와 이미지 가공은 별도 확인이 필요합니다.</p>
    {(!companyId || !projectId) ? <p>회사와 프로젝트를 선택해 주세요.</p> : <>
      {(plugin.error || accounts.error) && <p role="alert">상품 가공 연결을 확인하지 못했습니다.</p>}
      {!plugin.isLoading && !pluginId && <p role="status">상품 가공 서비스 미연결</p>}
      <label className="grid gap-2 text-sm">판매 계정<select aria-label="가공 판매 계정" className="rounded-md border border-input bg-background p-2" value={selected} disabled={!!accounts.error}
        onChange={event => setAccountId(event.target.value)}><option value="">계정 선택</option>{accounts.data?.filter(a => a.enabled).map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}</select></label>
      {pluginId && selected && <ProcessingWorkspace key={`${companyId}:${projectId}:${selected}`} pluginId={pluginId} companyId={companyId} projectId={projectId} accountId={selected} />}
    </>}
  </section>;
}

function ProcessingWorkspace({ pluginId, companyId, projectId, accountId }: { pluginId: string; companyId: string; projectId: string; accountId: string }) {
  const [productId, setProductId] = useState("");
  const [source, setSource] = useState<ProcessingSource | null>(null);
  const [skus, setSkus] = useState<string[]>([]);
  const [view, setView] = useState<ProcessingView | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const read = <T,>(operation: string, input: Record<string, unknown> = {}) => processingApi.read<T>(pluginId, companyId, projectId, accountId, operation, input);
  const drafts = useQuery({ queryKey: ["processing-drafts", companyId, projectId, accountId], queryFn: () => read<ProcessingSummary[]>("list"), retry: false });
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "가공 요청 실패"); } finally { setBusy(false); }
  }
  async function load(id: string) { setView(await read<ProcessingView>("get", { draftId: id })); setDirty(false); }
  function edit(change: (next: ProcessingView) => void) {
    if (!view) return;
    const next = structuredClone(view); change(next); setView(next); setDirty(true); setMessage("");
  }
  return <div className="space-y-4">
    {drafts.error && <p role="alert">초안 목록 조회 실패 · 가공 서비스 연결과 권한을 확인해 주세요.</p>}
    <label className="grid gap-2 text-sm">저장된 초안<select aria-label="저장된 초안" className="rounded-md border border-input bg-background p-2" value={view?.draft.id ?? ""} disabled={busy || dirty}
      onChange={e => { const id = e.target.value; if (id) void run(() => load(id)); }}><option value="">초안 선택</option>
      {drafts.data?.map(d => <option key={d.id} value={d.id}>{d.name || d.productId} · 수정 {d.revision}</option>)}</select></label>
    <fieldset disabled={busy || dirty} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-2 text-sm">원본 상품 ID<Input value={productId} onChange={e => setProductId(e.target.value)} /></label>
      <Button variant="outline" disabled={!productId} onClick={() => void run(async () => { setSource(null); setSkus([]); setSource(await read<ProcessingSource>("source", { sourceProvider: "taobao", productId })); })}>원본 조회</Button>
    </fieldset>
    {source && <div className="space-y-2"><p>{source.title}</p><p className="break-all text-xs text-muted-foreground">원본 hash {source.sourceHash}</p>
      {source.skus.map(s => <label key={s.skuId} className="flex gap-2 text-sm"><input type="checkbox" disabled={busy || dirty} checked={skus.includes(s.skuId)} onChange={e => setSkus(current => e.target.checked ? [...current, s.skuId] : current.filter(id => id !== s.skuId))} />{s.skuId} · {s.options.map(o => o.value).join(" / ")}</label>)}
      <Button disabled={busy || dirty || !skus.length} onClick={() => void run(async () => { const created = await processingApi.write(pluginId, companyId, projectId, accountId, "create", { sourceProvider: source.provider, productId: source.productId, skuIds: skus }); await load(created.draft.id); await drafts.refetch(); setMessage("초안을 저장하고 다시 조회했습니다."); })}>선택 SKU로 초안 만들기</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {view && <fieldset disabled={busy} className="space-y-4">
      <p className="text-xs text-muted-foreground">초안 {view.draft.id} · 수정 {view.draft.revision}{dirty ? " · 저장하지 않은 변경" : ""}</p>
      <div className="grid gap-4 md:grid-cols-2"><div><p className="text-xs text-muted-foreground">원본 상품명</p><p>{view.draft.originalName}</p></div>
        <label className="grid gap-2 text-sm">한국어 상품명<Input value={view.draft.name} maxLength={100} onChange={e => edit(n => { n.draft.name = e.target.value; })} /></label></div>
      {view.draft.items.map((item, index) => {
        const original = view.source.skus.find(s => s.skuId === item.sourceSkuId)!;
        const images = [...new Set([...original.images, ...view.source.images.filter(i => i.skuId === item.sourceSkuId).map(i => i.src)])];
        return <section key={item.sourceSkuId} className="space-y-3 rounded-md border border-border p-4">
          <h3 className="text-sm font-semibold">SKU {item.sourceSkuId}</h3>
          <p className="text-xs text-muted-foreground">원가 {(original.discountedPriceMinor ?? original.originalPriceMinor) === null ? "미확인" : `${(original.discountedPriceMinor ?? original.originalPriceMinor)! / 100} ${original.currency}`} · 원본 수량 {original.reportedQuantity ?? "미확인"}</p>
          <div className="grid gap-4 md:grid-cols-2"><p>{item.originalName}</p><label className="grid gap-2 text-sm">한국어 옵션명<Input value={item.name} maxLength={150} onChange={e => edit(n => { n.draft.items[index].name = e.target.value; })} /></label></div>
          {item.options.map((option, oi) => <div key={option.ordinal} className="grid gap-4 md:grid-cols-2"><p className="text-sm">{option.originalName}: {option.originalValue}</p><div className="grid gap-2"><Input aria-label={`${item.sourceSkuId} 옵션 ${oi + 1} 항목명`} value={option.name} onChange={e => edit(n => { n.draft.items[index].options[oi].name = e.target.value; })} /><Input aria-label={`${item.sourceSkuId} 옵션 ${oi + 1} 값`} value={option.value} onChange={e => edit(n => { n.draft.items[index].options[oi].value = e.target.value; })} /></div></div>)}
          <label className="grid gap-2 text-sm">대표 이미지<select className="rounded-md border border-input bg-background p-2" value={item.representativeImageUrl} onChange={e => edit(n => { n.draft.items[index].representativeImageUrl = e.target.value; })}><option value="">이미지 선택</option>{images.map((url, i) => <option key={url} value={url}>원본 이미지 {i + 1} · {url}</option>)}</select></label>
          {/^https:\/\//.test(item.representativeImageUrl) && <img src={item.representativeImageUrl} alt={`${item.sourceSkuId} 원본 대표 이미지`} referrerPolicy="no-referrer" className="h-40 w-40 rounded-md object-contain" />}
          <Button variant="outline" disabled={!item.representativeImageUrl} onClick={() => edit(n => { n.draft.cropPlans.push({ sourceSkuId: item.sourceSkuId, imageUrl: item.representativeImageUrl, sourceWidth: 0, sourceHeight: 0, x: 0, y: 0, width: 0, height: 0, outputWidth: 0, outputHeight: 0, purpose: "대표 이미지" }); })}>자르기 계획 추가</Button>
        </section>;
      })}
      {view.draft.cropPlans.map((crop, index) => <section key={index} className="space-y-2 rounded-md border border-border p-4"><p className="text-sm">{crop.sourceSkuId} 이미지 자르기 계획 · 원본 크기 확인 필요 · 픽셀 가공 미완료</p>
        <div className="grid gap-2 md:grid-cols-4">{([['sourceWidth','원본 너비'],['sourceHeight','원본 높이'],['x','시작 X'],['y','시작 Y'],['width','자르기 너비'],['height','자르기 높이'],['outputWidth','출력 너비'],['outputHeight','출력 높이']] as const).map(([key,label]) => <label key={key} className="grid gap-1 text-xs">{label}<Input type="number" min={key === "x" || key === "y" ? 0 : 1} value={crop[key]} onChange={e => edit(n => { (n.draft.cropPlans[index][key] as ProcessingCrop[typeof key]) = Number(e.target.value); })} /></label>)}</div>
        <label className="grid gap-1 text-xs">용도<Input value={crop.purpose} onChange={e => edit(n => { n.draft.cropPlans[index].purpose = e.target.value; })} /></label>
        <Button variant="outline" onClick={() => edit(n => { n.draft.cropPlans.splice(index, 1); })}>계획 삭제</Button>
      </section>)}
      <section aria-label="검수 결과" className="space-y-2"><h3 className="text-sm font-semibold">검수 미완료</h3><p className="text-sm">카테고리 {view.draft.categoryCode ?? "미선택"} · 필수 속성 근거 미확인 · 이미지 자르기 {view.cropStatus === "pending" ? "계획만 저장됨" : "요청 없음"}</p>
        {dirty && <p className="text-sm">검증 결과는 마지막 저장본 기준입니다.</p>}
        <ul className="space-y-1 text-xs">{view.draft.issues.map((issue, i) => <li key={i}>{issue.field}: {issue.message || issue.code}</li>)}</ul>
        <details><summary className="text-xs">원본 근거 확인</summary><p className="break-all text-xs">{view.source.sourceHash}</p>{view.source.files.map(f => <p key={f.locator} className="break-all text-xs">{f.locator} · {f.hash} · {f.size} bytes</p>)}</details>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" onClick={() => void run(() => load(view.draft.id))}>{dirty ? "변경 취소하고 재조회" : "재조회"}</Button><div className="flex gap-2">
        <Button variant="outline" disabled={dirty} onClick={() => void run(async () => { setView(await read<ProcessingView>("validate", { draftId: view.draft.id, expectedRevision: view.draft.revision })); setMessage("저장본 검증 완료 · 미확인 항목을 확인해 주세요."); })}>저장본 검증</Button>
        <Button disabled={!dirty} onClick={() => void run(async () => { const saved = await processingApi.write(pluginId, companyId, projectId, accountId, "save", processingSavePayload(view)); await load(saved.draft.id); await drafts.refetch(); setMessage("수정 내용을 저장하고 다시 조회했습니다."); })}>초안 저장</Button>
      </div></div>
    </fieldset>}
  </div>;
}
