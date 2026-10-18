// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace";
const mock = vi.hoisted(() => ({ vaults: vi.fn(), read: vi.fn(), crumbs: vi.fn(), toolbar: vi.fn(), usage: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company", selectedCompany: null }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mock.crumbs, setBreadcrumbToolbar: mock.toolbar }) }));
vi.mock("../api/knowledgeWorkspace", () => ({ knowledgeWorkspaceApi: { vaults: mock.vaults, read: mock.read, usage: mock.usage, file: () => "/file" } }));
vi.mock("../api/projects", () => ({ projectsApi: { list: async () => [] } }));
vi.mock("../api/plugins", () => ({ pluginsApi: { list: async () => [] } }));
vi.mock("./Knowledge", () => ({ Knowledge: () => <div>기존 Paperclip 보관함</div> }));
vi.mock("../components/BrainKnowledgeGraph", () => ({ BrainKnowledgeGraph: ({ project }: { project: string }) => <div>그래프 범위 {project}</div> }));
vi.mock("../components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../components/ui/resizable-panels", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));
const original = { id: "original", title: "원본 메모", project: "Alpha", path: "Inbox/original.md", kind: "source", state: "ready", revision: "r1", summary: "원본 내용", content: "현재 원문", contentType: "text/markdown", byteSize: 10, updatedAt: "2026-10-15" };
const summary = { ...original, id: "summary", title: "프로젝트 현황", kind: "generated", content: "근거 있는 요약", references: [{ sourceId: "note:original", docId: "original", path: "Inbox/original.md", revision: "r1", project: "Alpha" }] };
let root: Root, container: HTMLDivElement;
async function wait(assertion: () => void) { for (let n = 0; n < 60; n++) { try { assertion(); return; } catch { await new Promise(r => setTimeout(r, 10)); } } assertion(); }
function render(path = "/knowledge") { const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); root = createRoot(container); flushSync(() => root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><KnowledgeWorkspace /></QueryClientProvider></MemoryRouter>)); }
beforeEach(() => { vi.clearAllMocks(); container = document.createElement("div"); document.body.append(container);
  localStorage.clear();
  mock.vaults.mockResolvedValue([{ id: "brain", name: "Personal Brain", kind: "personal-brain" }]);
  mock.usage.mockResolvedValue({ searches: 0, documentReads: 0, citationCopies: 0, agentSearches: 0, agentDocumentReads: 0, agentCitations: null });
  mock.read.mockImplementation(async (_company, _vault, tool, args) => {
    if (tool === "knowledge_tree") return { items: [
      { id: "in", name: "Inbox", path: "Inbox", parentId: null, type: "folder", canCreate: true },
      { id: "processed", name: "Processed", path: "Processed", parentId: null, type: "folder" },
      { id: "original", name: "original.md", path: original.path, parentId: "in", type: "note", writable: true },
      { id: "summary", name: "summary.md", path: "Processed/summary.md", parentId: "processed", type: "note" },
    ], complete: true };
    if (tool === "knowledge_library") return { items: [summary, original], total: 2, page: 1, pageSize: 30, counts: { all: 2, source: 1, generated: 1 }, projects: [{ id: "Alpha", name: "Alpha" }] };
    if (tool === "knowledge_status") return { connected: true, enabled: true, generationEnabled: true, mode: "full", queue: {}, complete: true };
    if (tool === "knowledge_document") return args.id === "original" ? original : summary;
    if (tool === "memory_recall") return { items: [{ id: "fact", text: "근거", reference: summary.references[0] }], incomplete: false };
    if (tool === "memory_reflect") return { markdown: "검증된 답변", references: summary.references, incomplete: false, generated: true };
  });
});
afterEach(() => { if (root) flushSync(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
describe("Knowledge workspace", () => {
  it("keeps raw-mode evidence available without offering disabled generation", async () => {
    const normal = mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async (...args) => args[2] === "knowledge_status" ? { connected: true, enabled: true, mode: "raw", generationEnabled: false, ready: 19, queue: {}, deferredGeneration: { pending: 37, failed: 21 } } : normal(...args));
    render("/knowledge/ask?vault=brain");
    await wait(() => expect(container.querySelector('.knowledge-ask-suggestions button')).not.toBeNull());
    flushSync(() => (container.querySelector('.knowledge-ask-suggestions button') as HTMLButtonElement).click());
    await wait(() => expect(container.querySelectorAll('.knowledge-result-row')).toHaveLength(1));
    expect(container.textContent).toContain("AI 답변 생성 꺼짐");
    expect(container.textContent).toContain("37 pending");
    expect([...container.querySelectorAll("button")].some(b => b.textContent === "Generate answer")).toBe(false);
    expect(mock.read.mock.calls.some(call => call[2] === "memory_reflect")).toBe(false);
  });
  it("defaults to the personal vault and opens source-backed summary and original", async () => { render(); await wait(() => expect(container.textContent).toContain("summary.md")); flushSync(() => (container.querySelector('[data-tree-id="summary"]') as HTMLButtonElement).click()); await wait(() => expect(container.textContent).toContain("근거 있는 요약")); flushSync(() => (container.querySelector('.knowledge-source-card') as HTMLButtonElement).click()); await wait(() => expect(container.textContent).toContain("현재 원문")); expect(mock.read).toHaveBeenCalledWith("company", "brain", "knowledge_document", { id: "original" }, expect.any(AbortSignal)); });
  it("clears Knowledge scope controls when leaving the workspace", async () => {
    render('/knowledge/ask?vault=brain&project=Alpha');
    await wait(() => expect(container.querySelector('[aria-label="Project"]')).not.toBeNull());
    expect(mock.toolbar.mock.calls.at(-1)?.[0]).toBeTruthy();
    flushSync(() => root.render(<div>Another page</div>));
    expect(mock.toolbar).toHaveBeenLastCalledWith(null);
  });
  it("selects one recalled passage while retaining the source-backed answer workflow", async () => {
    const normal = mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async (...args) => args[2] === 'memory_recall' ? {items: [
      {id:'first', text:'첫 번째 근거 전문', reference:summary.references[0]},
      {id:'second', text:'두 번째 근거 전문', reference:{...summary.references[0], path:'Inbox/second.md'}},
    ], incomplete:false} : normal(...args));
    render('/knowledge/ask?vault=brain');
    await wait(() => expect(container.querySelector('.knowledge-ask-suggestions button')).not.toBeNull());
    flushSync(() => (container.querySelector('.knowledge-ask-suggestions button') as HTMLButtonElement).click());
    await wait(() => expect(container.querySelectorAll('.knowledge-result-row')).toHaveLength(2));
    expect(container.querySelector('[aria-label="Evidence detail"]')?.textContent).toContain('첫 번째 근거 전문');
    flushSync(() => (container.querySelectorAll('.knowledge-result-row')[1] as HTMLButtonElement).click());
    expect(container.querySelector('[aria-label="Evidence detail"]')?.textContent).toContain('두 번째 근거 전문');
    expect(container.querySelectorAll('.knowledge-result-row')[1].getAttribute('aria-pressed')).toBe('true');
  });
  it("preserves legacy document links in the separate Paperclip vault", async () => { render("/knowledge?id=old-page&project=old-project"); await wait(() => expect(container.textContent).toContain("기존 Paperclip 보관함")); expect(mock.read).not.toHaveBeenCalled(); });
  it("shows search evidence before requesting a generated answer and opens its original", async () => {
    render("/knowledge/ask?vault=brain&project=Alpha");
    await wait(() => expect(container.querySelector('.knowledge-ask-suggestions button')).not.toBeNull());
    flushSync(() => (container.querySelector('.knowledge-ask-suggestions button') as HTMLButtonElement).click());
    await wait(() => expect(container.textContent).toContain("원문에서 확인한 검색 결과"));
    expect(mock.read.mock.calls.filter(c => c[2] === "memory_recall")).toHaveLength(1);
    expect(mock.read.mock.calls.filter(c => c[2] === "memory_reflect")).toHaveLength(0);
    const generate = [...container.querySelectorAll('button')].find(b => b.textContent === "Generate answer")!;
    flushSync(() => generate.click());
    await wait(() => expect(container.textContent).toContain("검증된 답변"));
    flushSync(() => (container.querySelector('.knowledge-answer-evidence .knowledge-source-card') as HTMLButtonElement).click());
    await wait(() => expect(container.textContent).toContain("현재 원문"));
  });
  it("keeps evidence visible and drops a late answer after cancellation", async () => {
    let finish!: (value: unknown) => void;
    const normal = mock.read.getMockImplementation()!;
    mock.read.mockImplementation((...args) => args[2] === "memory_reflect" ? new Promise(resolve => { finish = resolve; }) : normal(...args));
    render("/knowledge/ask?vault=brain&project=Alpha");
    await wait(() => expect(container.querySelector('.knowledge-ask-suggestions button')).not.toBeNull());
    flushSync(() => (container.querySelector('.knowledge-ask-suggestions button') as HTMLButtonElement).click());
    await wait(() => expect([...container.querySelectorAll('button')].find(b => b.textContent === "Generate answer")?.disabled).toBe(false));
    flushSync(() => [...container.querySelectorAll('button')].find(b => b.textContent === "Generate answer")!.click());
    await wait(() => expect(container.textContent).toContain("Cancel generation"));
    expect(container.querySelector('.knowledge-answer-evidence')?.textContent).toContain("original.md");
    flushSync(() => [...container.querySelectorAll('button')].find(b => b.textContent === "Cancel generation")!.click());
    finish({ markdown: "늦은 답변", references: summary.references, incomplete: false });
    await new Promise(r => setTimeout(r, 10));
    expect(container.textContent).not.toContain("늦은 답변");
    expect(container.querySelector('.knowledge-answer-evidence')?.textContent).toContain("original.md");
  });
  it("bounds generation to 30 seconds and leaves recalled evidence available", async () => {
    const deadlines = new Map<number, AbortController>();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); deadlines.set(ms, controller); return controller.signal; });
    const normal = mock.read.getMockImplementation()!;
    mock.read.mockImplementation((...args) => args[2] === "memory_reflect" ? new Promise((_resolve, reject) => args[4].addEventListener('abort', () => reject(new Error('timeout')))) : normal(...args));
    render("/knowledge/ask?vault=brain");
    await wait(() => expect(container.querySelector('.knowledge-ask-suggestions button')).not.toBeNull());
    flushSync(() => (container.querySelector('.knowledge-ask-suggestions button') as HTMLButtonElement).click());
    await wait(() => expect([...container.querySelectorAll('button')].find(b => b.textContent === "Generate answer")?.disabled).toBe(false));
    flushSync(() => [...container.querySelectorAll('button')].find(b => b.textContent === "Generate answer")!.click());
    deadlines.get(30_000)!.abort();
    await wait(() => expect(container.textContent).toContain("30초를 초과했습니다"));
    expect(container.querySelector('.knowledge-answer-evidence')?.textContent).toContain("original.md");
    vi.restoreAllMocks();
  });
  it("hides cached document content after a failed refresh", async () => { render("/knowledge?vault=brain&doc=summary"); await wait(() => expect(container.textContent).toContain("근거 있는 요약")); mock.read.mockRejectedValue(new Error("권한이 변경되었습니다.")); flushSync(() => (container.querySelector('[aria-label="Refresh knowledge"]') as HTMLButtonElement).click()); await wait(() => expect(container.textContent).not.toContain("근거 있는 요약")); });
  it("shows connection setup instead of fabricated data", async () => { mock.vaults.mockResolvedValue([]); render(); await wait(() => expect(container.textContent).toContain("Personal Brain을 연결해 주세요.")); expect(mock.read).not.toHaveBeenCalled(); });
  it("shows the missing legacy search connection", async () => { render("/knowledge/ask?vault=paperclip"); await wait(() => expect(container.textContent).toContain("Paperclip 지식 플러그인 연결을 확인해 주세요.")); expect(mock.read).not.toHaveBeenCalled(); });
});
