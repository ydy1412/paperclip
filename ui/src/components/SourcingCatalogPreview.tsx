import { useEffect, useState } from "react";
import { ArrowLeft, Check, CircleAlert, ImageOff, Maximize2, Package, RotateCcw, Search, Unplug, X } from "lucide-react";
import { useSearchParams } from "@/lib/router";
import { previewAccounts, previewImageChecks, previewSourceStates, previewValidation, previewValidationStates, sourcingPreviewProducts, sourcingPreviewUploads, type PreviewProduct, type PreviewProductImage } from "../lib/sourcing-preview";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { EmptyState } from "./EmptyState";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

const control = "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const price = (value: number, currency: "CNY" | "KRW") => `${value.toLocaleString("ko-KR")} ${currency}`;

function PreviewImage({ image, failedSources, onFailure }: {
  image?: PreviewProductImage; failedSources: string[]; onFailure: (src: string) => void;
}) {
  if (!image || failedSources.includes(image.src)) return <span role="img" aria-label={image ? "이미지 로딩 실패" : "대표 이미지 미선택"} className="flex size-full items-center justify-center bg-muted text-muted-foreground"><ImageOff className="size-5" aria-hidden="true" /></span>;
  return <img src={image.src} alt={image.alt} loading="lazy" decoding="async" className="size-full object-contain" onError={() => onFailure(image.src)} />;
}

function PreviewProductGallery({ product, representative, editable, failedSources, onFailure, onChoose }: {
  product: PreviewProduct; representative?: PreviewProductImage; editable: boolean;
  failedSources: string[]; onFailure: (src: string) => void; onChoose: (id: string | null) => void;
}) {
  const [activeId, setActiveId] = useState(representative?.id ?? product.images[0]?.id);
  const active = product.images.find(image => image.id === activeId);
  const failed = !!active && failedSources.includes(active.src);
  return <section aria-label="상품 이미지 갤러리" className="min-w-0 space-y-3">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">AI 생성 예시 · {product.images.length}장</span>
      {editable && <span className="flex items-center gap-1.5">{representative ? "대표 이미지 선택됨" : "대표 이미지 미선택"}
        <Button type="button" size="icon-xs" variant="ghost" disabled={!representative} aria-label="대표 이미지 선택 해제" title="대표 이미지 선택 해제" onClick={() => onChoose(null)}><X className="size-3.5" /></Button>
      </span>}
    </div>
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" aria-label="상품 이미지 확대" title="상품 이미지 확대" disabled={!active || failed} className="relative block aspect-square w-full overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default">
          <PreviewImage image={active} failedSources={failedSources} onFailure={onFailure} />
          {active && !failed && <span className="absolute bottom-2 right-2 rounded bg-background p-1.5 text-foreground"><Maximize2 className="size-4" aria-hidden="true" /></span>}
        </button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-dvh overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle className="pr-8 text-base">{product.title} · {active?.label}</DialogTitle><DialogDescription>AI 생성 예시 · 실제 수집 상품 사진 아님</DialogDescription></DialogHeader>
        <DialogClose asChild><Button type="button" size="icon-sm" variant="ghost" aria-label="이미지 확대 닫기" title="이미지 확대 닫기" className="absolute right-3 top-3"><X className="size-4" /></Button></DialogClose>
        <div className="aspect-square w-full overflow-hidden rounded-md border border-border bg-muted"><PreviewImage image={active} failedSources={failedSources} onFailure={onFailure} /></div>
      </DialogContent>
    </Dialog>
    {failed && <p role="status" className="text-xs text-destructive">이미지 로딩 실패</p>}
    <div role="group" aria-label={editable ? "대표 이미지 선택" : "이미지 보기"} className="flex flex-wrap gap-2">
      {product.images.map(image => <button key={image.id} type="button" aria-label={`${editable ? "대표 이미지 선택" : "이미지 보기"}: ${image.label}`} title={image.label}
        aria-pressed={editable ? representative?.id === image.id : activeId === image.id}
        disabled={editable && failedSources.includes(image.src)}
        className={`size-12 shrink-0 overflow-hidden rounded-md border focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${(editable ? representative?.id : activeId) === image.id ? "border-foreground ring-1 ring-foreground" : "border-border"}`}
        onClick={() => { setActiveId(image.id); if (editable) onChoose(image.id); }}>
        <PreviewImage image={image} failedSources={failedSources} onFailure={onFailure} />
      </button>)}
    </div>
    {editable && <p className="text-xs text-muted-foreground">예시 선택 · 미저장</p>}
  </section>;
}

