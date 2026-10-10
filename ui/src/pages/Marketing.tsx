import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Folder, Monitor, Pencil, Plus, RefreshCw, Send, X, SearchCheck, RotateCcw } from "lucide-react";
import type { MarketingProfile, MarketingChannel, MarketingDraft, MarketingPublishJob, MarketingOverview, CreateMarketingProfile, MarketingJobStatus, MarketingBrowserProfile, CreateMarketingChannel } from "@paperclipai/shared";
import { createMarketingProfileSchema } from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSearchParams } from "@/lib/router";
import { marketingApi } from "../api/marketing";
import { ApiError } from "../api/client";
import { projectsApi } from "../api/projects";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { MarketingChannelForm, marketingPlatformNames } from "../components/MarketingChannelForm";
import { MarketingDraftAuthor, MarketingDraftDetail } from "../components/MarketingDraftDetail";
import { MarketingPublicationStatus, MarketingPublicationDot } from "../components/MarketingPublicationStatus";
import { MarketingConnectionStatus } from "../components/MarketingConnectionStatus";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../components/ui/dropdown-menu";

const statusNames: Record<MarketingJobStatus, string> = { queued: "발행 대기", publishing: "발행 중", published: "발행 완료", auth_required: "로그인 필요", failed: "발행 실패", uncertain: "게시 여부 확인 필요", cancelled: "승인 취소" };
type ReviewedPost = { draft: MarketingDraft; channel: MarketingChannel; profile: MarketingProfile };

function ProfileForm({ projectId, profile, available, pending, onSave, onCancel }: { projectId: string; profile?: MarketingProfile; available: MarketingBrowserProfile[]; pending: boolean; onSave: (input: CreateMarketingProfile) => void; onCancel: () => void }) {
  const [form, setForm] = useState<CreateMarketingProfile>({ projectId, name: profile?.name || "", asideAccountId: profile?.asideAccountId || available[0]?.asideAccountId || "", browserProfileName: profile?.browserProfileName || available[0]?.browserProfileName || "" });
  const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent) { event.preventDefault(); const result = createMarketingProfileSchema.safeParse(form); if (!result.success) { setError(result.error.issues[0].message); return; } onSave(result.data); }
  return <form onSubmit={submit} className="grid gap-4"><label className="grid gap-1 text-sm">프로필 이름<Input aria-label="프로필 이름" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label><label className="grid gap-1 text-sm">연결된 브라우저<select aria-label="연결된 브라우저 프로필" value={form.asideAccountId} className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm" onChange={e => { const selected = available.find(row => row.asideAccountId === e.target.value); if (selected) setForm({ ...form, asideAccountId: selected.asideAccountId, browserProfileName: selected.browserProfileName }); }}>{available.map(row => <option key={row.asideAccountId} value={row.asideAccountId}>{row.browserProfileName} · {row.asideAccountId}</option>)}</select></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>취소</Button><Button disabled={pending || !available.some(row => row.asideAccountId === form.asideAccountId && row.browserProfileName === form.browserProfileName)}>{pending ? "저장 중" : "저장"}</Button></div></form>;
}

