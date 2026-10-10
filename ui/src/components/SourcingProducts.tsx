import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ManagedProduct, PublicationJob, StoreSettings, CatalogStageCounts } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { catalogErrorMessage } from "../lib/sourcing-catalog";
import { SourcingProductEditor } from "./SourcingProductEditor";
import { SourcingProcessing } from "./SourcingProcessing";
import { SourcingCatalogImport } from "./SourcingCatalogImport";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

export function SourcingProducts({ companyId, projectId, view }: { companyId: string; projectId: string; view: "source" | "uploads" }) {
  const cache = useQueryClient(); const key = ["sourcing-catalog", companyId, projectId];
  const enabled = !!companyId && !!projectId;
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const searchFilter = query ? { query } : {};
  const [stage, setStage] = useState<keyof CatalogStageCounts>("all");
  const stages = useQuery({ queryKey: [...key, "stages", query], queryFn: () => sourcingCatalogApi.request<CatalogStageCounts>(companyId, projectId, { operation: "stages", ...searchFilter }), enabled: enabled && view === "source", retry: false });
  const settings = useQuery({ queryKey: ["sourcing-store-settings", companyId, projectId], queryFn: () => sourcingCatalogApi.request<StoreSettings>(companyId, projectId, { operation: "settings" }), enabled, retry: false });
  const products = useQuery({ queryKey: [...key, view, page, stage, query], queryFn: () => sourcingCatalogApi.request<ManagedProduct[]>(companyId, projectId, { operation: "list", view, page, ...searchFilter, ...(view === "source" ? { stage } : {}) }), enabled, retry: false });
  const sources = useQuery({ queryKey: [...key, "sources"], queryFn: () => sourcingCatalogApi.request<{ sourceProvider: string; sourceProductId: string; title: string; mainImage: string }[]>(companyId, projectId, { operation: "sources" }), enabled: enabled && view === "source", retry: false });
  const jobs = useQuery({ queryKey: [...key, "jobs"], queryFn: () => sourcingCatalogApi.request<PublicationJob[]>(companyId, projectId, { operation: "jobs" }), enabled, retry: false,
    refetchInterval: query => query.state.data?.some(j => ["queued", "preparing", "sending"].includes(j.state)) ? 2000 : false });
  const [selected, setSelected] = useState<ManagedProduct | null>(null); const [dirty, setDirty] = useState(false); const [sourceId, setSourceId] = useState(""); const [sourceError, setSourceError] = useState(""); const [adding, setAdding] = useState(false);
  const jobChanges = jobs.data?.map(j => `${j.id}:${j.state}`).sort().join(",") ?? "";
  useEffect(() => {
    if (!jobChanges) return;
    void cache.invalidateQueries({ queryKey: key });
    if (!selected || dirty) return;
    let cancelled = false;
    void sourcingCatalogApi.request<ManagedProduct>(companyId, projectId, { operation: "get", productId: selected.id })
      .then(p => { if (!cancelled) setSelected(p); }).catch(e => { if (!cancelled) setSourceError(catalogErrorMessage(e)); });
    return () => { cancelled = true; };
  }, [jobChanges, selected?.id, dirty, companyId, projectId, view, page, cache]);
  async function refresh() { await cache.invalidateQueries({ queryKey: key }); if (selected && !dirty) setSelected(await sourcingCatalogApi.request<ManagedProduct>(companyId, projectId, { operation: "get", productId: selected.id })); }
  if (!enabled) return <p className="text-sm text-muted-foreground">상품을 관리할 프로젝트를 선택해 주세요.</p>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{view === "uploads" ? "등록 상품을 공통 상품별로 관리합니다. 카드에서 수정하거나 다른 쇼핑몰에 추가 등록할 수 있습니다." : "업로드 전 상품을 가공하고 쇼핑몰별 업로드를 준비합니다."}</p><Button variant="outline" disabled={dirty} onClick={() => void refresh()}>새로고침</Button></div>
    {(products.error || settings.error || jobs.error || stages.error || sources.error || sourceError) && <p role="alert" className="text-sm text-destructive">{sourceError || catalogErrorMessage(products.error ?? settings.error ?? jobs.error ?? stages.error ?? sources.error)}</p>}
    {view === "uploads" && settings.data && <SourcingCatalogImport companyId={companyId} projectId={projectId} settings={settings.data} disabled={dirty} />}
    {view === "source" && <Tabs value={stage} onValueChange={value => { setStage(value as keyof CatalogStageCounts); setPage(1); if (!dirty) setSelected(null); }}>
      <div className="overflow-x-auto border-b border-border pb-2"><TabsList variant="line" aria-label="소싱 단계">
        {([["all", "전체"], ["processing", "가공 중"], ["ready", "업로드 준비"], ["queued", "업로드 대기"], ["uploaded", "업로드 완료"], ["attention", "확인 필요"]] as const).map(([value, label]) =>
          <TabsTrigger key={value} value={value} disabled={dirty} className="px-3">{label}{stages.data ? ` (${stages.data[value]})` : ""}</TabsTrigger>)}
      </TabsList></div>
    </Tabs>}
    <form aria-label="상품 키워드 검색" className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (dirty) return; setQuery(searchText.trim()); setPage(1); setSelected(null); }}>
      <label className="grid min-w-0 flex-1 gap-1 text-sm">키워드 검색<Input type="search" aria-label="상품 검색 키워드" placeholder="상품명·상품번호 검색" maxLength={200} value={searchText} disabled={dirty} onChange={e => setSearchText(e.target.value)} /></label>
      <Button type="submit" disabled={dirty}>검색</Button>
      <Button type="button" variant="outline" disabled={dirty || (!searchText && !query)} onClick={() => { setSearchText(""); setQuery(""); setPage(1); setSelected(null); }}>검색 초기화</Button>
    </form>
    {view === "source" && <form className="flex flex-wrap items-end gap-2" onSubmit={async e => { e.preventDefault(); setAdding(true); setSourceError(""); try { const p = await sourcingCatalogApi.request<ManagedProduct>(companyId, projectId, { operation: "source", sourceProvider: "taobao", sourceProductId: sourceId }); setSelected(p); setDirty(false); await cache.invalidateQueries({ queryKey: key }); } catch (err) { setSourceError(catalogErrorMessage(err)); } finally { setAdding(false); } }}><label className="grid gap-1 text-sm">수집한 원본 상품<select aria-label="수집한 원본 상품" className="h-9 rounded-md border border-input bg-background px-3" value={sourceId} required onChange={e => setSourceId(e.target.value)}><option value="">상품 선택</option>{sources.data?.map(s => <option key={`${s.sourceProvider}:${s.sourceProductId}`} value={s.sourceProductId}>{s.title}</option>)}</select></label><Button disabled={adding || dirty || !sourceId}>{adding ? "불러오는 중" : "가공 목록에 추가"}</Button></form>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-2"><section aria-label={view === "uploads" ? "업로드 상품 목록" : "소싱 상품 목록"} className="min-w-0 space-y-3">
      {products.isLoading && <p className="text-sm text-muted-foreground">상품 조회 중</p>}
      {products.data?.length === 0 && <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">{query ? "검색 결과가 없습니다." : view === "uploads" ? "위에서 쿠팡 상품을 가져와 주세요." : stage === "all" ? "수집한 상품을 가공 목록에 추가해 주세요." : "이 단계의 상품이 없습니다."}</p>}
      <div className={view === "uploads" ? "grid gap-3 sm:grid-cols-2" : "space-y-2"}>{products.data?.map(p => <button key={p.id} type="button" aria-pressed={selected?.id === p.id} disabled={dirty} onClick={() => { setSelected(p); setDirty(false); }} className={`min-w-0 overflow-hidden rounded-lg border bg-card text-left disabled:opacity-60 ${selected?.id === p.id ? "border-primary" : "border-border"} ${view === "source" ? "flex items-center gap-3 p-3" : "p-3"}`}>
        {p.mainImage ? <img src={p.mainImage} alt={p.title} loading="lazy" referrerPolicy="no-referrer" className={view === "source" ? "aspect-square w-16 rounded-md object-cover" : "aspect-square w-full rounded-md object-contain"} /> : <div className="rounded-md bg-muted p-4 text-xs text-muted-foreground">이미지 없음</div>}
        <div className="min-w-0 space-y-1 py-2"><h3 className="break-words text-sm font-medium">{p.title}</h3><p className="text-xs text-muted-foreground">{p.listings.length}개 쇼핑몰 등록 · 옵션 {p.skus.length}개{view === "source" && p.stage && ` · ${({ processing: "가공 중", ready: "업로드 준비", queued: "업로드 대기", attention: "확인 필요", uploaded: "업로드 완료" })[p.stage]}`}</p>{p.listings.length > 0 && <p className="break-words text-xs text-muted-foreground">{p.listings.map(l => { const store = settings.data?.stores.find(s => s.id === l.storeId); const business = settings.data?.businesses.find(b => b.id === store?.businessId); return [business?.name, store?.name].filter(Boolean).join(" / "); }).filter(Boolean).join(" · ")}</p>}</div>
      </button>)}</div>
    </section>{selected && settings.data ? <SourcingProductEditor key={selected.id} companyId={companyId} projectId={projectId} product={selected} settings={settings.data} jobs={jobs.data ?? []} onDirty={setDirty} onSaved={p => { setSelected(p); void cache.invalidateQueries({ queryKey: key }); }} onQueued={() => void refresh()} /> : <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">상품을 선택하면 편집 화면과 쇼핑몰별 등록 상태가 표시됩니다.</div>}</div>
    {(page > 1 || products.data?.length === 20) && <nav aria-label="상품 페이지" className="flex items-center gap-3"><Button variant="outline" disabled={page === 1 || dirty || products.isFetching} onClick={() => setPage(page - 1)}>이전</Button><span className="text-sm text-muted-foreground">{page} 페이지</span><Button variant="outline" disabled={products.data?.length !== 20 || dirty || products.isFetching} onClick={() => setPage(page + 1)}>다음</Button></nav>}
    {view === "source" && <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium">원본 근거·크롭 계획 가공</summary><div className="pt-4"><SourcingProcessing companyId={companyId} projectId={projectId} /></div></details>}
  </div>;
}
