import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useNavigate } from "@/lib/router";
import { KnowledgeWorkspace } from "@/pages/KnowledgeWorkspace";
import { KnowledgeNavigation } from "@/components/KnowledgeNavigation";

const original = { id: "original", title: "예시 상품 관리 기획 메모", path: "Inbox/product.md", project: "Dovix", kind: "source", revision: "original-v1", summary: "상품 정보와 쇼핑몰 연결 방식을 정리했습니다.", content: "# 상품 관리\n\n상품 정보는 공통으로 관리하고 쇼핑몰별로 연결합니다.\n\n## 업로드\n\n등록된 상품은 수정하고, 미등록 채널은 추가 등록합니다.", state: "ready", contentType: "text/markdown", byteSize: 180, updatedAt: "2026-10-15T13:00:00Z", partial: false };
const reference = { sourceId: "note:original", docId: "original", path: original.path, revision: original.revision, project: "Dovix" };
const summary = { ...original, id: "summary", title: "예시 프로젝트 현황", path: "Processed/Projects/dovix/status.md", kind: "generated", summary: "주문 관리와 상품 연결을 중심으로 기능을 정리하고 있습니다.", content: "# 현재 진행 상황\n\n주문과 상품 관리를 한 작업 공간에 모으고 있습니다.\n\n- 주문은 배송 단계별로 조회합니다.\n- 상품은 공통 정보와 쇼핑몰 연결을 구분합니다.\n- 요약은 저장된 원문 근거로 확인합니다.", references: [reference] };
export function KnowledgeWorkspaceStory({ view = "library", state = "ready" }: { view?: "library" | "ask" | "graph"; state?: "ready" | "empty" | "error" } = {}) {
  const [ready, setReady] = useState(false), navigate = useNavigate(), client = useQueryClient();
  useEffect(() => {
    const previous = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
      if (url.pathname.endsWith("/knowledge/vaults")) return Response.json([{ id: "brain-story", name: "Personal Brain", kind: "personal-brain" }]);
      if (/\/knowledge\/brain-story\/read$/.test(url.pathname)) {
        if (state === "error") return Response.json({ error: "브레인 연결을 확인하고 다시 시도해 주세요." }, { status: 503 });
        const request = JSON.parse(String(init?.body));
        if (request.tool === "knowledge_status") return Response.json({ enabled: true, connected: true, complete: true, queue: {}, partial: 0 });
        if (request.tool === "knowledge_library") {
          const docs = state === "empty" ? [] : [summary, original].filter(d => (!request.arguments.kind || d.kind === request.arguments.kind) && (!request.arguments.query || d.title.includes(request.arguments.query)));
          return Response.json({ items: docs, total: docs.length, page: 1, pageSize: 30, projects: [{ id: "Dovix", name: "Dovix" }], counts: { all: state === "empty" ? 0 : 2, source: state === "empty" ? 0 : 1, generated: state === "empty" ? 0 : 1 }, complete: true });
        }
        if (request.tool === "knowledge_document") return Response.json(request.arguments.id === "summary" ? summary : original);
        if (request.tool === "memory_recall") return Response.json({ items: [{ id: "fact", text: "상품 정보는 공통으로 관리합니다.", reference }], incomplete: false });
        if (request.tool === "memory_reflect") return Response.json({ markdown: "상품 정보는 하나로 관리하고 **쇼핑몰별로 연결**합니다. 기존 상품은 수정하며, 미등록 채널은 추가 등록 대상으로 선택합니다.", references: [reference], generated: true, incomplete: false });
        if (request.tool === "knowledge_graph") return Response.json({ nodes: state === "empty" ? [] : [{ id: "project:Dovix", label: "Dovix", type: "project" }, { id: "document:summary", label: summary.title, type: "generated" }, { id: "document:original", label: original.title, type: "source" }], edges: [{ id: "membership", source: "project:Dovix", target: "document:summary", kind: "belongs_to", weight: 1 }, { id: "source", source: "document:summary", target: "document:original", kind: "derived_from", weight: 1 }], totalNodes: 3, totalEdges: 2, partial: false });
        if (request.tool === "knowledge_graph_detail") return Response.json({ title: "Dovix", kind: "project", facts: [], documents: [summary, original], partial: false });
      }
      return previous(input, init);
    };
    client.removeQueries({ queryKey: ["brain-knowledge"] }); client.removeQueries({ queryKey: ["brain-knowledge-vaults"] });
    navigate(`/knowledge${view === "library" ? "" : `/${view}`}?vault=brain-story&project=Dovix`, { replace: true }); setReady(true);
    return () => { window.fetch = previous; };
  }, [client, view, state]);
  return ready ? <div className="flex min-h-dvh bg-background text-foreground"><aside className="hidden w-52 shrink-0 border-r border-border pt-8 md:block"><KnowledgeNavigation /></aside><main className="min-w-0 flex-1 p-5"><p className="mb-3 text-xs text-muted-foreground">디자인 검증용 예시 데이터</p><KnowledgeWorkspace /></main></div> : null;
}
const meta = { title: "Knowledge/Integrated workspace", component: KnowledgeWorkspaceStory, parameters: { layout: "fullscreen" } } satisfies Meta<typeof KnowledgeWorkspaceStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Library: Story = { args: { view: "library" } };
export const Ask: Story = { args: { view: "ask" } };
export const Graph: Story = { args: { view: "graph" } };
export const Empty: Story = { args: { state: "empty" } };
export const ConnectionError: Story = { args: { state: "error" } };
