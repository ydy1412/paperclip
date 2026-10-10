import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { Maximize, Minus, Plus, RefreshCw } from "lucide-react";
import { knowledgeApi, type KnowledgeGraphData, type KnowledgeGraphDetail } from "../api/knowledge";
import { Button } from "./ui/button";
import { Link } from "@/lib/router";

type Selection={kind:"node"|"edge";id:string};
function fitKnowledgeGraph(instance:Core) {
  instance.fit(undefined,40);
  instance.zoom(Math.min(instance.zoom(),1));
  instance.center();
}
export function knowledgeGraphElements(data:KnowledgeGraphData):ElementDefinition[] {
  return [
    ...data.nodes.map(node=>({data:{id:`node:${node.id}`,nativeId:node.id,label:node.label,mentions:node.mentions,kind:"node"}})),
    ...data.edges.map(edge=>({data:{id:`edge:${edge.id}`,nativeId:edge.id,source:`node:${edge.source}`,target:`node:${edge.target}`,weight:edge.weight,kind:"edge"}})),
  ];
}

export function KnowledgeGraph({plugin,company,project,onOpenPage}:{plugin:string;company:string;project:string;onOpenPage:(id:string)=>void}) {
  const [selection,setSelection]=useState<Selection|null>(null);
  const [canvasError,setCanvasError]=useState<string|null>(null);
  const container=useRef<HTMLDivElement>(null),graphInstance=useRef<Core|null>(null);
  const graph=useQuery({queryKey:["knowledge",company,plugin,"graph",project],queryFn:()=>knowledgeApi.read<KnowledgeGraphData>(plugin,company,"knowledge-graph",{projectId:project}),enabled:!!project});
  const detail=useQuery({queryKey:["knowledge",company,plugin,"graph-detail",project,selection],queryFn:()=>knowledgeApi.read<KnowledgeGraphDetail>(plugin,company,"knowledge-graph-detail",{projectId:project,...selection}),enabled:!!project && !!selection && !graph.error});
  const data=graph.error ? undefined : graph.data;
  const evidence=detail.error || graph.error ? undefined : detail.data;
  useEffect(()=>{setSelection(null);setCanvasError(null);},[company,plugin,project]);
  useEffect(()=>{
    if (graph.error) setSelection(null);
    if (!container.current || !data?.nodes.length || graph.error) return;
    setCanvasError(null);
    let instance:Core;
    try {
      const tokens=getComputedStyle(document.documentElement);
      const foreground=tokens.getPropertyValue("--knowledge-graph-foreground").trim();
      const edge=tokens.getPropertyValue("--knowledge-graph-edge").trim();
      const selected=tokens.getPropertyValue("--knowledge-graph-selected").trim();
      instance=cytoscape({container:container.current,elements:knowledgeGraphElements(data),minZoom:0.2,maxZoom:4,wheelSensitivity:0.2,
        layout:data.nodes.length<=12
          ? {name:"circle",animate:false,padding:40,nodeDimensionsIncludeLabels:true,avoidOverlap:true,radius:160}
          : {name:"cose",animate:false,padding:40,nodeDimensionsIncludeLabels:true,nodeRepulsion:12000,idealEdgeLength:160},
        style:[{selector:"node",style:{label:"data(label)","background-color":foreground,color:foreground,"font-size":12,"text-wrap":"wrap","text-max-width":"120px","text-valign":"bottom","text-margin-y":8,width:24,height:24}},
          {selector:"edge",style:{"line-color":edge,width:2,"curve-style":"bezier"}},
          {selector:":selected",style:{"background-color":selected,"line-color":selected,"border-width":2,"border-color":selected}}],
      });
      graphInstance.current=instance;
      fitKnowledgeGraph(instance);
      instance.on("tap","node, edge",event=>setSelection({kind:event.target.data("kind"),id:event.target.data("nativeId")}));
    } catch {
      setCanvasError("그래프 화면을 표시할 수 없습니다.");return;
    }
    const observer=typeof ResizeObserver!=="undefined" ? new ResizeObserver(()=>{instance.resize();fitKnowledgeGraph(instance);}) : null;
    observer?.observe(container.current);
    return ()=>{observer?.disconnect();instance.destroy();graphInstance.current=null;};
  },[data,graph.error]);
  useEffect(()=>{
    const instance=graphInstance.current;if (!instance) return;
    instance.elements().unselect();
    if (selection) instance.getElementById(`${selection.kind}:${selection.id}`).select();
  },[selection]);
  if (!project) return <p className="py-12 text-sm text-muted-foreground">프로젝트를 선택해 주세요.</p>;
  if (graph.isLoading) return <p role="status" className="py-12 text-sm text-muted-foreground">그래프 불러오는 중</p>;
  if (graph.error) return <div role="alert" className="flex flex-wrap items-center gap-2 py-8 text-sm text-destructive">{graph.error.message}<Button variant="ghost" size="icon" title="그래프 다시 조회" aria-label="그래프 다시 조회" onClick={()=>graph.refetch()}><RefreshCw className="size-4"/></Button></div>;
  if (!data?.nodes.length) return <p className="py-12 text-sm text-muted-foreground">표시할 엔티티 관계가 없습니다.</p>;
  const nodeNames=new Map(data.nodes.map(node=>[node.id,node.label]));
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">엔티티 {data.nodes.length} · 관계 {data.edges.length}{data.partial?" · 표시 범위 제한":""}</p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" title="확대" aria-label="그래프 확대" disabled={!!canvasError} onClick={()=>{const cy=graphInstance.current;if(cy)cy.zoom(Math.min(cy.maxZoom(),cy.zoom()*1.3));}}><Plus className="size-4"/></Button>
        <Button variant="ghost" size="icon" title="축소" aria-label="그래프 축소" disabled={!!canvasError} onClick={()=>{const cy=graphInstance.current;if(cy)cy.zoom(Math.max(cy.minZoom(),cy.zoom()/1.3));}}><Minus className="size-4"/></Button>
        <Button variant="ghost" size="icon" title="전체 보기" aria-label="그래프 전체 보기" disabled={!!canvasError} onClick={()=>{if(graphInstance.current)fitKnowledgeGraph(graphInstance.current);}}><Maximize className="size-4"/></Button>
        <Button variant="ghost" size="icon" title="다시 조회" aria-label="그래프 다시 조회" onClick={()=>graph.refetch()}><RefreshCw className="size-4"/></Button>
      </div>
    </div>
    <div className="knowledge-graph-layout grid min-w-0 gap-4">
      <div className="min-w-0">
        {canvasError && <p role="alert" className="text-sm text-destructive">{canvasError}</p>}
        <div ref={container} role="img" aria-label="프로젝트 지식 그래프" className="knowledge-graph-canvas w-full min-w-0 border border-border"/>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm">엔티티·관계 목록</summary>
          <div className="mt-2 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
            {data.nodes.map(node=><button key={node.id} aria-pressed={selection?.kind==="node" && selection.id===node.id} onClick={()=>setSelection({kind:"node",id:node.id})} className="min-w-0 break-words rounded px-2 py-1 text-left text-xs hover:bg-accent">{node.label} · 언급 {node.mentions}</button>)}
            {data.edges.map(edge=><button key={edge.id} aria-pressed={selection?.kind==="edge" && selection.id===edge.id} onClick={()=>setSelection({kind:"edge",id:edge.id})} className="min-w-0 break-words rounded px-2 py-1 text-left text-xs hover:bg-accent">{nodeNames.get(edge.source)} · {nodeNames.get(edge.target)} · 함께 등장 {edge.weight}</button>)}
          </div>
        </details>
      </div>
      <aside aria-label="그래프 근거" className="min-w-0 space-y-4 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
        {!selection?<p className="text-sm text-muted-foreground">선택된 항목 없음</p>:detail.isLoading?<p role="status" className="text-sm">근거 불러오는 중</p>:detail.error?<p role="alert" className="text-sm text-destructive">{detail.error.message}</p>:evidence && <>
          <h3 className="break-words text-sm font-semibold">{evidence.title}</h3>
          {evidence.relationship && <p className="text-xs text-muted-foreground">함께 등장 {evidence.relationship.weight}</p>}
          {evidence.partial && <p className="text-xs text-muted-foreground">일부 근거 표시</p>}
          {!evidence.facts.length && <p className="text-sm text-muted-foreground">현재 범위의 연결된 원문 근거가 없습니다.</p>}
          {evidence.facts.map(fact=><section key={fact.id} className="min-w-0 space-y-2 border-b border-border pb-3"><p className="whitespace-pre-wrap break-words text-sm">{fact.text}</p><p className="break-words text-xs text-muted-foreground">{fact.issueTitle}</p>{fact.references.map(ref=><Link key={`${ref.kind}:${ref.id}`} to={ref.href} className="block break-words text-xs underline">{ref.title}</Link>)}</section>)}
          {evidence.pages.map(page=><button key={page.id} onClick={()=>onOpenPage(page.id)} className="block w-full break-words text-left text-sm underline">{page.title}</button>)}
        </>}
      </aside>
    </div>
  </div>;
}
