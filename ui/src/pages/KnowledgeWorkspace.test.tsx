// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace";
const mock = vi.hoisted(() => ({ vaults: vi.fn(), read: vi.fn(), crumbs: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company", selectedCompany: null }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mock.crumbs }) }));
vi.mock("../api/knowledgeWorkspace", () => ({ knowledgeWorkspaceApi: { vaults: mock.vaults, read: mock.read, file: () => "/file" } }));
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
  mock.read.mockImplementation(async (_company, _vault, tool, args) => {
    if (tool === "knowledge_tree") return { items: [
      { id: "in", name: "Inbox", path: "Inbox", parentId: null, type: "folder", canCreate: true },
      { id: "processed", name: "Processed", path: "Processed", parentId: null, type: "folder" },
      { id: "original", name: "original.md", path: original.path, parentId: "in", type: "note", writable: true },
      { id: "summary", name: "summary.md", path: "Processed/summary.md", parentId: "processed", type: "note" },
    ], complete: true };
    if (tool === "knowledge_library") return { items: [summary, original], total: 2, page: 1, pageSize: 30, counts: { all: 2, source: 1, generated: 1 }, projects: [{ id: "Alpha", name: "Alpha" }] };
    if (tool === "knowledge_status") return { connected: true, enabled: true, queue: {}, complete: true };
    if (tool === "knowledge_document") return args.id === "original" ? original : summary;
    if (tool === "memory_recall") return { items: [{ id: "fact", text: "근거", reference: summary.references[0] }], incomplete: false };
    if (tool === "memory_reflect") return { markdown: "검증된 답변", references: summary.references, incomplete: false, generated: true };
  });
});
afterEach(() => { if (root) flushSync(() => root.unmount()); container.remove(); });
describe("Knowledge workspace", () => {
  it("defaults to the personal vault and opens source-backed summary and original", async () => { render(); await wait(() => expect(container.textContent).toContain("summary.md")); flushSync(() => (container.querySelector('[data-tree-id="summary"]') as HTMLButtonElement).click()); await wait(() => expect(container.textContent).toContain("근거 있는 요약")); flushSync(() => (container.querySelector('.knowledge-source-card') as HTMLButtonElement).click()); await wait(() => expect(container.textContent).toContain("현재 원문")); expect(mock.read).toHaveBeenCalledWith("company", "brain", "knowledge_document", { id: "original" }, expect.any(AbortSignal)); });
  it("preserves legacy document links in the separate Paperclip vault", async () => { render("/knowledge?id=old-page&project=old-project"); await wait(() => expect(container.textContent).toContain("기존 Paperclip 보관함")); expect(mock.read).not.toHaveBeenCalled(); });
  it("keeps project and vault in navigation links", async () => { render("/knowledge?vault=brain&project=Alpha"); await wait(() => expect(container.textContent).toContain("summary.md")); const links = [...container.querySelectorAll('.knowledge-mobile-tabs a')]; expect(links.find(a => a.textContent === "질문·검색")?.getAttribute('href')).toContain("/knowledge/ask?vault=brain&project=Alpha"); });
  it("shows real answer and opens its cited original", async () => { render("/knowledge/ask?vault=brain&project=Alpha"); await wait(() => expect(container.querySelector('[aria-label="브레인에 질문"]')).not.toBeNull()); flushSync(() => (container.querySelector('.knowledge-ask-suggestions button') as HTMLButtonElement).click()); await wait(() => expect(container.textContent).toContain("검증된 답변")); flushSync(() => (container.querySelector('.knowledge-answer-evidence .knowledge-source-card') as HTMLButtonElement).click()); await wait(() => expect(container.textContent).toContain("현재 원문")); });
  it("hides cached document content after a failed refresh", async () => { render("/knowledge?vault=brain&doc=summary"); await wait(() => expect(container.textContent).toContain("근거 있는 요약")); mock.read.mockRejectedValue(new Error("권한이 변경되었습니다.")); flushSync(() => (container.querySelector('[aria-label="지식 새로고침"]') as HTMLButtonElement).click()); await wait(() => expect(container.textContent).not.toContain("근거 있는 요약")); });
  it("shows connection setup instead of fabricated data", async () => { mock.vaults.mockResolvedValue([]); render(); await wait(() => expect(container.textContent).toContain("Personal Brain을 연결해 주세요.")); expect(mock.read).not.toHaveBeenCalled(); });
  it("shows the missing legacy search connection", async () => { render("/knowledge/ask?vault=paperclip"); await wait(() => expect(container.textContent).toContain("Paperclip 지식 플러그인 연결을 확인해 주세요.")); expect(mock.read).not.toHaveBeenCalled(); });
});
