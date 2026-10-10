import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, Network, RefreshCw, Search, Settings2 } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useSearchParams, Link } from "@/lib/router";
import { pluginsApi } from "../api/plugins";
import { knowledgeApi, type KnowledgeList, type KnowledgePage, type KnowledgeStatus, type KnowledgeSources, type KnowledgeHistory, type KnowledgeReferences } from "../api/knowledge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { MarkdownBody } from "../components/MarkdownBody";
import { cn } from "../lib/utils";
import { KnowledgeGraph } from "../components/KnowledgeGraph";
import { KnowledgeUsage } from "../components/KnowledgeUsage";
import { KnowledgePdfPreview } from "../components/KnowledgePdfPreview";

const dateLabel=(value:string)=>new Date(value).toLocaleString("ko-KR",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
const generationLabel:Record<string,string>={pending:"생성 대기",processing:"생성 중",ready:"최신",stale:"갱신 필요",failed:"생성 실패"};
const selectClass="h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm";

function GenerationHistory({value}:{value:unknown}) {
  const rows=Array.isArray(value)?value: value && typeof value==="object" && "items" in value && Array.isArray(value.items)?value.items:[];
  if (!rows.length) return <p className="text-sm text-muted-foreground">생성 이력이 없습니다.</p>;
  return <div className="space-y-5">{rows.map((raw,index)=>{
    const row=raw as Record<string,unknown>;
    const content=typeof row.content==="string"?row.content:typeof row.previous_content==="string"?row.previous_content:"";
    const timestamp=String(row.changed_at ?? row.created_at ?? row.refreshed_at ?? row.timestamp ?? "");
    return <section key={String(row.id ?? index)} className="border-b border-border pb-4">
      <p className="mb-2 text-xs text-muted-foreground">{timestamp && !Number.isNaN(Date.parse(timestamp))?dateLabel(timestamp):`기록 ${index+1}`}</p>
      {row.kind==="refresh_failed"?<p className="break-words text-sm text-destructive">생성 실패 · {String(row.error_message ?? row.failure_reason ?? "")}</p>:row.redacted?<p className="text-sm text-muted-foreground">원본 접근 권한을 확인할 수 없어 이전 내용을 표시하지 않습니다.</p>:content?<MarkdownBody>{content}</MarkdownBody>:<p className="text-sm text-muted-foreground">첫 생성 기록</p>}
    </section>;
  })}</div>;
}

export function Knowledge() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId }=useCompany();
  const [params,setParams]=useSearchParams();
  const cache=useQueryClient();
  const [draft,setDraft]=useState(params.get("q")??"");
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [backfillProject,setBackfillProject]=useState("");
  const [preview,setPreview]=useState<{count:number;projectId:string}|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const tab=params.get("tab")??"body", id=params.get("id")??"";
  const graphView=params.get("view")==="graph";
  const company=selectedCompanyId??"";
  const plugins=useQuery({queryKey:["plugins"],queryFn:()=>pluginsApi.list()});
  const plugin=plugins.data?.find(p=>p.pluginKey==="paperclip-plugin-hindsight");
  const enabled=!!company && plugin?.status==="ready";
  const base=["knowledge",company,plugin?.id];
  const query={q:params.get("q")??"",projectId:params.get("project")??"",category:params.get("category")??"",review:params.get("review")??"",page:Number(params.get("page")??1)};
  const list=useQuery({queryKey:[...base,"list",query],queryFn:()=>knowledgeApi.read<KnowledgeList>(plugin!.id,company,"knowledge-list",query),enabled,refetchInterval:30_000});
  const status=useQuery({queryKey:[...base,"status"],queryFn:()=>knowledgeApi.read<KnowledgeStatus>(plugin!.id,company,"knowledge-status"),enabled,refetchInterval:30_000});
  const detail=useQuery({queryKey:[...base,"detail",id],queryFn:()=>knowledgeApi.read<KnowledgePage>(plugin!.id,company,"knowledge-detail",{id}),enabled:enabled && !!id,refetchInterval:30_000});
  const sources=useQuery({queryKey:[...base,"sources",id],queryFn:()=>knowledgeApi.read<KnowledgeSources>(plugin!.id,company,"knowledge-sources",{id}),enabled:enabled && !!id && tab==="sources"});
  const history=useQuery({queryKey:[...base,"history",id],queryFn:()=>knowledgeApi.read<KnowledgeHistory>(plugin!.id,company,"knowledge-history",{id}),enabled:enabled && !!id && tab==="history"});
  const references=useQuery({queryKey:[...base,"references",id],queryFn:()=>knowledgeApi.read<KnowledgeReferences>(plugin!.id,company,"knowledge-references",{id}),enabled:enabled && !!id && tab==="references"});
  const action=useMutation({mutationFn:({key,values}:{key:string;values?:Record<string,unknown>})=>knowledgeApi.action<unknown>(plugin!.id,company,key,values),onSuccess:()=>cache.invalidateQueries({queryKey:base})});
  const run=async(key:string,values:Record<string,unknown>={})=>{
    setNotice(null);
    try { const result=await action.mutateAsync({key,values});return result; }
    catch(e){setNotice(e instanceof Error?e.message:String(e));return null;}
  };
  const update=(key:string,value:string)=>setParams(previous=>{
    const next=new URLSearchParams(previous);if(value)next.set(key,value);else next.delete(key);
    if (!["id","tab","page"].includes(key)){next.delete("page");next.delete("id");next.delete("tab");}
    return next;
  });
  useEffect(() => {
    setBreadcrumbs([{ label: "Knowledge" }]);
  }, [setBreadcrumbs]);
  useEffect(()=>{setDraft(params.get("q")??"");},[params.get("q")]);
  useEffect(()=>{
    const timeout=window.setTimeout(()=>{if(draft.trim()!==query.q)update("q",draft.trim());},250);
    return ()=>window.clearTimeout(timeout);
  },[draft,query.q]);
  useEffect(()=>{setPreview(null);setBackfillProject("");setNotice(null);},[company]);

  const errors=[plugins.error,list.error,status.error,id && detail.error,id && tab==="sources" && sources.error,id && tab==="history" && history.error,id && tab==="references" && references.error].filter(Boolean);
  const errorMessage=errors[0] instanceof Error?errors[0].message:String(errors[0]??"");
  const selected=detail.error?undefined:detail.data;
  const jobs=status.data?.jobs.filter(j=>j.state!=="done")??[];
  const pending=jobs.filter(j=>j.state!=="failed").length;
  const failed=jobs.filter(j=>j.state==="failed").length;
  const projectName=query.projectId==="unassigned"?"프로젝트 미지정":list.data?.projects.find(project=>project.id===query.projectId)?.name??"모든 프로젝트";
  return <section aria-label="Knowledge" className="min-w-0 pb-20 lg:pb-0">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <h2 className="text-lg font-semibold">정리된 지식</h2>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn("size-2 rounded-full",status.data?.connected?"bg-emerald-600":"bg-muted-foreground")} />
        <span>{status.isLoading?"연결 확인 중":status.data?.connected?"Hindsight 연결됨":"연결 확인 필요"}</span>
        <Button variant="ghost" size="icon" title="다시 조회" aria-label="다시 조회" onClick={()=>cache.invalidateQueries({queryKey:base})}><RefreshCw className="size-4"/></Button>
        <Button variant="ghost" size="icon" title="수집 설정" aria-label="수집 설정" disabled={!enabled} onClick={()=>setSettingsOpen(true)}><Settings2 className="size-4"/></Button>
        <label className="flex items-center gap-2">자동 수집<input type="checkbox" role="switch" aria-label="자동 수집" checked={status.data?.settings.enabled??false} disabled={!enabled || !status.data || !!status.error || action.isPending} onChange={event=>run("knowledge-settings",{enabled:event.target.checked})}/></label>
      </div>
    </header>
    <div className="space-y-3 py-4">
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input aria-label="지식 검색" placeholder="지식 검색" value={draft} onChange={e=>setDraft(e.target.value)} className="pl-9"/></div>
      <div aria-label="프로젝트 선택 영역" className="flex flex-wrap items-center gap-3">
      <select aria-label="프로젝트" className={selectClass} value={query.projectId} onChange={e=>update("project",e.target.value)}><option value="">모든 프로젝트</option>{list.data?.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}<option value="unassigned">프로젝트 미지정</option></select>
      <h3 className="min-w-0 break-words text-sm font-medium">{projectName}</h3>
      <span className="text-xs text-muted-foreground">{status.error?"수집 시각 확인 불가":status.isLoading?"수집 상태 확인 중":status.data?.lastCollectedAt?`마지막 수집 ${dateLabel(status.data.lastCollectedAt)}`:"수집 완료 기록 없음"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
      <div role="tablist" aria-label="지식 보기" className="flex items-center gap-1">
        <Button variant={graphView?"ghost":"secondary"} size="sm" role="tab" aria-selected={!graphView} onClick={()=>update("view","")}><BookOpen className="size-4"/>문서</Button>
        <Button variant={graphView?"secondary":"ghost"} size="sm" role="tab" aria-selected={graphView} onClick={()=>update("view","graph")}><Network className="size-4"/>그래프</Button>
      </div>
      <select aria-label="지식 종류" className={selectClass} value={query.category} onChange={e=>update("category",e.target.value)}><option value="">모든 종류</option>{list.data?.categories.map(c=><option key={c.key} value={c.key}>{c.title}</option>)}</select>
      <select aria-label="확인 상태" className={selectClass} value={query.review} onChange={e=>update("review",e.target.value)}><option value="">모든 확인 상태</option><option value="pending">확인 기록 없음</option><option value="confirmed">사용자 확인 완료</option></select>
      </div>
    </div>
    {(notice || errors.length>0) && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 border border-destructive/30 p-3 text-sm"><span className="break-words">{notice??errorMessage}</span><Button variant="outline" size="sm" onClick={()=>{setNotice(null);cache.invalidateQueries({queryKey:base});}}>재시도</Button></div>}
    {(pending>0 || failed>0) && <div role="status" className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>처리 중 {pending} · 실패 {failed}</span>{failed>0 && <Button size="sm" variant="outline" disabled={action.isPending} onClick={()=>run("knowledge-retry")}>실패 작업 재시도</Button>}</div>}
    {!plugins.isLoading && !enabled && <p className="py-10 text-center text-sm text-muted-foreground">Hindsight 플러그인 연결이 필요합니다.</p>}
    {enabled && graphView && <KnowledgeGraph plugin={plugin!.id} company={company} project={query.projectId} onOpenPage={id=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete("view");next.set("id",id);next.set("tab","sources");return next;})}/>}
    {enabled && !graphView && <div className="grid min-w-0 lg:knowledge-detail-grid">
      <aside aria-label="지식 목록" className={cn("min-w-0 lg:border-r lg:border-border",id && "hidden lg:block")}>
        {list.error?<p className="py-12 pr-4 text-sm text-muted-foreground">지식 목록을 확인할 수 없습니다.</p>:list.isLoading?<div role="status" className="flex items-center gap-2 py-10"><Loader2 className="size-4 animate-spin"/>지식 불러오는 중</div>:!list.data?.items.length?<p className="py-12 pr-4 text-sm text-muted-foreground">{query.q || query.projectId || query.category || query.review?"조건에 맞는 지식이 없습니다.":"아직 정리된 지식이 없습니다."}</p>:list.data.items.map(page=>{
          const project=list.data.projects.find(p=>p.id===page.projectId)?.name??"프로젝트 미지정";
          return <button key={page.id} onClick={()=>setParams(previous=>{const next=new URLSearchParams(previous);next.set("id",page.id);next.delete("tab");return next;})} aria-pressed={id===page.id} className={cn("block w-full border-b border-border px-3 py-4 text-left hover:bg-accent",id===page.id && "bg-accent")}>
            <div className="mb-1 flex items-start justify-between gap-2"><span className="min-w-0 break-words text-sm font-medium">{page.title}</span>{page.review==="confirmed" && <span className="shrink-0 text-xs text-muted-foreground">사용자 확인 완료</span>}</div>
            <p className="mb-1 text-xs text-muted-foreground">{list.data.categories.find(category=>category.key===page.category)?.title??page.category}</p>
            <p className="line-clamp-2 break-words text-sm text-muted-foreground">{page.summary || generationLabel[page.generationStatus]}</p>
            <p className="mt-2 truncate text-xs text-muted-foreground">{project} · {dateLabel(page.updatedAt)} · {generationLabel[page.generationStatus]}</p>
          </button>;
        })}
        {!list.error && !!list.data?.total && <div className="flex items-center justify-between py-4 pr-3 text-xs text-muted-foreground"><span>{list.data.total}개 · {list.data.page}페이지</span><div className="flex gap-1"><Button variant="ghost" size="icon" title="이전 페이지" aria-label="이전 페이지" disabled={list.data.page<=1} onClick={()=>update("page",String(list.data!.page-1))}><ChevronLeft className="size-4"/></Button><Button variant="ghost" size="icon" title="다음 페이지" aria-label="다음 페이지" disabled={list.data.page*20>=list.data.total} onClick={()=>update("page",String(list.data!.page+1))}><ChevronRight className="size-4"/></Button></div></div>}
      </aside>
      <article aria-label="지식 상세" className={cn("min-w-0 lg:px-6",!id && "hidden lg:block")}>
        {!!id && <Button variant="ghost" size="sm" className="mb-3 lg:hidden" onClick={()=>update("id","")}><ArrowLeft className="mr-1 size-4"/>목록</Button>}
        {!id?<p className="py-12 text-sm text-muted-foreground">선택한 지식이 여기에 표시됩니다.</p>:detail.isLoading?<p role="status" className="py-12 text-sm">문서 불러오는 중</p>:selected && <>
          <header className="mb-4 flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{selected.title}</h2><p className="mt-1 text-xs text-muted-foreground">AI 정리 · {dateLabel(selected.updatedAt)} · {generationLabel[selected.generationStatus]}</p></div><div className="flex gap-1"><Button variant="ghost" size="icon" title="문서 갱신" aria-label="문서 갱신" disabled={action.isPending} onClick={()=>run("knowledge-refresh",{id:selected.id})}><RefreshCw className="size-4"/></Button><Button variant="outline" size="sm" disabled={action.isPending || !selected.bodyHash || selected.review==="confirmed"} onClick={()=>run("knowledge-review",{id:selected.id,bodyHash:selected.bodyHash})}><Check className="mr-1 size-4"/>{selected.review==="confirmed"?"확인됨":"내용 확인"}</Button></div></header>
          <KnowledgeUsage plugin={plugin!.id} company={company} page={selected.id}/>
          {selected.lastError && <p role="alert" className="mb-3 break-words text-sm text-destructive">{selected.lastError}</p>}
          <nav aria-label="지식 상세 탭" className="mb-5 flex flex-wrap gap-4 border-b border-border">{[["body","본문"],["sources","근거"],["history","변경 이력"],["references","레퍼런스"]].map(([key,title])=><button key={key} aria-current={tab===key?"page":undefined} className={cn("border-b-2 px-1 py-2 text-sm",tab===key?"border-foreground":"border-transparent text-muted-foreground")} onClick={()=>update("tab",key)}>{title}</button>)}</nav>
          {tab==="references" && (references.error?<p className="text-sm text-muted-foreground">레퍼런스를 확인할 수 없습니다.</p>:references.isLoading?<p role="status">레퍼런스 불러오는 중</p>:!references.data?.items.length?<p className="text-sm text-muted-foreground">연결된 PDF·이미지가 없습니다.</p>:<div className="space-y-5">{references.data.items.map(reference=><section key={reference.id} className="min-w-0 border-b border-border pb-4">
            <a href={reference.href} target="_blank" rel="noreferrer" className="break-words text-sm underline">{reference.title}<ExternalLink className="ml-1 inline size-3"/></a>
            <p className="my-2 text-xs text-muted-foreground">{reference.issueTitle} · {reference.analyzed?"분석 완료":reference.warning??"본문 미분석"}</p>
            {reference.analyzed && reference.warning && <p className="mb-2 break-words text-xs text-muted-foreground">{reference.warning}</p>}
            {reference.checksum && <p className="mb-2 break-all font-mono text-xs text-muted-foreground">SHA-256: {reference.checksum}</p>}
            {reference.contentType==="application/pdf"?<KnowledgePdfPreview key={`${selected.id}:${reference.id}:${reference.checksum}`} plugin={plugin!.id} company={company} id={selected.id} attachmentId={reference.id} title={reference.title} checksum={reference.checksum}/>:<img src={reference.href} alt={reference.title} loading="lazy" className="max-h-96 max-w-full rounded-md object-contain"/>}
            {reference.evidence?.map(page=><details key={page.page} className="mt-3 min-w-0 border-t border-border pt-2">
              <summary className="cursor-pointer text-sm">{page.page}쪽 · {page.method==="vision"?"AI 이미지 해석":"PDF 본문 추출"}</summary>
              {reference.contentType==="application/pdf" && <a href={`${reference.href}#page=${page.page}`} target="_blank" rel="noreferrer" className="my-2 inline-flex items-center gap-1 text-xs underline">원문 {page.page}쪽<ExternalLink className="size-3"/></a>}
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{page.text}</pre>
            </details>)}
          </section>)}</div>)}
          {tab==="body" && (selected.body?<div className="min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto"><MarkdownBody>{selected.body}</MarkdownBody></div>:<p className="text-sm text-muted-foreground">문서를 생성하고 있습니다.</p>)}
          {tab==="sources" && (sources.error?<p className="text-sm text-muted-foreground">근거 자료를 확인할 수 없습니다.</p>:sources.isLoading?<p role="status">근거 불러오는 중</p>:<div className="space-y-5"><p className="text-xs text-muted-foreground">{sources.data?.label}</p>{sources.data?.items.map(source=><section key={source.id} className="border-b border-border pb-4"><h3 className="mb-2 break-words text-sm font-medium">{source.issueTitle}</h3><div className="space-y-2">{source.references.map(ref=><div key={ref.id} className="flex min-w-0 items-start justify-between gap-2 text-sm"><Link to={ref.href} className="min-w-0 break-words underline underline-offset-4">{ref.title}<ExternalLink className="ml-1 inline size-3"/></Link>{!ref.analyzed && <span className="shrink-0 text-xs text-muted-foreground">{ref.warning??"본문 미분석"}</span>}</div>)}</div></section>)}</div>)}
          {tab==="history" && (history.error?<p className="text-sm text-muted-foreground">변경 이력을 확인할 수 없습니다.</p>:history.isLoading?<p role="status">이력 불러오는 중</p>:<div className="space-y-6"><section><h3 className="mb-3 text-sm font-medium">확인 기록</h3>{history.data?.reviews.length?history.data.reviews.map((review,i)=><p key={i} className="text-sm text-muted-foreground">{dateLabel(review.at)} · {review.actor}</p>):<p className="text-sm text-muted-foreground">아직 확인하지 않은 문서입니다.</p>}</section><section><h3 className="mb-3 text-sm font-medium">생성 기록</h3><GenerationHistory value={history.data?.generation}/></section></div>)}
        </>}
      </article>
    </div>}
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>지식 수집</DialogTitle><DialogDescription>자료 {status.data?.sourceCount??0}개 · 처리 중 {pending}개 · 실패 {failed}개</DialogDescription></DialogHeader>
      <label className="flex items-center justify-between gap-3 py-2 text-sm">완료 작업 자동 수집<input type="checkbox" aria-label="완료 작업 자동 수집" checked={status.data?.settings.enabled??false} disabled={action.isPending} onChange={e=>run("knowledge-settings",{enabled:e.target.checked})}/></label>
      <div className="border-t border-border pt-4"><h3 className="mb-3 text-sm font-medium">기존 프로젝트 자료</h3><select aria-label="가져올 프로젝트" className={cn(selectClass,"w-full")} value={backfillProject} onChange={e=>{setBackfillProject(e.target.value);setPreview(null);}}><option value="">프로젝트 선택</option>{list.data?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <div className="mt-3 flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" disabled={!backfillProject || action.isPending} onClick={async()=>{const result=await run("knowledge-backfill",{projectId:backfillProject,preview:true}) as {count:number}|null;if(result)setPreview({count:result.count,projectId:backfillProject});}}>대상 확인<ArrowRight className="ml-1 size-4"/></Button>{preview && <><span className="text-sm">완료 작업 {preview.count}개</span><Button size="sm" disabled={action.isPending || !status.data?.settings.enabled || preview.projectId!==backfillProject} onClick={async()=>{const result=await run("knowledge-backfill",{projectId:backfillProject,preview:false});if(result){setPreview(null);setSettingsOpen(false);}}}>가져오기</Button></>}</div></div>
      {notice && <p role="alert" className="break-words text-sm text-destructive">{notice}</p>}
      {!!status.data?.imports?.length && <div className="space-y-3 border-t border-border pt-3">{status.data.imports.map(progress=><section key={progress.projectId} className="min-w-0">
        <p className="mb-1 truncate text-sm">{list.data?.projects.find(p=>p.id===progress.projectId)?.name??"프로젝트"}</p>
        <progress aria-label="기존 자료 수집 진행률" max={Math.max(1,progress.total)} value={progress.completed} className="h-2 w-full accent-foreground"/>
        <p className="mt-1 text-xs text-muted-foreground">수집 {progress.completed}/{progress.total} · 실패 {progress.failed}{progress.generating?" · 지식 정리 중":""}</p>
      </section>)}</div>}
    </DialogContent></Dialog>
  </section>;
}
