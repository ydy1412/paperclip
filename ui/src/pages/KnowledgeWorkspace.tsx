import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BookOpen, FileText, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { knowledgeWorkspaceApi as brain, type BrainAnswer, type BrainDocument, type BrainLibrary, type BrainRecall, type BrainStatus } from "../api/knowledgeWorkspace";
import { knowledgeApi, type KnowledgeList } from "../api/knowledge";
import { pluginsApi } from "../api/plugins";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { MarkdownBody } from "../components/MarkdownBody";
import { BrainKnowledgeGraph } from "../components/BrainKnowledgeGraph";
import { Knowledge } from "./Knowledge";
import { cn } from "../lib/utils";

const tabs = [["library", "자료실", ""], ["ask", "질문·검색", "/ask"], ["graph", "지식 그래프", "/graph"]] as const;
const kindLabel = { source: "원본 자료", generated: "자동 정리" };
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "수정 시각 없음";
const selectClass = "knowledge-select";

export function KnowledgeWorkspace() {
  const { selectedCompanyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs();
  const company = selectedCompanyId ?? "", [params, setParams] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const view = location.pathname.endsWith("/graph") ? "graph" : location.pathname.endsWith("/ask") ? "ask" : params.get("view") === "graph" ? "graph" : "library";
  const legacy = !params.has("vault") && (params.has("id") || params.get("view") === "graph");
  const vaults = useQuery({ queryKey: ["brain-knowledge-vaults", company], queryFn: () => brain.vaults(company), enabled: !!company, retry: false });
  const selectedVault = params.get("vault") ?? (legacy ? "paperclip" : vaults.data?.[0]?.id ?? "personal-brain");
  const paperclip = selectedVault === "paperclip", enabled = !!company && !!vaults.data?.some(v => v.id === selectedVault);
  const project = params.get("project") ?? "", doc = params.get("doc") ?? "";
  const [draft, setDraft] = useState(params.get("q") ?? ""), query = params.get("q") ?? "", kind = params.get("kind") ?? "";
  const pageValue = Number(params.get("page") ?? 1), page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const cache = useQueryClient(), key = ["brain-knowledge", company, selectedVault];
  const library = useQuery({ queryKey: [...key, "library", project, query, kind, page], queryFn: ({ signal }) => brain.read<BrainLibrary>(company, selectedVault, "knowledge_library",
    { ...(project ? { project } : {}), ...(query ? { query } : {}), ...(kind ? { kind } : {}), page }, signal), enabled, retry: false });
  const status = useQuery({ queryKey: [...key, "status"], queryFn: ({ signal }) => brain.read<BrainStatus>(company, selectedVault, "knowledge_status", {}, signal), enabled, retry: false, refetchInterval: 30_000 });
  const detail = useQuery({ queryKey: [...key, "document", doc, project], queryFn: ({ signal }) => brain.read<BrainDocument>(company, selectedVault, "knowledge_document", { id: doc, ...(project ? { project } : {}) }, signal), enabled: enabled && !!doc && view === "library", retry: false });
  useEffect(() => {
    if (enabled && view === "library" && !doc && !library.error && !status.error && library.data?.items[0] && window.innerWidth >= 768) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set("vault", selectedVault); next.set("doc", library.data.items[0]!.id); return next; }, { replace: true });
    }
  }, [enabled, view, doc, library.data, library.error, status.error, selectedVault, setParams]);
  const [detailTab, setDetailTab] = useState("body");
  const [question, setQuestion] = useState(""), [submitted, setSubmitted] = useState("");
  const [answer, setAnswer] = useState<BrainAnswer | null>(null), [answerError, setAnswerError] = useState<string | null>(null), [answering, setAnswering] = useState(false);
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const recalled = useQuery({ queryKey: [...key, "recall", project, submitted], queryFn: ({ signal }) => brain.read<BrainRecall>(company, selectedVault, "memory_recall", { query: submitted, ...(project ? { project } : {}) }, signal), enabled: enabled && view === "ask" && !!submitted, retry: false });
  useEffect(() => { setBreadcrumbs([{ label: "지식", href: "/knowledge" }, { label: tabs.find(t => t[0] === view)![1] }]); }, [setBreadcrumbs, view]);
  useEffect(() => { setDraft(query); }, [query]);
  useEffect(() => { setDetailTab("body"); }, [doc, project, selectedVault, company]);
  useEffect(() => {
    generation.current++; request.current?.abort(); request.current = null;
    setAnswer(null); setAnswerError(null); setAnswering(false); setSubmitted("");
    return () => { generation.current++; request.current?.abort(); };
  }, [company, selectedVault, project, view]);
  function update(values: Record<string, string>, reset = false) {
    setParams(previous => { const next = new URLSearchParams(previous); next.set("vault", selectedVault);
      if (reset) for (const key of ["doc", "id", "tab", "page"]) next.delete(key);
      for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
      return next; });
  }
  function viewHref(nextView: string, id?: string) {
    const next = new URLSearchParams(); next.set("vault", selectedVault); if (project) next.set("project", project);
    if (id) next.set(paperclip ? "id" : "doc", id);
    return `/knowledge${nextView === "library" ? "" : `/${nextView}`}?${next}`;
  }
  const openDocument = (id: string) => navigate(viewHref("library", id));
  async function ask(value: string) {
    if (!value.trim() || !enabled) return;
    request.current?.abort(); const controller = new AbortController(), current = ++generation.current; request.current = controller;
    setSubmitted(value.trim()); setQuestion(value); setAnswer(null); setAnswerError(null); setAnswering(true);
    try { const result = await brain.read<BrainAnswer>(company, selectedVault, "memory_reflect", { query: value.trim(), ...(project ? { project } : {}) }, controller.signal);
      if (generation.current === current) setAnswer(result);
    } catch (e) { if (generation.current === current && !controller.signal.aborted) setAnswerError(e instanceof Error ? e.message : "답변을 생성할 수 없습니다."); }
    finally { if (generation.current === current) setAnswering(false); }
  }
  const selected = detail.error || library.error || status.error || vaults.error ? undefined : detail.data;
  const originals = selected?.references ?? [];
  const projects = library.error ? [] : library.data?.projects ?? [];
  const currentProject = project && !projects.some(p => p.id === project) ? [{ id: project, name: project }, ...projects] : projects;
  return <section className="knowledge-workspace" aria-label="통합 지식">
    <div className="knowledge-context-bar"><span>내 보관함 <span className="text-muted-foreground">/</span> 지식</span><div className="flex flex-wrap items-center gap-3">
      <label>보관함 <select aria-label="보관함" className={selectClass} value={selectedVault} onChange={e => {
        const next = new URLSearchParams({ vault: e.target.value }); setParams(next); }}>
        {!vaults.data?.length && <option value="personal-brain">Personal Brain</option>}
        {vaults.data?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}<option value="paperclip">Paperclip 지식</option>
      </select></label>
      {!paperclip && <label>프로젝트 <select aria-label="공통 프로젝트" className={selectClass} value={project} onChange={e => update({ project: e.target.value }, true)}><option value="">전체</option>{currentProject.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    </div></div>
    <nav className="knowledge-mobile-tabs" aria-label="지식 화면 전환">{tabs.map(([id, label]) => <Link key={id} to={viewHref(id)} aria-current={view === id ? "page" : undefined}>{label}</Link>)}</nav>
    <header className="knowledge-workspace-heading"><div><p className="knowledge-eyebrow">{paperclip ? "PAPERCLIP KNOWLEDGE" : "PERSONAL BRAIN"}</p><h1>{tabs.find(t => t[0] === view)![1]}</h1><p>{view === "library" ? "저장한 자료와 그 안에서 정리된 지식을 한곳에서." : view === "ask" ? "저장된 자료를 검색하고 답변의 근거까지 확인하세요." : "프로젝트와 자료, 주제 사이의 연결을 살펴보세요."}</p></div>
      {!paperclip && <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="knowledge-connection"><i data-connected={status.data?.connected && !status.error} />{status.error ? "연결 확인 필요" : status.data?.paused ? "자동 정리 일시 중지" : status.data?.connected ? "자동 정리 켜짐" : enabled ? "연결 확인 중" : "연결 필요"}</span><Button variant="ghost" size="icon" aria-label="지식 새로고침" onClick={() => { cache.invalidateQueries({ queryKey: key }); vaults.refetch(); }}><RefreshCw className="size-4" /></Button></div>}
    </header>
    {vaults.error && !paperclip && <div role="alert" className="knowledge-alert">{vaults.error.message}<Button variant="outline" onClick={() => vaults.refetch()}>재시도</Button></div>}
    {paperclip ? view === "ask" ? <PaperclipKnowledgeSearch company={company} project={project} onDocument={openDocument} /> : <Knowledge viewMode={view === "graph" ? "graph" : "library"} /> : vaults.isLoading ? <p className="knowledge-empty" role="status">보관함 불러오는 중</p> : !enabled ? <div className="knowledge-empty"><BookOpen className="mx-auto mb-4 size-8" /><h2>Personal Brain을 연결해 주세요.</h2><p>본인 계정의 Apps 연결을 선택하면 저장한 자료를 볼 수 있습니다.</p><Button asChild className="mt-5"><Link to="/apps">연결 설정 열기</Link></Button></div> : <>
      {(library.error || status.error) && <div role="alert" className="knowledge-alert"><span>{library.error?.message ?? status.error?.message}</span><Button variant="outline" onClick={() => cache.invalidateQueries({ queryKey: key })}>재시도</Button></div>}
      {view === "library" && !status.error && <div className="knowledge-library-layout">
        <aside className="knowledge-library-rail" aria-label="자료 분류"><p className="knowledge-rail-label">보관함</p>{[["", "모든 자료", BookOpen], ["source", "원본 자료", FileText], ["generated", "정리된 지식", Sparkles]].map(([value, label, Icon]) => {
          const Mark = Icon as typeof BookOpen; return <button key={String(value)} aria-pressed={kind === value} className={cn("knowledge-rail-button", kind === value && "active")} onClick={() => update({ kind: String(value) }, true)}><Mark className="size-4" /><span>{String(label)}</span><small>{library.error ? "—" : library.data?.counts[(value || "all") as "all" | "source" | "generated"] ?? "—"}</small></button>; })}
          <p className="knowledge-rail-label knowledge-rail-project-label">프로젝트</p>{projects.map(p => <button key={p.id} className={cn("knowledge-rail-button", project === p.id && "active")} onClick={() => update({ project: p.id }, true)}><span className="knowledge-project-dot" />{p.name}</button>)}
          <p className="knowledge-rail-help">요약의 근거를 누르면<br />저장된 원본으로 이어집니다.</p>
        </aside>
        <div className={cn("knowledge-document-list", doc && "knowledge-hide-mobile")} aria-label="자료 목록">
          <form onSubmit={e => { e.preventDefault(); update({ q: draft.trim() }, true); }} className="knowledge-search"><Search className="size-4" /><Input aria-label="자료 검색" placeholder="자료 검색" value={draft} onChange={e => setDraft(e.target.value)} /><Button variant="ghost" size="icon" type="submit" aria-label="자료 검색 실행"><ArrowRight className="size-4" /></Button></form>
          <div className="knowledge-list-caption"><span>{kind === "generated" ? "정리된 지식" : kind === "source" ? "원본 자료" : "모든 자료"}</span><span>{library.error ? "조회 실패" : `${library.data?.total ?? 0}개 · 최근 수정순`}</span></div>
          {library.isLoading ? <p role="status" className="knowledge-empty">자료 불러오는 중</p> : !library.error && !library.data?.items.length ? <div className="knowledge-empty"><p>{query || kind || project ? "조건에 맞는 자료가 없습니다." : "첫 번째 자료를 기다리고 있어요."}</p></div> : !library.error && library.data?.items.map(item => <button key={item.id} aria-pressed={doc === item.id} className={cn("knowledge-document-row", doc === item.id && "selected")} onClick={() => update({ doc: item.id })}>
            <span className="knowledge-row-meta">{item.kind === "generated" ? <Sparkles className="size-3" /> : <FileText className="size-3" />}{kindLabel[item.kind]} · {item.project}</span><strong>{item.title}</strong><p>{item.summary || item.path}</p><small>{item.state === "stale" ? "갱신 필요" : item.partial ? "일부 처리" : date(item.updatedAt)}</small>
          </button>)}
          {!!library.data && library.data.total > library.data.pageSize && !library.error && <div className="flex items-center justify-between p-3 text-xs"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1), doc: "" })}>이전</Button>{page} / {Math.ceil(library.data.total / library.data.pageSize)}<Button size="sm" variant="ghost" disabled={page * library.data.pageSize >= library.data.total} onClick={() => update({ page: String(page + 1), doc: "" })}>다음</Button></div>}
        </div>
        <article className={cn("knowledge-reader", !doc && "knowledge-hide-mobile")} aria-label="자료 상세">
          {!!doc && <Button variant="ghost" size="sm" className="knowledge-reader-back" onClick={() => update({ doc: "" })}><ArrowLeft className="size-4" />목록</Button>}
          {!doc ? <div className="knowledge-empty"><BookOpen className="mx-auto mb-4 size-7" /><p>선택한 자료가 여기에 표시됩니다.</p></div> : detail.isLoading ? <p role="status">자료 불러오는 중</p> : detail.error ? <p role="alert">{detail.error.message}</p> : selected && <>
            <div className="knowledge-reader-meta"><span className="knowledge-kind-tag">{kindLabel[selected.kind]}</span><span>{selected.project}</span></div><h2>{selected.title}</h2><p className="knowledge-reader-summary">{selected.summary}</p><p className="knowledge-reader-stamp">{date(selected.updatedAt)} · {selected.kind === "generated" ? `원본 ${originals.length}개` : "원본 내용 보관"}</p>
            <nav className="knowledge-reader-tabs" aria-label="자료 상세 보기"><button aria-current={detailTab === "body" ? "page" : undefined} onClick={() => setDetailTab("body")}>본문</button><button aria-current={detailTab === "sources" ? "page" : undefined} onClick={() => setDetailTab("sources")}>{selected.kind === "generated" ? `근거 ${originals.length}` : "파일 정보"}</button></nav>
            {detailTab === "sources" ? selected.kind === "generated" ? <>{originals.map(ref => <button key={ref.sourceId} className="knowledge-source-card" onClick={() => update({ doc: ref.docId })}><strong>{ref.path.split("/").at(-1)}</strong><small>{ref.project} · {ref.locator ?? "원본 본문"}</small></button>)}{!originals.length && <p className="text-sm text-muted-foreground">현재 확인할 수 있는 원본 근거가 없습니다.</p>}</> : <dl className="knowledge-file-info"><dt>위치</dt><dd>{selected.path}</dd><dt>형식</dt><dd>{selected.contentType}</dd><dt>크기</dt><dd>{selected.byteSize.toLocaleString()} bytes</dd></dl> : selected.state === "stale" ? <p role="status">원본이 변경되어 요약을 갱신하고 있습니다. 최신 원문을 먼저 확인해 주세요.</p> : selected.contentType === "text/markdown" ? <MarkdownBody>{selected.content ?? ""}</MarkdownBody> : <>
              {selected.contentType.startsWith("image/") ? <img className="knowledge-original-image" src={brain.file(company, selectedVault, selected)} alt={selected.title} /> : selected.contentType === "application/pdf" ? <iframe className="knowledge-original-pdf" title={selected.title} src={brain.file(company, selectedVault, selected)} /> : <p className="text-sm text-muted-foreground">이 형식은 원본 파일로 확인해 주세요.</p>}
              <Button variant="outline" asChild className="mt-4"><a href={brain.file(company, selectedVault, selected, true)}>원본 파일 내려받기</a></Button>
            </>}
            {detailTab === "body" && selected.kind === "generated" && originals.length > 0 && <div className="knowledge-inline-sources"><h3>이 지식의 근거</h3>{originals.map(ref => <button key={ref.sourceId} className="knowledge-source-card" onClick={() => update({ doc: ref.docId })}><strong>{ref.path.split("/").at(-1)}</strong><small>{ref.locator ?? ref.path}</small></button>)}</div>}
            {selected.kind === "generated" && <p className="knowledge-generated-note">자동 생성된 내용입니다. 판단이 필요한 내용은 원본을 확인하세요.</p>}
          </>}
        </article>
      </div>}
      {view === "ask" && !status.error && <div className="knowledge-ask-page"><div className="knowledge-ask-heading"><Sparkles className="size-5" /><h2>기억해 둔 것에서,<br /><span>필요한 답을 찾으세요.</span></h2></div><form onSubmit={e => { e.preventDefault(); ask(question); }} className="knowledge-ask-form"><Search className="size-5" /><Input aria-label="브레인에 질문" value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} placeholder="이 프로젝트에서 어떤 결정을 했나요?" /><Button disabled={!question.trim() || answering} type="submit" aria-label="질문하기">{answering ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}</Button></form><p className="knowledge-ask-caption">{project || "전체 프로젝트"} · 의미 검색 · 출처 기반 답변</p>
        <div className="knowledge-ask-suggestions">{["확인된 프로젝트 진행 상태를 간단히 정리하세요.", "최근 결정 사항은 무엇인가요?"].map(q => <button key={q} onClick={() => ask(q)} disabled={answering}>{q}</button>)}</div>
        {(submitted || answering) && <div className="knowledge-answer-layout"><article className="knowledge-answer-card"><p className="knowledge-eyebrow">저장된 자료에서 찾은 답</p><h3>{submitted}</h3>{answering && <div role="status" className="knowledge-answer-wait"><Loader2 className="size-4 animate-spin" /><p>근거를 찾아 답변을 정리하고 있습니다. 잠시 걸릴 수 있습니다.</p><Button variant="ghost" size="sm" onClick={() => { generation.current++; request.current?.abort(); setAnswering(false); }}>대기 취소</Button></div>}{answerError && <p role="alert">{answerError}</p>}{answer && !recalled.error && <>{answer.markdown ? <MarkdownBody>{answer.markdown}</MarkdownBody> : <p>이 질문에 답할 근거를 찾지 못했습니다. 프로젝트나 검색어를 바꿔 보세요.</p>}{answer.incomplete && <p className="knowledge-generated-note">일부 자료가 처리 중이거나 조회되지 않아 답변이 불완전할 수 있습니다.</p>}<p className="knowledge-generated-note">자동 생성된 요약입니다. 중요한 결정은 원본과 함께 확인하세요.</p></>}</article><aside className="knowledge-answer-evidence"><h3>답변의 근거</h3>{recalled.isLoading && <p role="status">근거 검색 중</p>}{recalled.error && <p role="alert">{recalled.error.message}</p>}{!recalled.error && (answer?.references ?? recalled.data?.items.map(i => i.reference) ?? []).filter((ref, i, all) => all.findIndex(r => r.docId === ref.docId) === i).map(ref => <button key={ref.docId} className="knowledge-source-card" onClick={() => openDocument(ref.docId)}><strong>{ref.path.split("/").at(-1)}</strong><small>{ref.project} · {ref.locator ?? "원문 확인"}</small></button>)}</aside></div>}
      </div>}
      {view === "graph" && !status.error && !library.error && <BrainKnowledgeGraph company={company} vault={selectedVault} project={project} onDocument={openDocument} />}
    </>}
  </section>;
}

