import { KnowledgeExplorer } from "../components/KnowledgeExplorer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { knowledgeWorkspaceApi as brain, type BrainAnswer, type BrainLibrary, type BrainRecall, type BrainStatus } from "../api/knowledgeWorkspace";
import { knowledgeApi, type KnowledgeList } from "../api/knowledge";
import { pluginsApi } from "../api/plugins";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { MarkdownBody } from "../components/MarkdownBody";
import { BrainKnowledgeGraph } from "../components/BrainKnowledgeGraph";
import { Knowledge } from "./Knowledge";

import { getKnowledgeView } from "../lib/knowledge-views";
const selectClass = "h-9 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";

export function KnowledgeWorkspace() {
  const { selectedCompanyId } = useCompany(), { setBreadcrumbs, setBreadcrumbToolbar } = useBreadcrumbs();
  const company = selectedCompanyId ?? "", [params, setParams] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const currentView = getKnowledgeView(location.pathname, params.get("view") === "graph"), view = currentView.id;
  const legacy = !params.has("vault") && (params.has("id") || params.get("view") === "graph");
  const vaults = useQuery({ queryKey: ["brain-knowledge-vaults", company], queryFn: () => brain.vaults(company), enabled: !!company, retry: false });
  const selectedVault = params.get("vault") ?? (legacy ? "paperclip" : vaults.data?.[0]?.id ?? "personal-brain");
  const paperclip = selectedVault === "paperclip", enabled = !!company && !!vaults.data?.some(v => v.id === selectedVault);
  const project = params.get("project") ?? "", doc = params.get("doc") ?? "";
  const query = params.get("q") ?? "";
  const cache = useQueryClient(), key = ["brain-knowledge", company, selectedVault];
  const library = useQuery({ queryKey: [...key, "library", project, query], queryFn: ({ signal }) => brain.read<BrainLibrary>(company, selectedVault, "knowledge_library",
    { ...(project ? { project } : {}), ...(query ? { query } : {}), page: 1 }, signal), enabled: enabled && view !== "library", retry: false });
  const status = useQuery({ queryKey: [...key, "status"], queryFn: ({ signal }) => brain.read<BrainStatus>(company, selectedVault, "knowledge_status", {}, signal), enabled, retry: false, refetchInterval: 30_000 });
  const [selectedEvidence, setSelectedEvidence] = useState<string | null>(null);
  const [question, setQuestion] = useState(""), [submitted, setSubmitted] = useState("");
  const [answer, setAnswer] = useState<BrainAnswer | null>(null), [answerError, setAnswerError] = useState<string | null>(null), [answering, setAnswering] = useState(false);
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const recalled = useQuery({ queryKey: [...key, "recall", project, submitted], queryFn: async ({ signal }) => {
    const deadline = AbortSignal.timeout(20_000);
    try { return await brain.read<BrainRecall>(company, selectedVault, "memory_recall", { query: submitted, ...(project ? { project } : {}) }, AbortSignal.any([signal, deadline])); }
    catch (error) { if (deadline.aborted) throw new Error("검색 응답이 늦어지고 있습니다. 검색어를 좁히거나 다시 검색해 주세요."); throw error; }
  }, enabled: enabled && view === "ask" && !!submitted, retry: false, refetchOnWindowFocus: false });
  useEffect(() => { setBreadcrumbs([{ label: "Knowledge", href: "/knowledge" }, { label: currentView.label }]); }, [setBreadcrumbs, currentView.label]);
  useEffect(() => {
    generation.current++; request.current?.abort(); request.current = null;
    setAnswer(null); setAnswerError(null); setAnswering(false); setSubmitted(""); setSelectedEvidence(null);
    return () => { generation.current++; request.current?.abort(); };
  }, [company, selectedVault, project, view]);
  useEffect(() => {
    generation.current++; request.current?.abort();
    setAnswer(null); setAnswerError(null); setAnswering(false);
  }, [recalled.dataUpdatedAt, recalled.error]);
  const update = useCallback((values: Record<string, string>, reset = false) => {
    setParams(previous => { const next = new URLSearchParams(previous); next.set("vault", selectedVault);
      if (reset) for (const key of ["doc", "id", "tab", "page"]) next.delete(key);
      for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
      return next; });
  }, [setParams, selectedVault]);
  function viewHref(nextView: string, id?: string) {
    const next = new URLSearchParams(); next.set("vault", selectedVault); if (project) next.set("project", project);
    if (id) next.set(paperclip ? "id" : "doc", id);
    return `/knowledge${nextView === "library" ? "" : `/${nextView}`}?${next}`;
  }
  const openDocument = (id: string) => navigate(viewHref("library", id));
  function ask(value: string) {
    if (!value.trim() || !enabled) return;
    generation.current++; request.current?.abort();
    setAnswer(null); setAnswerError(null); setAnswering(false); setQuestion(value); setSelectedEvidence(null);
    if (submitted === value.trim()) void recalled.refetch();
    else setSubmitted(value.trim());
  }
  async function generateAnswer() {
    if (!submitted || !recalled.data?.items.length || recalled.error || recalled.isFetching) return;
    request.current?.abort(); const controller = new AbortController(), current = ++generation.current; request.current = controller;
    const deadline = AbortSignal.timeout(30_000);
    setAnswer(null); setAnswerError(null); setAnswering(true);
    try { const result = await brain.read<BrainAnswer>(company, selectedVault, "memory_reflect", { query: submitted, ...(project ? { project } : {}) }, AbortSignal.any([controller.signal, deadline]));
      if (generation.current === current) setAnswer(result);
    } catch (e) { if (generation.current === current && !controller.signal.aborted) setAnswerError(deadline.aborted ? "AI 답변 정리가 30초를 초과했습니다. 검색 결과와 원문은 계속 확인할 수 있습니다." : e instanceof Error ? e.message : "답변을 생성할 수 없습니다."); }
    finally { if (generation.current === current) setAnswering(false); }
  }
  const currentProject = useMemo(() => {
    const projects = library.error ? [] : library.data?.projects ?? [];
    return project && !projects.some(p => p.id === project) ? [{ id: project, name: project }, ...projects] : projects;
  }, [library.data?.projects, library.error, project]);
  const refresh = useCallback(() => { void cache.invalidateQueries({ queryKey: ["brain-knowledge", company, selectedVault] }); void vaults.refetch(); }, [cache, company, selectedVault, vaults.refetch]);
  const scopeControls = useMemo(() => <div className="knowledge-scope-controls">
    <label><span className="sr-only">Vault</span><select aria-label="Vault" className={selectClass} value={selectedVault} onChange={e => setParams(new URLSearchParams({ vault: e.target.value }))}>
      {!vaults.data?.length && <option value="personal-brain">Personal Brain</option>}
      {vaults.data?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}<option value="paperclip">Paperclip Knowledge</option>
    </select></label>
    {!paperclip && view !== "library" && <label><span className="sr-only">Project</span><select aria-label="Project" className={selectClass} value={project} onChange={e => update({ project: e.target.value }, true)}><option value="">All projects</option>{currentProject.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    {!paperclip && <Button variant="ghost" size="icon" aria-label="Refresh knowledge" onClick={refresh}><RefreshCw className="size-4" /></Button>}
  </div>, [selectedVault, vaults.data, setParams, paperclip, view, project, update, currentProject, refresh]);
  useEffect(() => { setBreadcrumbToolbar(scopeControls); return () => setBreadcrumbToolbar(null); }, [scopeControls, setBreadcrumbToolbar]);
  const selectedFact = recalled.data?.items.find(item => item.id === selectedEvidence) ?? recalled.data?.items[0];
  return <section className="knowledge-workspace relative min-w-0 space-y-4" aria-label="Knowledge">
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-3"><h1 className="break-words text-base font-semibold text-foreground">{currentView.label}</h1></header>
    <div className="md:hidden">{scopeControls}</div>
    {vaults.error && !paperclip && <div role="alert" className="knowledge-alert">{vaults.error.message}<Button variant="outline" onClick={() => vaults.refetch()}>재시도</Button></div>}
    {paperclip ? view === "ask" ? <PaperclipKnowledgeSearch company={company} project={project} onDocument={openDocument} /> : <Knowledge viewMode={view === "graph" ? "graph" : "library"} /> : vaults.isLoading ? <p className="knowledge-empty" role="status">보관함 불러오는 중</p> : !enabled ? <div className="knowledge-empty"><BookOpen className="mx-auto mb-4 size-8" /><h2>Personal Brain을 연결해 주세요.</h2><p>본인 계정의 Apps 연결을 선택하면 저장한 자료를 볼 수 있습니다.</p><Button asChild className="mt-5"><Link to="/apps">연결 설정 열기</Link></Button></div> : <>
      {(library.error || status.error) && <div role="alert" className="knowledge-alert"><span>{library.error?.message ?? status.error?.message}</span><Button variant="outline" onClick={() => cache.invalidateQueries({ queryKey: key })}>재시도</Button></div>}
      {view === "library" && !status.error && <KnowledgeExplorer key={`${company}:${selectedVault}:${vaults.data?.find(v => v.id === selectedVault)?.ownerId ?? "read"}`} company={company} vault={vaults.data!.find(v => v.id === selectedVault)!} documentId={doc} onDocument={id => update({ doc: id })} />}
      {view === "ask" && !status.error && <div className="space-y-4">
        <form onSubmit={e => { e.preventDefault(); ask(question); }} className="knowledge-search-toolbar">
          <label className="min-w-0 flex-1"><span className="sr-only">Search knowledge</span><Input aria-label="브레인에 질문" type="search" value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} placeholder="질문이나 키워드로 저장한 자료 검색" /></label>
          <Button disabled={!question.trim() || recalled.isFetching} type="submit" aria-label="질문하기">{recalled.isFetching && <Loader2 className="mr-2 size-4 animate-spin" />}Search</Button>
          <Button type="button" variant="outline" disabled={!question && !submitted} onClick={() => { generation.current++; request.current?.abort(); void cache.cancelQueries({ queryKey: [...key, "recall"] }); setSubmitted(""); setQuestion(""); setAnswer(null); setAnswerError(null); setAnswering(false); setSelectedEvidence(null); }}>Clear</Button>
        </form>
        <div className="commerce-editor-layout knowledge-search-layout">
          <section aria-label="Search results" className="knowledge-search-results">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-3"><h2 className="text-sm font-medium">Results</h2><span className="text-xs text-muted-foreground">{recalled.error || recalled.isFetching ? "" : `${recalled.data?.items.length ?? 0}`}</span></div>
            <div className="knowledge-result-scroll">
              {recalled.isFetching && <div role="status" className="space-y-3 p-3 text-sm text-muted-foreground"><p>관련 근거를 검색하고 있습니다. 최대 20초 안에 결과를 확인합니다.</p><Button variant="outline" size="sm" onClick={() => { void cache.cancelQueries({ queryKey: [...key, "recall"] }); setSubmitted(""); }}>Cancel search</Button></div>}
              {recalled.error && <p role="alert" className="p-3 text-sm text-destructive">{recalled.error.message}</p>}
              {!submitted && <div className="space-y-3 p-3 text-sm text-muted-foreground"><p>질문이나 키워드를 입력하면 관련 근거를 목록으로 확인할 수 있습니다.</p><div className="knowledge-ask-suggestions">{["확인된 프로젝트 진행 상태를 간단히 정리하세요.", "최근 결정 사항은 무엇인가요?"].map(q => <button key={q} onClick={() => ask(q)}>{q}</button>)}</div></div>}
              {!!submitted && !recalled.error && !recalled.isFetching && recalled.data && (!recalled.data.items.length ? <p className="p-3 text-sm text-muted-foreground">관련 근거를 찾지 못했습니다. 프로젝트나 검색어를 바꿔 보세요.</p> : recalled.data.items.map(item => <button key={item.id} className="knowledge-result-row" aria-pressed={selectedFact?.id === item.id} onClick={() => setSelectedEvidence(item.id)}><strong>{item.reference.path.split("/").at(-1)}</strong><p>{item.text}</p><small>{item.reference.project || project || "Personal Brain"}</small></button>))}
            </div>
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">원문 근거 · {recalled.data?.incomplete ? "일부 자료 처리 중" : "AI 답변은 선택해서 생성합니다."}</p>
          </section>
          <aside className="knowledge-answer-evidence knowledge-search-detail" aria-label="Evidence detail">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"><h2 className="text-sm font-semibold">Evidence</h2><Button variant="outline" size="sm" onClick={generateAnswer} disabled={answering || recalled.isFetching || !!recalled.error || !recalled.data?.items.length}><Sparkles className="mr-2 size-4" />Generate answer</Button></header>
            <div className="knowledge-detail-scroll">
              {!submitted || recalled.isFetching || recalled.error || !selectedFact ? <p className="text-sm text-muted-foreground">검색 결과를 선택하면 근거와 원문을 확인할 수 있습니다.</p> : <>
                <p className="mb-3 text-xs text-muted-foreground">원문에서 확인한 검색 결과입니다.</p>
                <h3 className="mb-3 break-words text-base font-semibold">{selectedFact.reference.path.split("/").at(-1)}</h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{selectedFact.text}</p>
                <button className="knowledge-source-card" onClick={() => openDocument(selectedFact.reference.docId)}><strong>Open original →</strong><small>{selectedFact.reference.path}</small></button>
                {answering && <div role="status" className="knowledge-answer-wait mt-4"><Loader2 className="size-4 animate-spin" /><p>AI 답변 정리 중 · 최대 30초.</p><Button variant="ghost" size="sm" onClick={() => { generation.current++; request.current?.abort(); setAnswering(false); }}>Cancel generation</Button></div>}
                {answerError && <p role="alert" className="mt-4 text-sm text-destructive">{answerError}</p>}
                {answer && <section className="mt-6 border-t border-border pt-4"><h3 className="mb-3 text-sm font-semibold">AI answer</h3>{answer.markdown ? <MarkdownBody>{answer.markdown}</MarkdownBody> : <p>이 질문에 답할 근거를 찾지 못했습니다.</p>}<p className="knowledge-generated-note">자동 생성된 요약입니다. 중요한 결정은 원본과 함께 확인하세요.</p>{answer.incomplete && <p className="knowledge-generated-note">일부 자료가 처리 중이거나 조회되지 않아 답변이 불완전할 수 있습니다.</p>}{answer.references.filter((ref, i, all) => ref.docId !== selectedFact.reference.docId && all.findIndex(r => r.docId === ref.docId) === i).map(ref => <button key={ref.docId} className="knowledge-source-card" onClick={() => openDocument(ref.docId)}><strong>{ref.path.split("/").at(-1)}</strong><small>{ref.path}</small></button>)}</section>}
              </>}
            </div>
          </aside>
        </div>
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
