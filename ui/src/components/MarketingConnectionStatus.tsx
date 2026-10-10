import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchCheck } from "lucide-react";
import type { MarketingConnectionCheck, MarketingConnectionCheckStatus, MarketingConnectionStatus, MarketingChannel } from "@paperclipai/shared";
import { marketingApi } from "../api/marketing";
import { Button } from "./ui/button";
import { ToggleSwitch } from "./ui/toggle-switch";
import { marketingPlatformNames } from "./MarketingChannelForm";

const stages: Record<MarketingConnectionCheckStatus, string> = { queued: "대기", preparing: "세션 준비", requesting: "Aside 요청", waiting: "Aside 진행 중", result_received: "결과 도착 · 판정 대기", classifying: "결과 도착 · 판정 중", completed: "판정 완료", needs_attention: "확인 필요", cancelled: "취소" };
const verdicts: Record<MarketingConnectionStatus, string> = { connected: "연결 정상", auth_required: "로그인 필요", unknown: "확인 불가" };
export function connectionDotState(job?: MarketingConnectionCheck) {
  if (!job || ["queued", "cancelled"].includes(job.status)) return "queued";
  if (job.status === "needs_attention") return "error";
  if (job.resultReceivedAt) return "success";
  return "busy";
}
export function MarketingConnectionDot({ job }: { job?: MarketingConnectionCheck }) {
  const label = `연결 확인 작업: ${job ? stages[job.status] : "미실행"}`;
  return <span role="img" aria-label={label} title={label} data-connection-state={connectionDotState(job)} className="marketing-connection-dot size-2 shrink-0 rounded-full" />;
}
export function MarketingConnectionStatus({ company, projectId, channels }: { company: string; projectId: string; channels: MarketingChannel[] }) {
  const key = ["marketing-connection-checks", company, projectId], cache = useQueryClient();
  const state = useQuery({ queryKey: key, queryFn: () => marketingApi.connectionChecks(company, projectId), enabled: !!company && !!projectId, refetchInterval: 5000, refetchIntervalInBackground: true });
  const request = useMutation({ mutationFn: (channelIds?: string[]) => marketingApi.requestConnectionChecks(company, projectId, channelIds), onSuccess: () => cache.invalidateQueries({ queryKey: key }) });
  const monitor = useMutation({ mutationFn: (enabled: boolean) => marketingApi.setConnectionMonitor(company, projectId, enabled), onSuccess: () => cache.invalidateQueries({ queryKey: key }) });
  const error = state.error || request.error || monitor.error;
  return <section aria-label="SNS 연결 확인" className="min-w-0 space-y-3 border-t border-border pt-4">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">연결 상태</h2><Button size="sm" variant="ghost" disabled={!channels.length || !state.data || request.isPending} onClick={() => request.mutate(channels.map(channel => channel.id))}><SearchCheck className="size-4" />전체 확인</Button></div>
    <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>프로젝트 자동 확인 · 10분</span><ToggleSwitch aria-label="자동 연결 확인" checked={state.data?.monitor.enabled ?? false} disabled={!state.data || monitor.isPending} onCheckedChange={enabled => monitor.mutate(enabled)} /></label>
    {error && <p role="alert" className="break-words text-xs text-destructive">{error.message}{state.error && state.data ? " · 마지막 확인 결과를 표시합니다." : ""}</p>}
    {state.isLoading && <p role="status" className="text-xs text-muted-foreground">연결 작업 불러오는 중</p>}
    {channels.map(channel => {
      const job = state.data?.jobs.find(row => row.channelId === channel.id), connection = state.data?.connections.find(row => row.channelId === channel.id);
      const active = job && !["completed", "needs_attention", "cancelled"].includes(job.status);
      return <div key={channel.id} className="min-w-0 space-y-2 border-t border-border pt-3">
        <div className="flex min-w-0 items-center gap-2"><MarketingConnectionDot job={job} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{channel.name}</p><p className="break-words text-xs text-muted-foreground">{marketingPlatformNames[channel.platform]}</p></div><Button size="icon-sm" variant="ghost" aria-label={`${channel.name} 연결 확인`} title="연결 확인" disabled={!state.data || request.isPending || !!active || !channel.enabled} onClick={() => request.mutate([channel.id])}><SearchCheck className="size-4" /></Button></div>
        <div className="flex flex-wrap items-center justify-between gap-1"><span className="text-xs">계정: {verdicts[connection?.status ?? "unknown"]}</span><span className="text-xs text-muted-foreground">{job ? stages[job.status] : "미실행"}</span></div>
        {connection?.checkedAt && <p className="text-xs text-muted-foreground">마지막 확인 <time dateTime={connection.checkedAt}>{new Date(connection.checkedAt).toLocaleString("ko-KR")}</time></p>}
        {job?.reason && <p className="break-words text-xs text-destructive">{job.reason}</p>}
        {(job?.asideSessionId || job?.rawDecision) && <details className="min-w-0 text-xs text-muted-foreground"><summary className="cursor-pointer py-1">확인 상세</summary><div className="space-y-1 pt-1">
          {job.asideSessionId && <p className="break-all">Aside 세션: <span className="font-mono">{job.asideSessionId}</span></p>}
          {job.rawDecision && <p>모델: {verdicts[job.rawDecision.choice]} · {Math.round(job.rawDecision.probability * 100)}%{job.appliedStatus === "unknown" ? " · 기존 연결 상태 유지" : ""}</p>}
        </div></details>}
      </div>;
    })}
    {!channels.length && <p className="text-xs text-muted-foreground">확인할 활성 채널 없음</p>}
  </section>;
}
