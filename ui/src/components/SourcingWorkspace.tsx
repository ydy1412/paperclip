import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CatalogStageCounts, ManagedProduct, PublicationJob, SourcingWorkspaceItem, StoreSettings } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { catalogErrorMessage } from "../lib/sourcing-catalog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { ProductDescription } from "./ProductDescription";
import { SourcingProductEditor } from "./SourcingProductEditor";
import { SourcingProcessing } from "./SourcingProcessing";
import { SourcingImageJobs } from "./SourcingImageJobs";

const stages = [["all", "전체"], ["candidate", "소싱 후보"], ["unprocessed", "가공 전"], ["processing", "가공 중"], ["ready", "업로드 준비"], ["queued", "업로드 대기"], ["uploaded", "업로드 완료"], ["attention", "확인 필요"]] as const;
const collectionStates: Record<string, string> = { idle: "수집 전", queued: "수집 대기", collecting: "Aside 수집 중", importing: "원본 저장 중", succeeded: "수집 완료", failed: "수집 실패", reconciliation_required: "수집 결과 확인 필요" };
function candidateLabel(item: SourcingWorkspaceItem) {
  return (item.candidate?.mainKeyword || item.title).split(/[,，·]/, 1)[0].trim() || item.candidate?.sourceProductId || item.id;
}
function candidateOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return { site: "확인 필요", href: null };
    return { site: /(^|\.)taobao\.com$/i.test(url.hostname) ? "타오바오" : url.hostname, href: url.href };
  } catch { return { site: "확인 필요", href: null }; }
}

