// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeExplorer, explorerRows } from "./KnowledgeExplorer";
import type { BrainTreeItem } from "../api/knowledgeWorkspace";

const mock = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), upload: vi.fn() }));
vi.mock("../api/knowledgeWorkspace", () => ({ knowledgeWorkspaceApi: { ...mock, file: () => "/fixture-file" } }));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("./ui/resizable-panels", () => ({ ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ResizableHandle: () => <div /> }));
const folders: BrainTreeItem[] = [
  { id: "in", name: "Inbox", path: "Inbox", parentId: null, type: "folder", canCreate: true, writable: false, version: "v1" },
  { id: "empty", name: "빈 폴더", path: "Inbox/빈 폴더", parentId: "in", type: "folder", canCreate: true, writable: true, version: "v1" },
  { id: "a", name: "a.md", path: "Inbox/a.md", parentId: "in", type: "note", canCreate: false, writable: true, version: "v1" },
  { id: "g", name: "generated.md", path: "Processed/generated.md", parentId: null, type: "note", canCreate: false, writable: false, version: "v1" },
];
const actions = ["create_folder", "create_document", "save_document", "move", "trash_item", "restore", "upload"].map(s => "knowledge_" + s);
let root: Root, container: HTMLDivElement, content: string, revision: string, client: QueryClient;
async function wait(check: () => void) { for (let n = 0; n < 100; n++) { try { check(); return; } catch { await new Promise(r => setTimeout(r, 10)); } } check(); }
const click = (label: string) => flushSync(() => (document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click());
function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  flushSync(() => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
function App({ write = true, doc = "a" }: { write?: boolean; doc?: string }) {
  const [id, setId] = useState(doc);
  return <KnowledgeExplorer company="company" vault={{ id: "vault", name: "Brain", kind: "personal-brain", ownerId: "owner", actions: write ? actions : [] }} documentId={id} onDocument={setId} />;
}
function render(props: { write?: boolean; doc?: string } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  root = createRoot(container); flushSync(() => root.render(<QueryClientProvider client={client}><App {...props} /></QueryClientProvider>));
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); content = "# Original"; revision = "r1";
  container = document.createElement("div"); document.body.append(container);
  mock.read.mockImplementation(async (_company, _vault, tool, args) => {
    if (tool === "knowledge_tree") return { items: folders, complete: true, actions };
    if (tool === "knowledge_trash") return { items: [{ id: "trash", entityId: "file", name: "image.png", path: "Inbox/image.png", type: "file" }] };
    if (tool === "knowledge_document") return { id: args.id, title: args.id, path: folders.find(f => f.id === args.id)?.path, content, revision, contentType: "text/markdown", kind: args.id === "g" ? "generated" : "source", state: "ready", references: [] };
  });
  mock.write.mockImplementation(async (_company, _vault, _tool, args) => { content = args.content; revision = "r2"; return { revision, id: "new" }; });
});
afterEach(() => { flushSync(() => root?.unmount()); container.remove(); });
describe("Knowledge file explorer", () => {
  it("opens an actual tree including empty folders and separate document tabs", async () => {
    render(); await wait(() => expect(container.textContent).toContain("# Original"));
    expect(container.querySelector('[data-tree-id="empty"]')).not.toBeNull();
    flushSync(() => (container.querySelector('[data-tree-id="g"]') as HTMLButtonElement).click());
    await wait(() => expect(container.textContent).toContain("수정본 만들기"));
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(container.querySelector('[aria-label="문서 Markdown 편집"]')).toBeNull();
  });
  it("keeps edits on failed save and sends the original revision on retry", async () => {
    render(); await wait(() => expect(container.textContent).toContain("# Original"));
    flushSync(() => [...container.querySelectorAll("button")].find(b => b.textContent === "편집")!.click());
    input(container.querySelector("textarea")!, "# Edited");
    mock.write.mockRejectedValueOnce(new Error("연결이 끊겼습니다."));
    flushSync(() => [...container.querySelectorAll("button")].find(b => b.textContent === "저장")!.click());
    await wait(() => expect(container.textContent).toContain("연결이 끊겼습니다."));
    expect(container.querySelector("textarea")!.value).toBe("# Edited");
    flushSync(() => [...container.querySelectorAll("button")].find(b => b.textContent === "저장")!.click());
    await wait(() => expect(container.textContent).toContain("서버에 저장했습니다."));
    expect(mock.write).toHaveBeenLastCalledWith("company", "vault", "knowledge_save_document", expect.objectContaining({ id: "a", content: "# Edited", expectedRevision: "r1" }));
  });
  it("persists an empty edit immediately on navigation and restores it without claiming server save", async () => {
    render(); await wait(() => expect(container.textContent).toContain("# Original"));
    flushSync(() => [...container.querySelectorAll("button")].find(b => b.textContent === "편집")!.click()); input(container.querySelector("textarea")!, "");
    flushSync(() => root.unmount()); render();
    await wait(() => expect(container.querySelector("textarea")?.value).toBe(""));
    expect(container.textContent).toContain("서버에는 아직 저장하지 않았습니다.");
    expect(mock.write).not.toHaveBeenCalled();
  });
  it("detects external revision changes and does not overwrite the local draft", async () => {
    render(); await wait(() => expect(container.textContent).toContain("# Original"));
    flushSync(() => [...container.querySelectorAll("button")].find(b => b.textContent === "편집")!.click()); input(container.querySelector("textarea")!, "My draft");
    revision = "external"; content = "External content"; await client.invalidateQueries({ queryKey: ["brain-knowledge"] });
    await wait(() => expect(container.textContent).toContain("다른 곳에서 수정되었습니다."));
    expect(container.querySelector("textarea")!.value).toBe("My draft");
    expect([...container.querySelectorAll("button")].find(b => b.textContent === "저장")!.disabled).toBe(true);
  });
  it("shows read-only connection actions as unavailable and never sends a mutation", async () => {
    render({ write: false }); await wait(() => expect(container.textContent).toContain("읽기 전용 연결"));
    for (const label of ["새 파일", "새 폴더", "파일 업로드"]) expect((container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).disabled).toBe(true);
    expect(mock.write).not.toHaveBeenCalled();
  });
  it("honors a read-key tree even when the shared connection catalog has write actions", async () => {
    const originalRead = mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async (...args) => args[2] === "knowledge_tree" ? { items: folders, complete: true, actions: [] } : originalRead(...args));
    render(); await wait(() => expect(container.textContent).toContain("# Original"));
    expect((container.querySelector('[aria-label="새 파일"]') as HTMLButtonElement).disabled).toBe(true);
    expect(mock.write).not.toHaveBeenCalled();
  });
  it("offers save, discard and cancel before closing a dirty tab", async () => {
    render(); await wait(() => expect(container.textContent).toContain("# Original"));
    flushSync(() => [...container.querySelectorAll("button")].find(b => b.textContent === "편집")!.click()); input(container.querySelector("textarea")!, "Draft"); click("a.md 탭 닫기");
    await wait(() => expect(document.body.textContent).toContain("변경 내용을 저장할까요?"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("저장 후 닫기");
    flushSync(() => [...document.querySelectorAll("button")].find(b => b.textContent === "취소")!.click());
    expect(container.querySelector("textarea")!.value).toBe("Draft");
  });
  it("search includes matching ancestors and preserves folder-first ordering", () => {
    const tree = [...folders, { ...folders[2], id: "child", path: "Inbox/빈 폴더/needle.md", name: "needle.md", parentId: "empty" }];
    expect(explorerRows(tree, new Set(), "needle").map(r => r.item.id)).toEqual(["in", "empty", "child"]);
    expect(explorerRows(tree, new Set(["in"])).map(r => r.item.id).indexOf("empty")).toBeLessThan(explorerRows(tree, new Set(["in"])).map(r => r.item.id).indexOf("a"));
  });
});
