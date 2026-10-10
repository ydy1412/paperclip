import { useQuery } from "@tanstack/react-query";
import { knowledgeApi, type KnowledgeUsageData } from "../api/knowledge";
import { Link } from "@/lib/router";

export function KnowledgeUsage({plugin,company,page}:{plugin:string;company:string;page:string}) {
  const usage=useQuery({queryKey:["knowledge",company,plugin,"usage",page],queryFn:()=>knowledgeApi.read<KnowledgeUsageData>(plugin,company,"knowledge-usage",{id:page}),enabled:!!company && !!plugin && !!page,refetchInterval:30_000});
  if (usage.error) return <p role="alert" className="mb-4 text-xs text-destructive">활용 통계를 확인할 수 없습니다.</p>;
  if (usage.isLoading) return <p role="status" className="mb-4 text-xs text-muted-foreground">활용 통계 불러오는 중</p>;
  if (!usage.data) return null;
  return <section aria-label="지식 활용 통계" className="mb-4 min-w-0 border-b border-border pb-3 text-xs">
    <dl className="flex flex-wrap gap-x-5 gap-y-1"><div className="flex gap-2"><dt className="text-muted-foreground">에이전트 조회</dt><dd>{usage.data.retrievals}</dd></div><div className="flex gap-2"><dt className="text-muted-foreground">결과물 인용</dt><dd>{usage.data.citations}</dd></div></dl>
    {usage.data.recent.length ? <details className="mt-2"><summary className="cursor-pointer text-muted-foreground">최근 활용</summary><ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">{usage.data.recent.map(item=><li key={`${item.runId}:${item.kind}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span>{item.kind==="citation"?"인용":"조회"}</span><time className="text-muted-foreground" dateTime={item.at}>{new Date(item.at).toLocaleString("ko-KR")}</time>
      <Link to={`/agents/${encodeURIComponent(item.agentId)}`} className="break-words underline">{item.agentName}</Link>
      <Link to={`/issues/${encodeURIComponent(item.issueId)}`} className="break-words underline">{item.issueTitle}</Link>
    </li>)}</ul></details>:<p className="mt-2 text-muted-foreground">표시할 최근 활용 내역이 없습니다.</p>}
  </section>;
}
