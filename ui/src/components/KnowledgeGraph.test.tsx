// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeGraph, knowledgeGraphElements } from "./KnowledgeGraph";

const mock = vi.hoisted(() => ({ read: vi.fn(), renderer: vi.fn(), destroy: vi.fn(), fit: vi.fn(), zoom: vi.fn(), center: vi.fn(), selected: vi.fn() }));
vi.mock("../api/knowledge", () => ({ knowledgeApi: { read: mock.read } }));
vi.mock("cytoscape", () => ({ default: mock.renderer }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
const graph = { nodes: [{ id: "a", label: "Redis", mentions: 2 }, { id: "b", label: "PostgreSQL", mentions: 1 }], edges: [{ id: "a", source: "a", target: "b", weight: 1, kind: "cooccurrence" }], partial: false, totalEntities: 2, totalEdges: 1 };
const evidence = { kind: "node", id: "a", title: "Redis", relationship: null, partial: false, facts: [{ id: "fact", text: "Redis 원문 근거", issueTitle: "테스트 작업", references: [{ id: "doc", kind: "document", title: "원본 문서", href: "/issues/issue" }] }], pages: [{ id: "page", title: "관련 지식" }] };
let root: Root, container: HTMLDivElement, client: QueryClient;
const openPage = vi.fn();
async function waitFor(check: () => void) { for (let i = 0; i < 80; i++) { try { check(); return; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } } check(); }
function render(project = "project") { flushSync(() => root.render(<QueryClientProvider client={client}><KnowledgeGraph plugin="plugin" company="co" project={project} onOpenPage={openPage}/></QueryClientProvider>)); }
function click(text: string) { const button = [...container.querySelectorAll("button")].find(item => item.textContent?.includes(text)); expect(button).toBeTruthy(); flushSync(() => button!.click()); }
beforeEach(() => {
  vi.clearAllMocks();
  mock.zoom.mockImplementation((value?: number) => value ?? 1);
  mock.renderer.mockReturnValue({ on: vi.fn(), elements: () => ({ unselect: vi.fn() }), getElementById: () => ({ select: mock.selected }), resize: vi.fn(), fit: mock.fit, center: mock.center, destroy: mock.destroy, zoom: mock.zoom, minZoom: () => .2, maxZoom: () => 4 });
  mock.read.mockImplementation((_plugin, _company, key) => Promise.resolve(key === "knowledge-graph" ? graph : evidence));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { flushSync(() => root.unmount()); client.clear(); container.remove(); ["foreground","edge","selected"].forEach(name=>document.documentElement.style.removeProperty(`--knowledge-graph-${name}`)); });
describe("Knowledge graph", () => {
  it("uses the shared graph color tokens and responsive canvas classes",async()=>{
    document.documentElement.style.setProperty("--knowledge-graph-foreground","black");
    document.documentElement.style.setProperty("--knowledge-graph-edge","gray");
    document.documentElement.style.setProperty("--knowledge-graph-selected","teal");
    render();await waitFor(()=>expect(mock.renderer).toHaveBeenCalled());
    const styles=mock.renderer.mock.calls[0][0].style;
    expect(styles[0].style.color).toBe("black");
    expect(styles[1].style["line-color"]).toBe("gray");
    expect(styles[2].style["background-color"]).toBe("teal");
    expect(container.querySelector('[aria-label="프로젝트 지식 그래프"]')?.classList.contains("knowledge-graph-canvas")).toBe(true);
  });
  it("caps automatic fitting without enlarging small graphs or preventing explicit zoom", async () => {
    mock.zoom.mockImplementation((value?: number) => value ?? 4);
    render(); await waitFor(() => expect(mock.center).toHaveBeenCalled());
    expect(mock.zoom).toHaveBeenLastCalledWith(1);
    expect(mock.renderer.mock.calls[0][0].layout.nodeDimensionsIncludeLabels).toBe(true);
    expect(mock.renderer.mock.calls[0][0].layout).toMatchObject({name:"circle",avoidOverlap:true});
    mock.zoom.mockImplementation((value?: number) => value ?? .5);
    flushSync(() => (container.querySelector('[aria-label="그래프 전체 보기"]') as HTMLButtonElement).click());
    expect(mock.zoom).toHaveBeenLastCalledWith(.5);
  });
  it("preserves native endpoints without node/edge identifier collisions", () => {
    const elements = knowledgeGraphElements(graph);
    expect(elements.map(item => item.data.id)).toEqual(["node:a", "node:b", "edge:a"]);
    expect(elements[2].data).toMatchObject({ source: "node:a", target: "node:b", nativeId: "a" });
  });
  it("requires an explicit project and does not query the provider", () => {
    render(""); expect(container.textContent).toContain("프로젝트를 선택"); expect(mock.read).not.toHaveBeenCalled();
  });
  it("opens selected native node evidence and its related knowledge", async () => {
    render(); await waitFor(() => expect(mock.renderer).toHaveBeenCalled()); click("Redis · 언급");
    await waitFor(() => expect(container.textContent).toContain("Redis 원문 근거"));
    expect(mock.read).toHaveBeenCalledWith("plugin", "co", "knowledge-graph-detail", { projectId: "project", kind: "node", id: "a" });
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/issues/issue");
    click("관련 지식"); expect(openPage).toHaveBeenCalledWith("page");
  });
  it("requests native edge evidence separately from node evidence", async () => {
    render(); await waitFor(() => expect(mock.renderer).toHaveBeenCalled()); click("함께 등장");
    await waitFor(() => expect(mock.read).toHaveBeenCalledWith("plugin", "co", "knowledge-graph-detail", { projectId: "project", kind: "edge", id: "a" }));
  });
  it("clears selected evidence when the project changes", async () => {
    render(); await waitFor(() => expect(mock.renderer).toHaveBeenCalled()); click("Redis · 언급");
    await waitFor(() => expect(container.textContent).toContain("Redis 원문 근거")); render("other");
    await waitFor(() => expect(container.textContent).toContain("선택된 항목 없음"));
    expect(container.textContent).not.toContain("Redis 원문 근거");
  });
  it("hides cached graph and evidence after a permission failure", async () => {
    render(); await waitFor(() => expect(mock.renderer).toHaveBeenCalled()); click("Redis · 언급");
    await waitFor(() => expect(container.textContent).toContain("Redis 원문 근거"));
    mock.read.mockRejectedValue(new Error("조회 권한 없음"));
    await client.invalidateQueries({ queryKey: ["knowledge", "co", "plugin", "graph", "project"] });
    await waitFor(() => expect(container.textContent).toContain("조회 권한 없음"));
    expect(container.textContent).not.toContain("Redis 원문 근거"); expect(container.querySelector('[aria-label="프로젝트 지식 그래프"]')).toBeNull();
    expect(mock.destroy).toHaveBeenCalled();
  });
  it("keeps the accessible evidence list usable if canvas initialization fails", async () => {
    mock.renderer.mockImplementation(() => { throw new Error("canvas unavailable"); }); render();
    await waitFor(() => expect(container.textContent).toContain("그래프 화면을 표시할 수 없습니다"));
    expect((container.querySelector('[aria-label="그래프 확대"]') as HTMLButtonElement).disabled).toBe(true);
    click("Redis · 언급"); await waitFor(() => expect(container.textContent).toContain("Redis 원문 근거"));
  });
  it("limits zoom and destroys the renderer on unmount", async () => {
    render(); await waitFor(() => expect(mock.renderer).toHaveBeenCalled());
    mock.zoom.mockImplementation((value?: number) => value ?? 4);
    flushSync(() => (container.querySelector('[aria-label="그래프 확대"]') as HTMLButtonElement).click()); expect(mock.zoom).toHaveBeenLastCalledWith(4);
    mock.zoom.mockImplementation((value?: number) => value ?? .2);
    flushSync(() => (container.querySelector('[aria-label="그래프 축소"]') as HTMLButtonElement).click()); expect(mock.zoom).toHaveBeenLastCalledWith(.2);
    flushSync(() => root.unmount()); expect(mock.destroy).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });
  it("shows an empty state without initializing an empty canvas", async () => {
    mock.read.mockResolvedValue({ ...graph, nodes: [], edges: [] }); render();
    await waitFor(() => expect(container.textContent).toContain("표시할 엔티티 관계가 없습니다")); expect(mock.renderer).not.toHaveBeenCalled();
  });
});