export function SourcingCatalogPreview({ companyId, projectId, view }: { companyId: string; projectId: string; view: "sourcing" | "uploads" }) {
  const [params, setParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [imageChoices, setImageChoices] = useState<Record<string, string | null>>({});
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const q = params.get("q") ?? "";
  const live = params.get("data") === "live";
  const itemId = params.get("item") ?? "";
  const isUpload = view === "uploads";
  const listLabel = isUpload ? "업로드 초안 목록" : "소싱 상품 목록";
  const detailLabel = isUpload ? "업로드 초안 상세" : "소싱 상품 상세";
  const rows = isUpload ? sourcingPreviewUploads.map(upload => ({ id: upload.id, product: sourcingPreviewProducts.find(product => product.id === upload.productId)!, upload })) :
    sourcingPreviewProducts.map(product => ({ id: product.id, product, upload: null }));
  function rowImage(row: typeof rows[number]) {
    const id = imageChoices[row.id];
    return id === undefined ? row.product.images[0] : row.product.images.find(image => image.id === id);
  }
  function imageReady(row: typeof rows[number]) {
    const image = rowImage(row);
    return !!image && !failedSources.includes(image.src);
  }
  function imageFailed(src: string) {
    setFailedSources(current => current.includes(src) ? current : [...current, src]);
  }
  const needle = q.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => {
    const { product, upload } = row;
    return (
    (!needle || `${product.title} ${product.originalTitle} ${product.category}`.toLocaleLowerCase().includes(needle)) &&
    (isUpload ? (!params.get("account") || upload?.account === params.get("account")) && (!params.get("validation") || upload && previewValidation(upload, imageReady(row)) === params.get("validation")) :
      (!params.get("source") || product.source === params.get("source")) && (!params.get("state") || product.state === params.get("state"))));
  });
  const selected = rows.find(row => row.id === itemId);
  const checks = selected?.upload ? previewImageChecks(selected.upload, imageReady(selected)) : [];
  const allChecked = filtered.length > 0 && filtered.every(row => selectedIds.includes(row.id));
  const someChecked = filtered.some(row => selectedIds.includes(row.id));
  const hasFilters = !!(q || (isUpload ? params.get("account") || params.get("validation") : params.get("source") || params.get("state")));
  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => { setSelectedIds([]); setImageChoices({}); setFailedSources([]); }, [companyId, projectId, view, live]);

  function change(values: Record<string, string | null>, clearItem = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    if (clearItem) next.delete("item");
    setParams(next);
  }
  function toggle(id: string, checked: boolean) {
    setSelectedIds(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id));
  }

  if (!companyId || !projectId) return <EmptyState icon={Unplug} message="프로젝트 선택" />;

  return <section aria-label={listLabel} className="min-w-0 space-y-4">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-1"><Unplug className={`size-3.5 ${live ? "text-muted-foreground" : "text-(--status-task-icon-todo)"}`} aria-hidden="true" />{live ? "데이터 미연결" : "예시 데이터"}</span>
        {!live && <span className="text-muted-foreground">{isUpload ? "상품 등록 미연결" : "상품 수집 미연결"}</span>}
      </div>
      <div role="group" aria-label="데이터 보기" className="inline-flex rounded-md border border-border p-0.5">
        <Button type="button" size="sm" variant={live ? "secondary" : "ghost"} aria-pressed={live} onClick={() => change({ data: "live", q: null, source: null, state: null, account: null, validation: null })}>실제 데이터</Button>
        <Button type="button" size="sm" variant={!live ? "secondary" : "ghost"} aria-pressed={!live} onClick={() => change({ data: "examples", q: null, source: null, state: null, account: null, validation: null })}>예시 데이터</Button>
      </div>
    </div>
    {live ? <EmptyState icon={Unplug} message={isUpload ? "업로드 초안 데이터 미연결" : "상품 데이터 미연결"} /> : <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {isUpload ? <>
          <select aria-label="판매 계정" className={`${control} max-w-full`} value={params.get("account") ?? ""} onChange={event => change({ account: event.target.value })}><option value="">전체 판매 계정</option>{Object.entries(previewAccounts).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          <select aria-label="검증 상태" className={control} value={params.get("validation") ?? ""} onChange={event => change({ validation: event.target.value })}><option value="">전체 검증 상태</option>{Object.entries(previewValidationStates).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </> : <>
          <select aria-label="소싱 출처" className={control} value={params.get("source") ?? ""} onChange={event => change({ source: event.target.value })}><option value="">전체 출처</option><option>Taobao</option><option>1688</option></select>
          <select aria-label="수집 상태" className={control} value={params.get("state") ?? ""} onChange={event => change({ state: event.target.value })}><option value="">전체 수집 상태</option>{Object.entries(previewSourceStates).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </>}
        <form className="flex w-full min-w-0 flex-none gap-2 sm:w-auto sm:flex-1" onSubmit={event => { event.preventDefault(); change({ q: search.trim() || null }); }}>
          <Input type="search" aria-label="상품 검색" placeholder="상품명 검색" maxLength={100} className="h-9 min-w-0" value={search} onChange={event => setSearch(event.target.value)} />
          <Button type="submit" size="icon-sm" variant="outline" aria-label="상품 검색 실행" title="상품 검색"><Search className="size-4" /></Button>
        </form>
        {hasFilters && <Button type="button" size="icon-sm" variant="ghost" aria-label="필터 초기화" title="필터 초기화" onClick={() => change({ q: null, source: null, state: null, account: null, validation: null })}><RotateCcw className="size-4" /></Button>}
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-3 text-xs text-muted-foreground" role="status">
        <span>예시 {isUpload ? "초안" : "상품"} {filtered.length}개</span>
        {selectedIds.length > 0 && <><span className="font-medium text-foreground">{selectedIds.length}개 선택</span><Button type="button" size="icon-xs" variant="ghost" aria-label="선택 해제" title="선택 해제" onClick={() => setSelectedIds([])}><X className="size-3.5" /></Button></>}
      </div>
      <div className="grid min-w-0 gap-6 xl:grid-cols-3">
        <div className={`${itemId ? "hidden xl:block" : ""} min-w-0 xl:col-span-2`}>
          <div className="min-w-0 overflow-x-auto"><table className="w-full text-left text-sm">
            <caption className="sr-only">{listLabel} · 예시 데이터</caption>
            <thead><tr className="border-y border-border text-xs text-muted-foreground">
              <th scope="col" className="w-10 px-3 py-3"><Checkbox aria-label="현재 목록 전체 선택" disabled={!filtered.length} checked={allChecked ? true : someChecked ? "indeterminate" : false} onCheckedChange={checked => setSelectedIds(current => checked === true ? [...new Set([...current, ...filtered.map(row => row.id)])] : current.filter(id => !filtered.some(row => row.id === id)))} /></th>
              {(isUpload ? ["상품", "판매 계정", "예정 가격", "검증 상태", "등록 상태"] : ["상품", "원가", "옵션", "수집일", "상태"]).map(label => <th scope="col" key={label} className="whitespace-nowrap px-3 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>{filtered.map(row => { const { id, product, upload } = row; return <tr key={id} className={`cursor-pointer border-b border-border ${id === itemId ? "bg-accent" : "hover:bg-accent/50"}`} onClick={() => change({ item: id }, false)}>
              <td className="px-3 py-3" onClick={event => event.stopPropagation()}><Checkbox aria-label={`${product.title} 선택`} checked={selectedIds.includes(id)} onCheckedChange={checked => toggle(id, checked === true)} /></td>
              <td className="px-3 py-3"><div className="flex min-w-0 items-center gap-3"><span className="block size-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted"><PreviewImage image={rowImage(row)} failedSources={failedSources} onFailure={imageFailed} /></span><div className="min-w-0"><button type="button" className="whitespace-nowrap text-left font-medium underline-offset-4 hover:underline">{product.title}</button><p className="mt-1 text-xs text-muted-foreground">{product.source} · {product.category}</p></div></div></td>
              {upload ? <>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground"><p>{upload.account === "coupang" ? "쿠팡" : "스마트스토어"}</p><p className="mt-1">예시 계정</p></td><td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{price(upload.price, "KRW")}</td>
                <td className="whitespace-nowrap px-3 py-3"><span className="inline-flex items-center gap-1.5 text-xs">{previewValidation(upload, imageReady(row)) === "complete" ? <Check className="size-3.5 text-(--status-task-icon-done)" aria-hidden="true" /> : <CircleAlert className="size-3.5 text-(--status-task-icon-todo)" aria-hidden="true" />}{previewValidationStates[previewValidation(upload, imageReady(row))]}</span></td><td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">미등록</td>
              </> : <>
                <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{price(product.sourcePrice, "CNY")}</td><td className="px-3 py-3 font-mono text-xs">{product.options.length}</td><td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted-foreground">{product.collectedOn.slice(5)}</td>
                <td className="whitespace-nowrap px-3 py-3"><span className="inline-flex items-center gap-1.5 text-xs">{product.state === "review" ? <CircleAlert className="size-3.5 text-(--status-task-icon-todo)" aria-hidden="true" /> : product.state === "ready" ? <Check className="size-3.5 text-(--status-task-icon-done)" aria-hidden="true" /> : <Package className="size-3.5 text-muted-foreground" aria-hidden="true" />}{previewSourceStates[product.state]}</span></td>
              </>}
            </tr>; })}</tbody>
          </table></div>
          {!filtered.length && <EmptyState icon={Search} message="조건에 맞는 예시 상품 없음" />}
        </div>
        <aside aria-label={detailLabel} className={`${itemId ? "" : "hidden xl:block"} min-w-0 border-border xl:border-l xl:pl-6`}>
          {!itemId ? <p className="py-6 text-sm text-muted-foreground">선택한 {isUpload ? "초안" : "상품"} 없음</p> : <>
            <header className="mb-4 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{isUpload ? "초안 상세" : "상품 상세"}</h2><Button type="button" variant="ghost" size="icon-sm" aria-label="상품 상세 닫기" title="상품 상세 닫기" onClick={() => change({ item: null }, false)}><ArrowLeft className="size-4 xl:hidden" /><X className="hidden size-4 xl:block" /></Button></header>
            {!selected ? <p role="alert" className="text-sm text-destructive">선택한 예시 항목을 찾을 수 없습니다.</p> : <div className="min-w-0 space-y-4">
              <div className="min-w-0"><h3 className="break-words text-base font-semibold">{selected.product.title}</h3><p className="mt-1 text-xs text-muted-foreground">{selected.product.source} · {selected.product.category}</p></div>
              <PreviewProductGallery key={`${companyId}:${projectId}:${view}:${selected.id}`} product={selected.product} representative={rowImage(selected)} editable={isUpload} failedSources={failedSources} onFailure={imageFailed} onChoose={id => setImageChoices(current => ({ ...current, [selected.id]: id }))} />
              <Tabs key={selected.id} defaultValue="info" className="min-w-0 gap-4">
                <TabsList variant="line" aria-label="상품 상세 정보" className="w-full border-b border-border"><TabsTrigger value="info">상품 정보</TabsTrigger><TabsTrigger value="checks">{isUpload ? "검증 항목" : "옵션"}</TabsTrigger><TabsTrigger value="history">{isUpload ? "등록 이력" : "원문"}</TabsTrigger></TabsList>
                <TabsContent value="info" className="min-w-0 space-y-5">
                  <dl className="grid min-w-0 gap-2 text-sm"><dt className="text-xs text-muted-foreground">{isUpload ? "판매 계정" : "출처"}</dt><dd className="break-words">{selected.upload ? previewAccounts[selected.upload.account] : selected.product.source}</dd><dt className="text-xs text-muted-foreground">{isUpload ? "예정 가격" : "원가"}</dt><dd className="font-mono">{selected.upload ? price(selected.upload.price, "KRW") : price(selected.product.sourcePrice, "CNY")}</dd><dt className="text-xs text-muted-foreground">카테고리</dt><dd>{selected.product.category}</dd><dt className="text-xs text-muted-foreground">{isUpload ? "등록 상태" : "수집 상태"}</dt><dd>{isUpload ? "미등록" : previewSourceStates[selected.product.state]}</dd><dt className="text-xs text-muted-foreground">원문 상품명 · 예시</dt><dd className="break-words">{selected.product.originalTitle}</dd></dl>
                  <div className="flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><Unplug className="size-3.5 shrink-0" aria-hidden="true" />{isUpload ? "상품 등록 미연결" : "상품 수집 미연결"}</div>
                </TabsContent>
                <TabsContent value="checks" className="min-w-0 space-y-3">
                  {selected.upload ? <><p className="text-xs text-muted-foreground">예시 입력 점검 · {checks.filter(check => check.passed).length}/{checks.length}</p><ul className="space-y-3">{checks.map(check => <li key={check.label} className="flex min-w-0 items-start gap-2 border-b border-border pb-3">{check.passed ? <Check className="mt-0.5 size-4 shrink-0 text-(--status-task-icon-done)" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-(--status-task-icon-todo)" />}<div className="min-w-0 text-sm"><p>{check.label}<span className="ml-2 text-xs text-muted-foreground">{check.passed ? "입력 완료" : "보완 필요"}</span></p><p className="mt-1 break-words text-xs text-muted-foreground">{check.note}</p></div></li>)}</ul></> : <><p className="text-xs text-muted-foreground">예시 옵션 {selected.product.options.length}개</p><ul className="space-y-3">{selected.product.options.map(option => <li key={option.name} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 text-sm"><span className="break-words">{option.name}</span><span className="font-mono text-xs text-muted-foreground">{price(option.price, "CNY")}</span></li>)}</ul></>}
                </TabsContent>
                <TabsContent value="history" className="min-w-0 space-y-4">{isUpload ? <p className="text-sm text-muted-foreground">등록 이력 없음</p> : <><div className="space-y-2"><h4 className="text-xs text-muted-foreground">원문 내용 · 예시</h4><p className="break-words text-sm leading-relaxed">{selected.product.originalDescription}</p></div><div className="space-y-2 border-t border-border pt-4 text-xs text-muted-foreground"><p>상품 주소 미연결</p><p>원문 근거 미연결</p></div></>}</TabsContent>
              </Tabs>
            </div>}
          </>}
        </aside>
      </div>
    </>}
  </section>;
}
