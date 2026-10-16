import { knowledgeWorkspaceApi as brain } from "@/api/knowledgeWorkspace";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useNavigate } from "@/lib/router";
import { KnowledgeWorkspace } from "@/pages/KnowledgeWorkspace";
import { KnowledgeSidebar } from "@/components/KnowledgeSidebar";

const original = { id: "original", title: "예시 상품 관리 기획 메모", path: "Inbox/product.md", project: "Dovix", kind: "source", revision: "original-v1", summary: "상품 정보와 쇼핑몰 연결 방식을 정리했습니다.", content: "# 상품 관리\n\n상품 정보는 공통으로 관리하고 쇼핑몰별로 연결합니다.\n\n## 업로드\n\n등록된 상품은 수정하고, 미등록 채널은 추가 등록합니다.", state: "ready", contentType: "text/markdown", byteSize: 180, updatedAt: "2026-10-15T13:00:00Z", partial: false };
const reference = { sourceId: "note:original", docId: "original", path: original.path, revision: original.revision, project: "Dovix" };
const summary = { ...original, id: "summary", title: "예시 프로젝트 현황", path: "Processed/Projects/dovix/status.md", kind: "generated", summary: "주문 관리와 상품 연결을 중심으로 기능을 정리하고 있습니다.", content: "# 현재 진행 상황\n\n주문과 상품 관리를 한 작업 공간에 모으고 있습니다.\n\n- 주문은 배송 단계별로 조회합니다.\n- 상품은 공통 정보와 쇼핑몰 연결을 구분합니다.\n- 요약은 저장된 원문 근거로 확인합니다.", references: [reference] };
export function KnowledgeWorkspaceStory({ view = "library", state = "ready" }: { view?: "library" | "ask" | "graph"; state?: "ready" | "empty" | "error" } = {}) {
  const [ready, setReady] = useState(false), navigate = useNavigate(), client = useQueryClient();
  useEffect(() => {
    const previous = window.fetch.bind(window), previousFile = brain.file;
    let sequence = 1;
    const docs: Record<string, typeof original> = state === "empty" ? {} : { original: { ...original }, summary: { ...summary } };
    const tree = [
      { id: "inbox", parentId: null, name: "Inbox", path: "Inbox", type: "folder", writable: false, canCreate: true, version: "v1" },
      { id: "processed", parentId: null, name: "Processed", path: "Processed", type: "folder", writable: false, canCreate: false, version: "v1" },
      { id: "empty-folder", parentId: "inbox", name: "빈 폴더", path: "Inbox/빈 폴더", type: "folder", writable: true, canCreate: true, version: "v1" },
      ...(state === "empty" ? [] : [
        { id: "original", parentId: "inbox", name: "product.md", path: original.path, type: "note", writable: true, canCreate: false, version: "v1" },
        { id: "summary", parentId: "processed", name: "프로젝트 현황.md", path: summary.path, type: "note", writable: false, canCreate: false, version: "v1" },
      ]),
    ];
    const trashed: { id: string; entityId: string; name: string; path: string; type: string; deletedAt: string }[] = [];
    const uploads = new Map<string, string>();
    brain.file = (company, vault, doc, download) => uploads.get(doc.id) ?? previousFile(company, vault, doc, download);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
      if (url.pathname.endsWith("/knowledge/vaults")) return Response.json([{ id: "brain-story", name: "Personal Brain", kind: "personal-brain", ownerId: "storybook-owner", actions: ["create_folder", "create_document", "save_document", "move", "trash_item", "restore", "upload"].map(a => "knowledge_" + a) }]);
      if (/\/knowledge\/brain-story\/upload$/.test(url.pathname)) {
        const data = init?.body as FormData, file = data.get("file") as File, parent = tree.find(i => i.id === data.get("parentId"))!;
        const id = "file-" + (++sequence), path = parent.path + "/" + file.name;
        uploads.set(id, URL.createObjectURL(file));
        docs[id] = { ...original, id, title: file.name, path, content: "", contentType: file.type, revision: "uploaded" };
        tree.push({ id, path, parentId: parent.id, name: file.name, type: "file", writable: true, canCreate: false, version: "v1" });
        return Response.json({ id });
      }
      if (/\/knowledge\/brain-story\/write$/.test(url.pathname)) {
        const { tool, arguments: a } = JSON.parse(String(init?.body));
        const current = tree.find(i => i.id === a.id), folder = tree.find(i => i.id === a.parentId) ?? tree.find(i => i.id === "inbox")!;
        if (tool === "knowledge_create_folder" || tool === "knowledge_create_document") {
          const id = "new-" + (++sequence), name = tool === "knowledge_create_document" && !a.name.endsWith(".md") ? a.name + ".md" : a.name;
          const path = folder.path + "/" + name;
          if (tree.some(i => i.path === path)) return Response.json({ error: "같은 이름이 있습니다." }, { status: 409 });
          tree.push({ id, name, path, parentId: folder.id, type: tool === "knowledge_create_folder" ? "folder" : "note", writable: true, canCreate: tool === "knowledge_create_folder", version: "v1" });
          if (tool === "knowledge_create_document") docs[id] = { ...original, id, title: name, path, content: a.copyFrom ? docs[a.copyFrom].content : "", revision: "v1" };
          return Response.json({ id });
        }
        if (tool === "knowledge_save_document") {
          if (a.expectedRevision !== docs[a.id].revision) return Response.json({ error: "다른 곳에서 수정되었습니다." }, { status: 409 });
          docs[a.id] = { ...docs[a.id], content: a.content, revision: "v" + (++sequence) };
          return Response.json({ revision: docs[a.id].revision });
        }
        if (tool === "knowledge_move" || tool === "knowledge_trash_item" || tool === "knowledge_restore") {
          const old = tool === "knowledge_restore" ? trashed.find(t => t.id === a.trashId)! : null;
          const item = current ?? tree.find(i => i.id === old?.entityId)!;
          const oldPath = item.path;
          const path = tool === "knowledge_trash_item" ? "Inbox/Trash/" + item.name : folder.path + "/" + (a.name || item.name);
          if (tool === "knowledge_trash_item") trashed.push({ id: a.operationId, entityId: item.id, name: item.name, path: oldPath, type: item.type, deletedAt: new Date().toISOString() });
          for (const row of tree) if (row.id === item.id || row.path.startsWith(oldPath + "/")) {
            row.path = path + row.path.slice(oldPath.length); row.version = "v" + (++sequence);
            if (docs[row.id]) docs[row.id].path = row.path;
          }
          item.parentId = folder.id; item.name = path.split("/").at(-1)!;
          if (old) trashed.splice(trashed.indexOf(old), 1);
          return Response.json({ id: item.id });
        }
      }
      if (/\/knowledge\/brain-story\/read$/.test(url.pathname)) {
        if (state === "error") return Response.json({ error: "브레인 연결을 확인하고 다시 시도해 주세요." }, { status: 503 });
        const request = JSON.parse(String(init?.body));
        if (request.tool === "knowledge_tree") return Response.json({ items: tree.filter(i => !i.path.startsWith("Inbox/Trash/")), complete: true, actions: ["create_folder", "create_document", "save_document", "move", "trash_item", "restore", "upload"].map(a => "knowledge_" + a) });
        if (request.tool === "knowledge_trash") return Response.json({ items: trashed });
        if (request.tool === "knowledge_status") return Response.json({ enabled: true, connected: true, complete: true, queue: {}, partial: 0 });
        if (request.tool === "knowledge_library") {
          const docs = state === "empty" ? [] : [summary, original].filter(d => (!request.arguments.kind || d.kind === request.arguments.kind) && (!request.arguments.query || d.title.includes(request.arguments.query)));
          return Response.json({ items: docs, total: docs.length, page: 1, pageSize: 30, projects: [{ id: "Dovix", name: "Dovix" }], counts: { all: state === "empty" ? 0 : 2, source: state === "empty" ? 0 : 1, generated: state === "empty" ? 0 : 1 }, complete: true });
        }
        if (request.tool === "knowledge_document") return docs[request.arguments.id] ? Response.json(docs[request.arguments.id]) : Response.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
        if (request.tool === "memory_recall") return Response.json({ items: [{ id: "fact", text: "상품 정보는 공통으로 관리합니다.", reference }], incomplete: false });
        if (request.tool === "memory_reflect") return Response.json({ markdown: "상품 정보는 하나로 관리하고 **쇼핑몰별로 연결**합니다. 기존 상품은 수정하며, 미등록 채널은 추가 등록 대상으로 선택합니다.", references: [reference], generated: true, incomplete: false });
        if (request.tool === "knowledge_graph") return Response.json({ nodes: state === "empty" ? [] : [{ id: "project:Dovix", label: "Dovix", type: "project" }, { id: "document:summary", label: summary.title, type: "generated" }, { id: "document:original", label: original.title, type: "source" }], edges: [{ id: "membership", source: "project:Dovix", target: "document:summary", kind: "belongs_to", weight: 1 }, { id: "source", source: "document:summary", target: "document:original", kind: "derived_from", weight: 1 }], totalNodes: 3, totalEdges: 2, partial: false });
        if (request.tool === "knowledge_graph_detail") return Response.json({ title: "Dovix", kind: "project", facts: [], documents: [summary, original], partial: false });
      }
      return previous(input, init);
    };
    client.removeQueries({ queryKey: ["brain-knowledge"] }); client.removeQueries({ queryKey: ["brain-knowledge-vaults"] });
    navigate(`/knowledge${view === "library" ? "" : `/${view}`}?vault=brain-story&project=Dovix`, { replace: true }); setReady(true);
    return () => { window.fetch = previous; brain.file = previousFile; for (const url of uploads.values()) URL.revokeObjectURL(url); };
  }, [client, view, state]);
  return ready ? <div className="flex min-h-dvh bg-background text-foreground"><aside className="hidden w-52 shrink-0 border-r border-border md:block"><KnowledgeSidebar /></aside><main className="min-w-0 flex-1 p-5"><p className="mb-3 text-xs text-muted-foreground">디자인 검증용 예시 데이터</p><KnowledgeWorkspace /></main></div> : null;
}
const meta = { title: "Knowledge/Integrated workspace", component: KnowledgeWorkspaceStory, parameters: { layout: "fullscreen" } } satisfies Meta<typeof KnowledgeWorkspaceStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Library: Story = { args: { view: "library" } };
export const Ask: Story = { args: { view: "ask" } };
export const Graph: Story = { args: { view: "graph" } };
export const Empty: Story = { args: { state: "empty" } };
export const ConnectionError: Story = { args: { state: "error" } };
