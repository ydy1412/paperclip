import type { MarketingOverview, MarketingPublishJob } from "@paperclipai/shared";

const labels = { queued: "발행 대기", publishing: "발행 중", published: "발행 완료", auth_required: "로그인 필요", failed: "발행 실패", uncertain: "게시 여부 확인 필요", cancelled: "승인 취소" };
function publicationOrder(a: MarketingPublishJob, b: MarketingPublishJob) {
  const active = (status: string) => ["publishing", "uncertain"].includes(status) ? 1 : 0;
  return active(b.status) - active(a.status) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}
export function MarketingPublicationDot({ data, channelId }: { data?: MarketingOverview; channelId: string }) {
  const job = data?.jobs.filter(row => row.channelId === channelId && row.status !== "cancelled").sort(publicationOrder)[0];
  if (!job) return null;
  const tone = job.status === "published" ? "success" : ["queued", "publishing"].includes(job.status) ? "busy" : "error";
  return <span role="img" aria-label={`발행 상태: ${labels[job.status]}`} title={labels[job.status]} data-publication-state={tone} className="marketing-publication-dot size-2 shrink-0 rounded-full" />;
}
export function MarketingPublicationStatus({ data, projectId, error }: { data?: MarketingOverview; projectId: string; error?: string }) {
  const jobs = data?.jobs.filter(job => job.projectId === projectId && job.status !== "cancelled").sort(publicationOrder) || [];
  if (!error && !jobs.length) return null;
  return <section aria-label="채널별 Aside 발행 상태" className="min-w-0 space-y-3 border-t border-border pt-3">
    <h3 className="text-sm font-medium">Aside 발행 작업</h3>
    {error && <p role="alert" className="break-words text-xs text-destructive">상태 조회 실패: {error}</p>}
    {jobs.map(job => {
      const channel = data?.channels.find(row => row.id === job.channelId);
      const profile = data?.profiles.find(row => row.id === job.profileId);
      const draft = data?.drafts.find(row => row.id === job.draftId && row.revision === job.revision);
      return <div key={job.id} className="min-w-0 space-y-1 border-b border-border pb-3">
        <p className="break-words text-sm font-medium">{draft?.content.title || "발행 초안"} · 버전 {job.revision}</p>
        <p className="break-words text-xs text-muted-foreground">{channel?.name} · {profile?.name}</p>
        <p role="status" className="text-xs">{labels[job.status]}</p>
        <p className="text-xs text-muted-foreground">상태 갱신: {new Date(job.updatedAt).toLocaleString("ko-KR")}</p>
        {job.externalSessionId && <p className="break-all text-xs text-muted-foreground">Aside 세션: {job.externalSessionId}</p>}
        {job.lastError && <p className="break-words text-xs text-destructive">{job.lastError}</p>}
        {job.postedUrl && <a className="block break-all text-xs underline" href={job.postedUrl} target="_blank" rel="noreferrer">게시물 보기</a>}
      </div>;
    })}
  </section>;
}