export function SourcingWorkspace({ companyId, projectId }: { companyId: string; projectId: string }) {
  const cache = useQueryClient(); const key = ["sourcing-catalog", companyId, projectId]; const enabled = !!companyId && !!projectId;
  const [stage, setStage] = useState<keyof CatalogStageCounts>("all"); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [selected, setSelected] = useState<SourcingWorkspaceItem | null>(null);
  const [dirty, setDirty] = useState(false); const [error, setError] = useState(""); const filter = query ? { query } : {};
  const selectionScope = JSON.stringify([companyId, projectId, stage, page, pageSize, query]);
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const [collectionResult, setCollectionResult] = useState<{ scope: string; accepted: number; failures: { id: string; title: string; message: string }[] } | null>(null);
  const list = useQuery({ queryKey: [...key, "workspace", stage, page, pageSize, query], queryFn: () => sourcingCatalogApi.request<SourcingWorkspaceItem[]>(companyId, projectId, { operation: "workspace", stage, page, pageSize, ...filter }), enabled, retry: false,
    refetchInterval: value => value.state.data?.some(item => ["queued", "collecting", "importing", "reconciliation_required"].includes(item.candidate?.collectionState ?? "")) ? 3000 : false });
  const counts = useQuery({ queryKey: [...key, "stages", query], queryFn: () => sourcingCatalogApi.request<CatalogStageCounts>(companyId, projectId, { operation: "stages", ...filter }), enabled, retry: false });
  const settings = useQuery({ queryKey: ["sourcing-store-settings", companyId, projectId], queryFn: () => sourcingCatalogApi.request<StoreSettings>(companyId, projectId, { operation: "settings" }), enabled, retry: false });
  const jobs = useQuery({ queryKey: [...key, "jobs"], queryFn: () => sourcingCatalogApi.request<PublicationJob[]>(companyId, projectId, { operation: "jobs" }), enabled, retry: false,
    refetchInterval: value => value.state.data?.some(j => ["queued", "preparing", "sending"].includes(j.state)) ? 2000 : false });
  async function refresh() {
    await cache.invalidateQueries({ queryKey: key });
    if (selected?.product && !dirty) {
      const p = await sourcingCatalogApi.request<ManagedProduct>(companyId, projectId, { operation: "get", productId: selected.product.id });
      setSelected(current => current?.product?.id === p.id ? { ...current, product: p, title: p.title, stage: p.stage ?? "processing" } : current);
    }
  }
  useEffect(() => {
    void cache.invalidateQueries({ queryKey: [...key, "stages"] });
    if (!selected || dirty) return;
    const current = list.data?.find(item => item.id === selected.id || selected.source && item.source?.sourceProvider === selected.source.sourceProvider && item.source.sourceProductId === selected.source.sourceProductId);
    if (current) setSelected(current);
  }, [list.data]);
  const changedJobs = jobs.data?.map(j => `${j.id}:${j.state}`).sort().join(",");
  useEffect(() => { if (changedJobs) void refresh().catch(e => setError(catalogErrorMessage(e))); }, [changedJobs]);
  const action = useMutation({ mutationFn: (input: Record<string, unknown>) => sourcingCatalogApi.request<unknown>(companyId, projectId, input),
    onSuccess: async (value, input) => {
      setError("");
      if (input.operation === "source") {
        const product = value as ManagedProduct; setSelected({ id: product.id, kind: "product", title: product.title, mainImage: product.mainImage, stage: product.stage ?? "processing", product, candidate: null, source: null });
        setStage("processing"); setPage(1);
      }
      await cache.invalidateQueries({ queryKey: key });
    }, onError: e => setError(catalogErrorMessage(e)) });
  const collection = useMutation({ retry: false,
    mutationFn: async (items: { id: string; title: string }[]) => {
      const failures: { id: string; title: string; message: string }[] = []; let accepted = 0;
      for (const item of items) {
        try { await sourcingCatalogApi.request(companyId, projectId, { operation: "candidate-collect", candidateId: item.id }); accepted++; }
        catch (e) { failures.push({ ...item, message: catalogErrorMessage(e) }); }
      }
      return { scope: selectionScope, accepted, failures };
    },
    onSuccess: async result => {
      setCollectionResult(result); setError("");
      setSelection(current => current.scope === result.scope ? { scope: result.scope, ids: result.failures.map(item => item.id) } : current);
      await cache.invalidateQueries({ queryKey: key }).catch(e => setError(catalogErrorMessage(e)));
    },
  });
  const busy = action.isPending || collection.isPending;
  const eligible = (list.data ?? []).filter(item => item.candidate && ["idle", "failed"].includes(item.candidate.collectionState));
  const picked = eligible.filter(item => selection.scope === selectionScope && selection.ids.includes(item.candidate!.id));
  const selectionDisabled = dirty || busy || list.isFetching || !!list.error;
  const result = collectionResult?.scope === selectionScope ? collectionResult : null;
  const tableLayout = !!list.data?.some(item => item.candidate) && !selected?.product;
  if (!enabled) return <p className="text-sm text-muted-foreground">상품을 관리할 프로젝트를 선택해 주세요.</p>;
  const failure = error || (list.error || counts.error || settings.error || jobs.error ? catalogErrorMessage(list.error ?? counts.error ?? settings.error ?? jobs.error) : "");
  const candidate = selected?.candidate; const source = selected?.source;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">후보를 수집하고, 원본을 확인한 뒤 가공을 시작합니다.</p><div className="flex gap-2"><Button variant="outline" disabled={dirty || busy} onClick={() => action.mutate({ operation: "candidate-import" })}>{action.isPending ? "처리 중" : "기존 소싱 후보 불러오기"}</Button><Button variant="outline" disabled={dirty || busy} onClick={() => void refresh().catch(e => setError(catalogErrorMessage(e)))}>새로고침</Button></div></div>
    {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
    <Tabs value={stage} onValueChange={value => { setStage(value as keyof CatalogStageCounts); setPage(1); setSelected(null); }}><div className="overflow-x-auto border-b border-border pb-2"><TabsList variant="line" aria-label="소싱 단계">{stages.map(([value, label]) => <TabsTrigger key={value} value={value} disabled={dirty || busy} className="px-3">{label}{counts.data ? ` (${counts.data[value]})` : ""}</TabsTrigger>)}</TabsList></div></Tabs>
    <form aria-label="상품 키워드 검색" className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (dirty || busy) return; setQuery(search.trim()); setPage(1); setSelected(null); }}><label className="grid min-w-0 flex-1 gap-1 text-sm">키워드 검색<Input aria-label="상품 검색 키워드" type="search" placeholder="상품명·상품번호·메인/서브 키워드" maxLength={200} disabled={dirty || busy} value={search} onChange={e => setSearch(e.target.value)} /></label><Button disabled={dirty || busy}>검색</Button><Button type="button" variant="outline" disabled={dirty || busy || (!search && !query)} onClick={() => { setSearch(""); setQuery(""); setPage(1); setSelected(null); }}>검색 초기화</Button></form>
    <div role="group" aria-label="페이지당 조회 개수" className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">조회 개수</span>{[20, 50, 100].map(size => <Button key={size} variant={pageSize === size ? "default" : "outline"} aria-pressed={pageSize === size} disabled={dirty || busy} onClick={() => { setPageSize(size); setPage(1); setSelected(null); }}>{size}개 조회</Button>)}</div>
    {(list.data?.some(item => item.candidate) || collection.isPending || result) && <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><Checkbox aria-label="현재 페이지 수집 가능한 후보 전체 선택" disabled={selectionDisabled || !eligible.length} checked={picked.length && picked.length === eligible.length ? true : picked.length ? "indeterminate" : false} onCheckedChange={checked => setSelection({ scope: selectionScope, ids: checked ? eligible.map(item => item.candidate!.id) : [] })} />현재 페이지 전체 선택</label><span className="text-sm text-muted-foreground">{picked.length}개 선택</span><Button disabled={selectionDisabled || !picked.length} onClick={() => collection.mutate(picked.map(item => ({ id: item.candidate!.id, title: candidateLabel(item) })))}>{collection.isPending ? "수집 큐에 추가 중" : "선택한 후보 수집 큐에 추가"}</Button></div>
      <p className="text-xs text-muted-foreground">큐에 넣은 순서대로 한 상품씩 수집합니다.</p>
      {result && <><p role="status" className="text-sm">수집 요청 {result.accepted}개 접수{result.failures.length > 0 && ` · ${result.failures.length}개 확인 필요`}</p>{result.failures.length > 0 && <ul className="space-y-1 text-sm text-destructive">{result.failures.map(item => <li key={item.id}>{item.title}: {item.message}</li>)}</ul>}</>}
    </div>}
    <div className={`grid min-w-0 gap-4 ${tableLayout ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}><section aria-label="소싱 상품 목록" className={`min-w-0 space-y-2 ${tableLayout ? "xl:col-span-2" : ""}`}>
      {list.isLoading && <p className="text-sm text-muted-foreground">상품 조회 중</p>}
      {list.data?.length === 0 && <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">{query ? "검색 결과가 없습니다." : stage === "candidate" || stage === "all" ? "기존 소싱 후보를 불러오거나 다른 단계를 선택해 주세요." : "이 단계의 상품이 없습니다."}</p>}
      {list.data?.some(item => item.candidate) && <div className="min-w-0 overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full text-left text-sm">
        <caption className="sr-only">소싱 후보 목록</caption>
        <thead><tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
          {['선택', '대표 키워드', '사이트', '상품 ID', 'URL', '수집 상태'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-3">{label}</th>)}
        </tr></thead>
        <tbody>{list.data.filter(item => item.candidate).map(item => {
          const row = item.candidate!; const label = candidateLabel(item); const origin = candidateOrigin(row.url);
          return <tr key={item.id} className={`border-b border-border last:border-0 ${selected?.id === item.id ? "bg-accent" : "hover:bg-muted/50"}`}>
            <td className="px-3 py-3"><Checkbox aria-label={`소싱 후보 선택: ${label}`} checked={picked.some(p => p.candidate!.id === row.id)} disabled={selectionDisabled || !eligible.includes(item)} onCheckedChange={checked => setSelection({ scope: selectionScope, ids: checked ? [...picked.map(p => p.candidate!.id), row.id] : picked.filter(p => p.candidate!.id !== row.id).map(p => p.candidate!.id) })} /></td>
            <th scope="row" className="px-3 py-3 font-medium"><button type="button" aria-pressed={selected?.id === item.id} disabled={dirty || busy} onClick={() => { setSelected(item); setError(""); }} className="min-w-24 max-w-48 text-left text-primary hover:underline disabled:opacity-60"><span className="line-clamp-2 break-words">{label}</span></button></th>
            <td className="whitespace-nowrap px-3 py-3">{origin.site}</td>
            <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{row.sourceProductId || "—"}</td>
            <td className="px-3 py-3">{origin.href ? <a href={origin.href} target="_blank" rel="noopener noreferrer" className="block min-w-32 max-w-64 break-all text-xs text-primary underline">{row.url}</a> : <span className="text-xs text-muted-foreground">URL 확인 필요</span>}</td>
            <td className="whitespace-nowrap px-3 py-3" title={row.errorCode ? catalogErrorMessage(new Error(row.errorCode)) : undefined}>{collectionStates[row.collectionState]}</td>
          </tr>;
        })}</tbody>
      </table></div>}
      {list.data?.filter(item => !item.candidate).map(item => <div key={item.id} className={`flex min-w-0 items-center gap-3 rounded-lg border bg-card p-3 ${selected?.id === item.id ? "border-primary" : "border-border"}`}>
        <button type="button" aria-pressed={selected?.id === item.id} disabled={dirty || busy} onClick={() => { setSelected(item); setError(""); }} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60">
        {item.mainImage ? <img src={item.mainImage} alt={item.title} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-16 rounded-md object-cover" /> : <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">이미지 없음</div>}
        <div className="min-w-0 space-y-1"><h3 className="break-words text-sm font-medium">{item.title}</h3><p className="text-xs text-muted-foreground">{stages.find(([id]) => id === item.stage)?.[1]}{item.candidate && ` · ${collectionStates[item.candidate.collectionState]}`}{item.product && ` · 옵션 ${item.product.skus.length}개 · ${item.product.listings.length}개 쇼핑몰 등록`}</p>{item.candidate && <p className="break-words text-xs text-muted-foreground">{[item.candidate.mainKeyword, item.candidate.subKeyword].filter(Boolean).join(" / ")}</p>}</div>
        </button></div>)}
    </section>
      {selected?.product && settings.data ? <SourcingProductEditor key={selected.product.id} companyId={companyId} projectId={projectId} product={selected.product} settings={settings.data} jobs={jobs.data ?? []} onDirty={setDirty} onSaved={p => { setSelected({ ...selected, product: p, title: p.title, stage: p.stage ?? "processing" }); void cache.invalidateQueries({ queryKey: key }); }} onQueued={() => void refresh().catch(e => setError(catalogErrorMessage(e)))} />
        : selected ? <aside aria-label={candidate ? "소싱 후보 정보" : "가공 전 상품 정보"} className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4"><h2 className="font-semibold">{candidate ? candidateLabel(selected) : selected.title}</h2>{selected.mainImage && <img src={selected.mainImage} alt="상품 대표 이미지" className="mx-auto size-40 rounded-md object-contain" referrerPolicy="no-referrer" />}
          <p className="break-all text-sm">타오바오 상품 {candidate?.sourceProductId ?? source?.sourceProductId}</p><a className="break-all text-sm text-primary underline" href={candidate?.url ?? source?.url} target="_blank" rel="noopener noreferrer">원본 상품 보기</a>
          {candidate ? <><dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">메인 키워드</dt><dd>{candidate.mainKeyword || "없음"}</dd></div><div><dt className="text-muted-foreground">서브 키워드</dt><dd>{candidate.subKeyword || "없음"}</dd></div><div><dt className="text-muted-foreground">수집 상태</dt><dd>{collectionStates[candidate.collectionState]}</dd></div></dl>{candidate.errorCode && <p className="text-sm text-destructive">{catalogErrorMessage(new Error(candidate.errorCode))}</p>}<Button disabled={selectionDisabled || !["idle", "failed"].includes(candidate.collectionState)} onClick={() => action.mutate({ operation: "candidate-collect", candidateId: candidate.id })}>{candidate.collectionState === "failed" ? "수집 다시 시작" : "Aside로 수집 시작"}</Button>{candidate.collectionState === "reconciliation_required" && <p className="text-sm text-muted-foreground">기존 수집 세션의 결과를 확인하고 있습니다. 자동으로 새 수집을 시작하지 않습니다.</p>}</>
            : source && <><p className="text-sm text-muted-foreground">수집 완료 · 옵션 {source.optionCount}개 · 원본을 확인한 뒤 가공을 시작해 주세요.</p><ProductDescription value={source.description} /><Button disabled={busy} onClick={() => action.mutate({ operation: "source", sourceProvider: source.sourceProvider, sourceProductId: source.sourceProductId })}>가공 시작</Button></>}
        </aside> : <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">상품을 선택하면 해당 단계의 정보와 작업이 표시됩니다.</div>}
    </div>
    {(page > 1 || list.data?.length === pageSize) && <nav aria-label="상품 페이지" className="flex items-center gap-3"><Button variant="outline" disabled={page === 1 || dirty || busy || list.isFetching} onClick={() => setPage(page - 1)}>이전</Button><span className="text-sm text-muted-foreground">{page} 페이지</span><Button variant="outline" disabled={list.data?.length !== pageSize || dirty || busy || list.isFetching} onClick={() => setPage(page + 1)}>다음</Button></nav>}
    <SourcingImageJobs companyId={companyId} projectId={projectId} onChanged={() => void refresh().catch(e => setError(catalogErrorMessage(e)))} />
    <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium">원본 근거·크롭 계획 가공</summary><div className="pt-4"><SourcingProcessing companyId={companyId} projectId={projectId} /></div></details>
  </div>;
}
