import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import cytoscape, { type Core } from "cytoscape";
import { Maximize, Minus, Plus } from "lucide-react";
import { knowledgeWorkspaceApi, type BrainGraphData, type BrainGraphDetail } from "../api/knowledgeWorkspace";
import { Button } from "./ui/button";

const kindLabel: Record<string, string> = { project: "프로젝트", source: "원본 자료", generated: "정리된 지식", entity: "주제",
  belongs_to: "프로젝트 분류", derived_from: "원본 근거", mentions: "등장한 자료", co_occurs: "함께 등장" };
export function BrainKnowledgeGraph({ company, vault, project, onDocument }: { company: string; vault: string; project: string; onDocument: (id: string) => void }) {
  const [selection, setSelection] = useState<string | null>(null), [canvasError, setCanvasError] = useState(false);
  const container = useRef<HTMLDivElement>(null), graphRef = useRef<Core | null>(null);
  const scope = ["brain-knowledge", company, vault, project];
  const graph = useQuery({ queryKey: [...scope, "graph"], queryFn: ({ signal }) => knowledgeWorkspaceApi.read<BrainGraphData>(company, vault, "knowledge_graph", project ? { project } : {}, signal), retry: false });
  const detail = useQuery({ queryKey: [...scope, "graph-detail", selection], queryFn: ({ signal }) => knowledgeWorkspaceApi.read<BrainGraphDetail>(company, vault, "knowledge_graph_detail", { id: selection, ...(project ? { project } : {}) }, signal), enabled: !!selection && !graph.error, retry: false });
  useEffect(() => { setSelection(null); }, [company, vault, project]);
  const data = graph.error ? undefined : graph.data;
  useEffect(() => {
    if (!container.current || !data?.nodes.length) return;
    setCanvasError(false);
    let instance: Core;
    try {
      const tokens = getComputedStyle(container.current), token = (name: string) => tokens.getPropertyValue(name).trim();
      instance = cytoscape({ container: container.current,
        elements: [...data.nodes.map(node => ({ data: { ...node, label: node.label, itemKind: "node" } })),
          ...data.edges.map(edge => ({ data: { ...edge, itemKind: "edge" } }))],
        layout: { name: "cose", animate: false, padding: 40, nodeDimensionsIncludeLabels: true, idealEdgeLength: 160, nodeRepulsion: 14000 },
        minZoom: 0.2, maxZoom: 3, wheelSensitivity: 0.2,
        // Cytoscape consumes numeric geometry; colors and typography use the common token root.
        style: [{ selector: "node", style: { label: "data(label)", "background-color": token("--knowledge-map-node"), color: token("--knowledge-map-text"),
          "font-size": Number.parseFloat(tokens.fontSize), "font-family": token("--font-sans"), "text-wrap": "wrap", "text-max-width": "130px", "text-valign": "center", width: 135, height: 62, shape: "round-rectangle", "border-width": 1, "border-color": token("--knowledge-map-line") } },
          { selector: 'node[type="project"]', style: { width: 155, height: 85, "background-color": token("--knowledge-map-project") } },
          { selector: 'node[type="entity"]', style: { shape: "ellipse", "background-color": token("--knowledge-map-topic") } },
          { selector: "edge", style: { "line-color": token("--knowledge-map-line"), width: 1.5, "curve-style": "bezier" } },
          { selector: 'edge[kind="derived_from"]', style: { "line-style": "dashed" } },
          { selector: ":selected", style: { "border-color": token("--knowledge-map-selected"), "border-width": 3, "line-color": token("--knowledge-map-selected") } }],
      });
      graphRef.current = instance;
      instance.on("tap", "node, edge", event => setSelection(event.target.id()));
    } catch { setCanvasError(true); return; }
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { instance.resize(); instance.fit(undefined, 40); }); resize?.observe(container.current);
    return () => { resize?.disconnect(); instance.destroy(); graphRef.current = null; };
  }, [data]);
  useEffect(() => { const g = graphRef.current; g?.elements().unselect(); if (selection) g?.getElementById(selection).select(); }, [selection]);
  if (graph.isLoading) return <p role="status" className="knowledge-empty">그래프 불러오는 중</p>;
  if (graph.error) return <div role="alert" className="knowledge-empty"><p>{graph.error.message}</p><Button variant="outline" onClick={() => graph.refetch()}>재시도</Button></div>;
  if (!data?.nodes.length) return <div className="knowledge-empty"><h3>아직 연결된 지식이 없습니다.</h3><p>저장된 자료와 원본 근거가 생기면 여기에 표시됩니다.</p></div>;
  const evidence = detail.error || graph.error ? undefined : detail.data;
  return <section className="knowledge-map" aria-label="지식 그래프">
    <div className="knowledge-map-canvas-panel">
      <div className="knowledge-map-legend"><span>프로젝트</span><span>자료</span><span>주제</span><span className="ml-auto">{data.nodes.length}개 · 연결 {data.edges.length}개{data.partial && " · 일부 표시"}</span></div>
      {canvasError && <p role="alert">그래프 화면을 표시할 수 없습니다. 아래 목록에서 자료를 선택해 주세요.</p>}
      <div ref={container} className="knowledge-map-canvas" aria-label="그래프 캔버스" />
      <div className="knowledge-map-controls"><span>분류·출처·함께 등장한 관계를 구분합니다.</span><div className="flex gap-1">
        <Button variant="ghost" size="icon" aria-label="그래프 축소" onClick={() => { const g = graphRef.current; if (g) g.zoom(g.zoom() / 1.2); }}><Minus className="size-4" /></Button>
        <Button variant="ghost" size="icon" aria-label="그래프 확대" onClick={() => { const g = graphRef.current; if (g) g.zoom(g.zoom() * 1.2); }}><Plus className="size-4" /></Button>
        <Button variant="ghost" size="icon" aria-label="그래프 전체 보기" onClick={() => graphRef.current?.fit(undefined, 40)}><Maximize className="size-4" /></Button>
      </div></div>
      <details className="knowledge-map-list"><summary>주제·자료·연결 목록</summary><div className="grid gap-1 sm:grid-cols-2">
        {data.nodes.map(n => <button key={n.id} aria-pressed={selection === n.id} onClick={() => setSelection(n.id)} className="rounded px-2 py-1 text-left text-xs hover:bg-accent">{kindLabel[n.type]} · {n.label}</button>)}
        {data.edges.map(e => <button key={e.id} aria-pressed={selection === e.id} onClick={() => setSelection(e.id)} className="rounded px-2 py-1 text-left text-xs hover:bg-accent">{kindLabel[e.kind]} · {data.nodes.find(n => n.id === e.source)?.label} → {data.nodes.find(n => n.id === e.target)?.label}</button>)}
      </div></details>
    </div>
    <aside className="knowledge-map-detail" aria-label="그래프 근거">
      <p className="knowledge-eyebrow">연결된 맥락</p>
      {!selection ? <p className="text-sm">노드나 연결을 선택해 근거를 확인하세요.</p> : detail.isLoading ? <p role="status">근거 불러오는 중</p> : detail.error ? <p role="alert">{detail.error.message}</p> : evidence && <>
        <h2>{evidence.title}</h2><p className="mt-2 text-xs">{kindLabel[evidence.kind] ?? evidence.kind}</p>
        <h3 className="mt-6 text-xs">관련 자료</h3>
        {evidence.documents.map(doc => <button className="knowledge-source-card" key={doc.id} onClick={() => onDocument(doc.id)}><strong>{doc.title}</strong><small>{doc.project} · {doc.kind === "source" ? "원본" : "자동 정리"}</small></button>)}
        {evidence.facts.map(fact => <section className="mt-4 text-sm" key={fact.id}><p>{fact.text}</p><button className="mt-2 text-xs underline" onClick={() => onDocument(fact.documentId)}>원문 확인 →</button></section>)}
        {evidence.partial && <p className="mt-4 text-xs">표시 범위가 제한되어 일부 근거만 표시합니다.</p>}
      </>}
    </aside>
  </section>;
}