function PaperclipKnowledgeSearch({ company, project, onDocument }: { company: string; project: string; onDocument: (id: string) => void }) {
  const [draft, setDraft] = useState(""), [query, setQuery] = useState("");
  const plugins = useQuery({ queryKey: ["plugins"], queryFn: () => pluginsApi.list() });
  const plugin = plugins.data?.find(p => p.pluginKey === "paperclip-plugin-hindsight" && p.status === "ready");
  const results = useQuery({ queryKey: ["knowledge", company, plugin?.id, "workspace-search", project, query], queryFn: () => knowledgeApi.read<KnowledgeList>(plugin!.id, company, "knowledge-list", { q: query, projectId: project, page: 1 }), enabled: !!plugin && !!query, retry: false });
  return <div className="knowledge-ask-page"><form className="knowledge-ask-form" onSubmit={e => { e.preventDefault(); setQuery(draft.trim()); }}><Search className="size-5" /><Input aria-label="Paperclip 지식 검색" value={draft} onChange={e => setDraft(e.target.value)} placeholder="저장된 지식에서 검색" /><Button type="submit" disabled={!draft.trim() || !plugin}>검색</Button></form><p className="knowledge-ask-caption">Paperclip 보관함은 저장된 지식의 본문 검색을 제공합니다. 출처 기반 답변 생성은 Personal Brain에서 사용할 수 있습니다.</p>{plugins.isLoading && <p role="status">지식 연결 확인 중</p>}{plugins.error && <p role="alert">{plugins.error.message}</p>}{!plugins.isLoading && !plugins.error && !plugin && <p role="status">Paperclip 지식 플러그인 연결을 확인해 주세요.</p>}{results.isLoading && <p role="status">검색 중</p>}{results.error && <p role="alert">{results.error.message}</p>}{!plugins.error && !results.error && results.data?.items.map(p => <button key={p.id} className="knowledge-source-card" onClick={() => onDocument(p.id)}><strong>{p.title}</strong><small>{p.summary}</small></button>)}{!!query && results.data?.total === 0 && <p>조건에 맞는 지식이 없습니다.</p>}</div>;
}