export function Marketing() {
  const { selectedCompanyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs();
  const company = selectedCompanyId || "", cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") || "", profileId = params.get("profile") || "", channelId = params.get("channel") || "", draftId = params.get("draft") || "";
  const [dialog, setDialog] = useState<"profile" | "channel" | "approval" | null>(null);
  const [editingProfile, setEditingProfile] = useState<MarketingProfile | undefined>();
  const [editingChannel, setEditingChannel] = useState<MarketingChannel | undefined>();
  const [newChannelPlatform, setNewChannelPlatform] = useState<CreateMarketingChannel["platform"]>("naver_blog");
  const [selected, setSelected] = useState<string[]>([]), [notice, setNotice] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<ReviewedPost[]>([]);
  const selectAll = useRef<HTMLInputElement>(null);
  const base = ["marketing", company];
  const state = useQuery({ queryKey: base, queryFn: () => marketingApi.overview(company), enabled: !!company, refetchInterval: 5000, refetchIntervalInBackground: true });
  const projects = useQuery({ queryKey: ["marketing-projects", company], queryFn: () => projectsApi.list(company), enabled: !!company });
  const media = useQuery({ queryKey: [...base, "media", projectId], queryFn: () => marketingApi.media(company, projectId), enabled: !!company && !!projectId });
  const browserProfiles = useQuery({ queryKey: [...base, "browser-profiles"], queryFn: () => marketingApi.browserProfiles(company), enabled: !!company && dialog === "profile", retry: false });
  const mutation = useMutation({ mutationFn: (operation: () => Promise<unknown>) => operation(), onSuccess: async () => { await cache.invalidateQueries({ queryKey: base }); await cache.invalidateQueries({ queryKey: ["marketing-connection-checks", company] }); }, onError: (error: Error) => setNotice(error.message) });
  useEffect(() => { setBreadcrumbs([{ label: "마케팅" }]); }, [setBreadcrumbs]);
  useEffect(() => { setDialog(null); setSelected([]); setReviewed([]); setNotice(null); }, [company, projectId, profileId, channelId]);
  const accessDenied = state.error instanceof ApiError && [401, 403].includes(state.error.status);
  const data = accessDenied ? undefined : state.data;
  useEffect(() => { if (accessDenied) { setDialog(null); setReviewed([]); setSelected([]); } }, [accessDenied]);
  const profiles = data?.profiles.filter(profile => profile.projectId === projectId) || [];
  const channels = data?.channels.filter(channel => channel.projectId === projectId && (!profileId || channel.profileId === profileId)) || [];
  const drafts = data?.drafts.filter(draft => draft.projectId === projectId && (!channelId || draft.channelId === channelId) && channels.some(channel => channel.id === draft.channelId)) || [];
  const activeDraft = drafts.find(draft => draft.id === draftId);
  const activeChannel = channels.find(channel => channel.id === channelId);
  const connectionChannels = channels.filter(channel => channel.enabled && profiles.some(profile => profile.id === channel.profileId && profile.enabled));
  function draftJobs(draft: MarketingDraft) { return data?.jobs.filter(job => job.draftId === draft.id) || []; }
  function latestJob(draft: MarketingDraft): MarketingPublishJob | undefined {
    return draftJobs(draft).sort((a, b) => Number(["publishing", "uncertain"].includes(b.status)) - Number(["publishing", "uncertain"].includes(a.status)) || b.revision - a.revision || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  }
  function draftStatus(draft: MarketingDraft) {
    const job = latestJob(draft);
    return job && (job.revision === draft.revision || ["publishing", "uncertain"].includes(job.status)) ? statusNames[job.status] : "미발행";
  }
  function publicationReason(draft: MarketingDraft) {
    const jobs = draftJobs(draft);
    const unresolved = jobs.find(job => ["publishing", "uncertain"].includes(job.status));
    if (unresolved) return statusNames[unresolved.status];
    const sameVersion = jobs.find(job => job.revision === draft.revision && job.status !== "cancelled");
    if (sameVersion) return statusNames[sameVersion.status];
    // An existing unique job requires recovery or a new version, not fresh admission.
    if (jobs.some(job => job.revision === draft.revision)) return "승인 취소된 버전입니다. 새 버전이 필요합니다.";
    if (!data?.publicationEnabled) return "발행 연결이 활성화되지 않았습니다.";
    const capabilities = data.publicationCapabilities, channel = data.channels.find(row => row.id === draft.channelId);
    if (!capabilities || !channel || !capabilities.platforms.includes(channel.platform)) return "이 채널의 발행은 아직 지원되지 않습니다.";
    if (!capabilities.media && draft.content.media.length) return "이미지·영상 발행은 아직 지원되지 않습니다.";
    const profile = data.profiles.find(row => row.id === channel.profileId);
    if (!channel.enabled || !profile?.enabled) return "비활성화된 채널 또는 프로필입니다.";
    if (profile.blockedReason) return "프로필의 발행 차단을 먼저 해제해야 합니다.";
    return null;
  }
  const eligible = drafts.filter(draft => !publicationReason(draft));
  const chosen = drafts.filter(draft => selected.includes(draft.id));
  const selectionBlocked = chosen.some(draft => !!publicationReason(draft)) || selected.length !== chosen.length || selected.length > 50;
  const allSelected = eligible.length > 0 && eligible.every(draft => selected.includes(draft.id));
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = !allSelected && eligible.some(draft => selected.includes(draft.id)); }, [allSelected, eligible, selected]);
  function reviewChanged(row: ReviewedPost) {
    const draft = drafts.find(item => item.id === row.draft.id), channel = data?.channels.find(item => item.id === row.channel.id), profile = data?.profiles.find(item => item.id === row.profile.id);
    return !draft || !channel || !profile || draft.revision !== row.draft.revision || JSON.stringify(draft.content) !== JSON.stringify(row.draft.content) ||
      (["profileId", "platform", "name", "accountId", "accountUrl", "concept", "tone", "audience", "writingRules", "enabled"] as const).some(key => channel[key] !== row.channel[key]) ||
      profile.asideAccountId !== row.profile.asideAccountId || profile.browserProfileName !== row.profile.browserProfileName || !!publicationReason(draft);
  }
  const approvalChanged = reviewed.some(reviewChanged);
  function navigate(next: Record<string, string>) { setParams(new URLSearchParams(next)); }
  function channelButton(channel: MarketingChannel, profile: MarketingProfile) {
    return <button key={channel.id} aria-label={`${channel.name} 선택`} className="flex w-full min-w-0 items-center gap-2 rounded-md py-2 pl-6 pr-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground" aria-pressed={channel.id === channelId} onClick={() => navigate({ project: projectId, profile: profile.id, channel: channel.id })}><span className="min-w-0 flex-1 break-words">{channel.name}</span>{channel.enabled && profile.enabled ? <MarketingPublicationDot data={data} channelId={channel.id} /> : <span className="shrink-0 text-xs">중지</span>}</button>;
  }
  async function run(operation: () => Promise<unknown>, close = false) {
    setNotice(null); try { await mutation.mutateAsync(operation); if (close) setDialog(null); } catch { /* Keep the failed operation and its recovery visible. */ }
  }
  function openApproval() {
    if (!chosen.length || selectionBlocked || state.error || mutation.isPending) return;
    const rows = chosen.map(draft => { const channel = data!.channels.find(row => row.id === draft.channelId)!; return { draft, channel, profile: data!.profiles.find(row => row.id === channel.profileId)! }; });
    setReviewed(rows); setNotice(null); setDialog("approval");
  }
  async function approveSelected() {
    if (!reviewed.length || reviewed.some(reviewChanged) || state.error) throw new Error("내용 또는 발행 대상이 변경되었습니다. 다시 확인하십시오.");
    const queued = await marketingApi.queue(company, { drafts: reviewed.map(({ draft }) => ({ id: draft.id, revision: draft.revision })) });
    cache.setQueryData<MarketingOverview>(base, previous => previous ? { ...previous, jobs: [...previous.jobs.filter(job => !queued.some(row => row.id === job.id)), ...queued] } : previous);
    setSelected([]); setDialog(null); setReviewed([]);
    await cache.invalidateQueries({ queryKey: base });
    try { if (queued.length) await marketingApi.dispatch(company, projectId, queued.map(job => job.id)); }
    catch (error) { throw new Error(`발행 요청 결과를 확인해야 합니다. 다시 발행하지 마십시오. ${error instanceof Error ? error.message : "Aside 요청 실패"}`); }
  }
  function refresh() { void cache.invalidateQueries({ queryKey: base }); void cache.invalidateQueries({ queryKey: ["marketing-connection-checks", company] }); }
  if (!company) return <p className="p-6 text-sm text-muted-foreground">회사를 선택하십시오.</p>;
  return <main className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex items-center justify-between gap-3"><h1 className="text-xl font-semibold">마케팅</h1><Button variant="ghost" size="icon" aria-label="마케팅 다시 조회" title="다시 조회" onClick={refresh}><RefreshCw className="size-4" /></Button></header>
    {(notice || state.error || projects.error || media.error) && <p role="alert" className="break-words text-sm text-destructive">{notice || state.error?.message || projects.error?.message || media.error?.message}</p>}
    {state.isLoading && <p role="status" className="text-sm text-muted-foreground">불러오는 중</p>}
    <div className="marketing-layout grid min-w-0 gap-6">
      <aside aria-label="마케팅 프로젝트와 채널" className="min-w-0 space-y-4 border-b border-border pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
        <nav aria-label="프로젝트와 채널 선택" className="min-w-0 space-y-1">
          {(projects.data || []).map(project => <div key={project.id} className="min-w-0">
            <button className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium hover:bg-accent" aria-expanded={project.id === projectId} onClick={() => navigate({ project: project.id })}><ChevronRight className={`size-3 shrink-0 ${project.id === projectId ? "rotate-90" : ""}`} /><Folder className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{project.name}</span></button>
            {project.id === projectId && <div className="space-y-2 pl-3 pt-1">{profiles.map(profile => <div key={profile.id} className="min-w-0 space-y-1">
              <button className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent aria-pressed:bg-accent" aria-pressed={profile.id === profileId} onClick={() => navigate({ project: projectId, profile: profile.id })}><Monitor className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{profile.name}</span></button>
              {data?.channels.filter(channel => channel.profileId === profile.id && channel.enabled).map(channel => channelButton(channel, profile))}
              {data?.channels.some(channel => channel.profileId === profile.id && !channel.enabled) && <details open={activeChannel?.profileId === profile.id && !activeChannel.enabled} className="min-w-0"><summary className="cursor-pointer py-1 pl-6 text-xs text-muted-foreground">중지한 채널</summary>{data.channels.filter(channel => channel.profileId === profile.id && !channel.enabled).map(channel => channelButton(channel, profile))}</details>}
            </div>)}{!profiles.length && <p className="px-2 py-2 text-xs text-muted-foreground">연결된 프로필 없음</p>}</div>}
          </div>)}
        </nav>
        {!projects.isLoading && !projects.data?.length && <p className="text-sm text-muted-foreground">프로젝트가 없습니다.</p>}
        {!!projectId && <>
          <div aria-label="프로필과 채널 관리" className="flex flex-wrap items-center gap-1"><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => { setEditingProfile(undefined); setDialog("profile"); }}><Plus className="size-4" />프로필</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={!profiles.length || mutation.isPending}><Plus className="size-4" />채널</Button></DropdownMenuTrigger><DropdownMenuContent align="start">{Object.entries(marketingPlatformNames).map(([platform, name]) => <DropdownMenuItem key={platform} onSelect={() => { setEditingChannel(undefined); setNewChannelPlatform(platform as CreateMarketingChannel["platform"]); setDialog("channel"); }}>{name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
            {!!profileId && <Button variant="ghost" size="icon-sm" aria-label="브라우저 프로필 수정" title="프로필 수정" onClick={() => { setEditingProfile(profiles.find(profile => profile.id === profileId)); setDialog("profile"); }}><Monitor className="size-4" /></Button>}
            {!!channelId && <Button variant="ghost" size="icon-sm" aria-label="채널 설정 수정" title="채널 설정" onClick={() => { setEditingChannel(channels.find(channel => channel.id === channelId)); setDialog("channel"); }}><Pencil className="size-4" /></Button>}
          </div>
          <MarketingConnectionStatus key={`${company}:${projectId}:${profileId}`} company={company} projectId={projectId} channels={connectionChannels} />
          <MarketingPublicationStatus data={data} projectId={projectId} error={state.error?.message} />
        </>}
      </aside>
      <section aria-label="마케팅 운영실" className="min-w-0">
        {!projectId ? <p className="text-sm text-muted-foreground">선택된 프로젝트 없음</p> : <>
          <div className="marketing-post-workspace grid min-w-0">
            <section aria-label="등록된 글 목록" className="marketing-post-list min-w-0 space-y-4">
              <header className="space-y-1"><p className="break-words text-xs text-muted-foreground">{projects.data?.find(project => project.id === projectId)?.name} · {activeChannel?.name || "전체 채널"}</p><h2 className="text-sm font-semibold">등록된 글 <span className="text-muted-foreground">{drafts.length}</span></h2></header>
              <label className="flex items-center gap-2 text-xs text-muted-foreground"><input ref={selectAll} type="checkbox" aria-label="발행 가능한 글 전체 선택" checked={allSelected} disabled={!eligible.length || mutation.isPending || !!state.error} onChange={event => setSelected(event.target.checked ? eligible.map(draft => draft.id) : [])} />전체 선택</label>
              <div className="min-w-0">{drafts.map(draft => {
                const reason = publicationReason(draft);
                return <div key={draft.id} className="flex min-w-0 items-start gap-3 border-t border-border py-4">
                  <input className="mt-3 shrink-0" type="checkbox" aria-label={`발행 선택: ${draft.content.title || draft.topic}`} checked={selected.includes(draft.id)} disabled={!!reason && !selected.includes(draft.id) || mutation.isPending || !!state.error} onChange={event => setSelected(event.target.checked ? [...selected, draft.id] : selected.filter(id => id !== draft.id))} />
                  <button aria-label={`글 상세: ${draft.content.title || draft.topic}`} aria-pressed={draft.id === draftId} className="min-w-0 flex-1 space-y-2 rounded-md p-2 text-left text-sm aria-pressed:bg-accent hover:bg-accent" onClick={() => { const next = new URLSearchParams(params); next.set("draft", draft.id); setParams(next); }}>
                    <span className="block break-words font-medium">{draft.content.title || draft.topic}</span><span className="flex flex-wrap"><MarketingDraftAuthor draft={draft} /></span>
                    <span className="block break-words text-xs text-muted-foreground">{data?.channels.find(channel => channel.id === draft.channelId)?.name} · 첨부 {draft.content.media.length} · 버전 {draft.revision}</span>
                    <span className="block break-words text-xs text-muted-foreground">{draftStatus(draft)}</span>
                  </button>
                </div>;
              })}</div>
              {!state.isLoading && !drafts.length && <p className="text-sm text-muted-foreground">등록된 글 없음</p>}
            </section>
            <section aria-label="글 상세 영역" className="marketing-post-detail min-w-0 space-y-4">
              {!activeDraft ? <p className="text-sm text-muted-foreground">선택된 글 없음</p> : <>
                <MarketingDraftDetail draft={activeDraft} choices={media.error ? [] : media.data || []} channelName={data?.channels.find(channel => channel.id === activeDraft.channelId)?.name || ""} status={draftStatus(activeDraft)} />
                {publicationReason(activeDraft) && <p role="status" className="break-words text-xs text-muted-foreground">{publicationReason(activeDraft)}</p>}
                {!!draftJobs(activeDraft).length && <details className="min-w-0 border-t border-border pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">발행 기록 · {draftJobs(activeDraft).length}</summary>
                  <div className="space-y-3 pt-3">{draftJobs(activeDraft).map(job => <section key={job.id} aria-label={`발행 기록: ${job.id}`} className="min-w-0 space-y-2 border-b border-border pb-3">
                    <p className="text-xs">버전 {job.revision} · {statusNames[job.status]}</p>{job.lastError && <p className="break-words text-xs text-destructive">{job.lastError}</p>}{job.postedUrl && <a href={job.postedUrl} target="_blank" rel="noreferrer" className="break-all text-xs underline">게시물 보기</a>}
                    <div className="flex flex-wrap gap-2">{["publishing", "uncertain"].includes(job.status) ? <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => run(() => marketingApi.reconcile(company, job.id))}><SearchCheck className="size-4" />게시 여부 확인</Button> : <>
                      {job.status === "queued" && <Button size="sm" variant="outline" disabled={mutation.isPending || !!state.error} onClick={() => { if (window.confirm("승인된 이 작업만 Aside에 다시 요청하시겠습니까?")) void run(() => marketingApi.dispatch(company, projectId, [job.id])); }}><Send className="size-4" />대기 작업 요청</Button>}
                      {!!data?.profiles.find(row => row.id === job.profileId)?.blockedReason && data?.channels.find(row => row.id === job.channelId)?.platform === "naver_blog" && <Button size="sm" variant="outline" disabled={mutation.isPending || !!state.error} onClick={() => run(() => marketingApi.resumeProfile(company, job.profileId, job.channelId))}><Monitor className="size-4" />발행 차단 해제</Button>}
                      {job.evidence?.definitelyNotPosted === true && job.evidence?.terminal === true && ["failed", "auth_required"].includes(job.status) && <Button size="sm" variant="outline" disabled={mutation.isPending || !!data?.profiles.find(row => row.id === job.profileId)?.blockedReason} onClick={() => run(() => marketingApi.retry(company, job.id))}><RotateCcw className="size-4" />재시도 대기</Button>}
                      {["queued", "auth_required", "failed"].includes(job.status) && <Button size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => run(() => marketingApi.cancel(company, job.id))}><X className="size-4" />취소</Button>}
                    </>}</div>
                  </section>)}</div>
                </details>}
              </>}
            </section>
          </div>
          <footer className="sticky bottom-0 z-10 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background py-3">
            <div className="min-w-0 space-y-1"><p aria-live="polite" className="text-sm">{chosen.length}개 선택</p>{selectionBlocked && <p role="status" className="break-words text-xs text-destructive">{selected.length > 50 ? "한 번에 50개까지 발행할 수 있습니다." : "선택한 글의 발행 상태가 변경되었습니다. 선택을 다시 확인하십시오."}</p>}</div>
            <Button disabled={!chosen.length || selectionBlocked || mutation.isPending || !!state.error} onClick={openApproval}><Send className="size-4" />발행</Button>
          </footer>
        </>}
      </section>
    </div>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !mutation.isPending) setDialog(null); }}><DialogContent className="marketing-form-dialog overflow-y-auto"><DialogHeader><DialogTitle>{dialog === "profile" ? "브라우저 프로필" : dialog === "channel" ? "SNS 채널" : "발행 확인"}</DialogTitle></DialogHeader>{notice && <p role="alert" className="break-words text-sm text-destructive">{notice}</p>}
      {dialog === "profile" && (browserProfiles.error ? <p role="alert" className="text-sm text-destructive">{browserProfiles.error.message}</p> : browserProfiles.isLoading ? <p role="status" className="text-sm">연결된 브라우저 확인 중</p> : <ProfileForm key={editingProfile?.id || "new"} projectId={projectId} profile={editingProfile} available={browserProfiles.data?.filter(row => row.signedIn) || []} pending={mutation.isPending} onCancel={() => setDialog(null)} onSave={input => run(() => editingProfile ? marketingApi.updateProfile(company, editingProfile.id, { name: input.name, asideAccountId: input.asideAccountId, browserProfileName: input.browserProfileName }) : marketingApi.createProfile(company, input), true)} />)}
      {dialog === "channel" && <MarketingChannelForm key={editingChannel?.id || newChannelPlatform} initialPlatform={newChannelPlatform} projectId={projectId} profiles={profiles} channel={editingChannel} pending={mutation.isPending} onCancel={() => setDialog(null)} onSave={input => run(() => editingChannel ? marketingApi.updateChannel(company, editingChannel.id, { profileId: input.profileId, platform: input.platform, name: input.name, accountId: input.accountId, accountUrl: input.accountUrl, concept: input.concept, tone: input.tone, audience: input.audience, writingRules: input.writingRules }) : marketingApi.createChannel(company, input), true)} />}
      {dialog === "approval" && <div className="space-y-4">{reviewed.map(({ draft, channel, profile }) => <section key={draft.id} className="min-w-0 space-y-2 border-b border-border pb-3"><p className="break-words text-sm font-medium">{draft.content.title || draft.topic}</p><p className="break-words text-xs text-muted-foreground">{channel.name} · {marketingPlatformNames[channel.platform]} · {channel.accountId} · {profile.name} · 버전 {draft.revision}</p><p className="whitespace-pre-wrap break-words text-sm">{draft.content.body}</p>{draft.content.media.map(item => <p key={item.attachmentId} className="break-words text-xs text-muted-foreground">{media.data?.find(choice => choice.attachmentId === item.attachmentId)?.title || "첨부 자료"}{item.alt ? ` · ${item.alt}` : ""}</p>)}</section>)}
        {approvalChanged && <p role="alert" className="text-sm text-destructive">내용 또는 발행 대상이 변경되었습니다. 창을 닫고 다시 확인하십시오.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" disabled={mutation.isPending} onClick={() => setDialog(null)}>취소</Button><Button disabled={mutation.isPending || !!state.error || approvalChanged || !reviewed.length} onClick={() => run(approveSelected)}><Check className="size-4" />승인하고 Aside에 발행 요청</Button></div>
      </div>}
    </DialogContent></Dialog>
  </main>;
}
