import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserRound, Copy, Pencil, Trash2, RotateCcw } from "lucide-react";
import { AGENT_ROLES, type AgentProfileDetail, type CreateAgentProfile } from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useNavigate } from "@/lib/router";
import { agentProfilesApi } from "../api/agentProfiles";
import { adaptersApi } from "../api/adapters";
import { agentsApi } from "../api/agents";
import { companySkillsApi } from "../api/companySkills";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";

const control = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const empty = (adapterType: string): CreateAgentProfile => ({ name: "", description: "", config: { role: "general", title: "", capabilities: "", instructions: "", adapterType, runnerProvider: "codex", model: "", skills: [] } });

export function AgentProfiles() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "에이전트 프로필" }]); }, [setBreadcrumbs]);
  if (!selectedCompanyId) return <p className="text-sm text-muted-foreground">회사를 선택해 주세요.</p>;
  return <Profiles key={selectedCompanyId} companyId={selectedCompanyId} />;
}
function Profiles({ companyId }: { companyId: string }) {
  const cache = useQueryClient(), navigate = useNavigate(), key = ["agent-profiles", companyId];
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false), [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CreateAgentProfile>(() => empty("codex_local"));
  const [baseVersion, setBaseVersion] = useState(0), [apply, setApply] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false), [hire, setHire] = useState(false);
  const [agentName, setAgentName] = useState(""), [reportsTo, setReportsTo] = useState("");
  const [importAgentId, setImportAgentId] = useState("");
  const [message, setMessage] = useState("");
  const list = useQuery({ queryKey: key, queryFn: () => agentProfilesApi.list(companyId) });
  const detail = useQuery({ queryKey: [...key, selected], queryFn: () => agentProfilesApi.get(companyId, selected!), enabled: !!selected,
    refetchInterval: query => query.state.data?.bindings.some(b => b.pendingVersion) ? 5000 : false });
  const adapters = useQuery({ queryKey: ["adapters"], queryFn: () => adaptersApi.list() });
  const skills = useQuery({ queryKey: ["profile-skills", companyId], queryFn: () => companySkillsApi.list(companyId) });
  const agents = useQuery({ queryKey: ["profile-agents", companyId], queryFn: () => agentsApi.list(companyId) });
  const models = useQuery({ queryKey: ["profile-models", companyId, draft.config.adapterType, draft.config.runnerProvider], queryFn: () => agentsApi.adapterModels(companyId, draft.config.adapterType, { provider: draft.config.runnerProvider }), enabled: editing && !!draft.config.adapterType });
  const profile = detail.data;
  const supported = adapters.data?.filter(a => a.loaded && !a.disabled && a.capabilities?.supportsInstructionsBundle);
  function begin(row?: AgentProfileDetail, duplicate = false) {
    setDraft(row ? { name: duplicate ? `${row.name} 복사` : row.name, description: row.description, config: structuredClone(row.config) } : empty(supported?.[0]?.type ?? "codex_local"));
    setBaseVersion(row?.version ?? 0); setCreating(!row || duplicate); setEditing(true); setApply(false); setMessage(""); save.reset();
  }
  async function refresh(row?: AgentProfileDetail) {
    if (row) { setSelected(row.id); cache.setQueryData([...key, row.id], row); }
    await cache.invalidateQueries({ queryKey: key });
  }
  const save = useMutation({ mutationFn: () => creating ? agentProfilesApi.create(companyId, draft) : agentProfilesApi.update(companyId, selected!, { ...draft, expectedVersion: baseVersion, applyToLinked: apply }),
    onSuccess: async row => { setEditing(false); setCreating(false); setMessage(apply ? "프로필을 저장했습니다. 작업 중인 에이전트는 작업이 끝난 뒤 반영됩니다." : "프로필을 저장했습니다."); await refresh(row); } });
  const remove = useMutation({ mutationFn: () => agentProfilesApi.remove(companyId, selected!, profile!.version), onSuccess: async () => { setSelected(null); setConfirmDelete(false); setMessage("프로필을 삭제했습니다. 기존 에이전트는 유지됩니다."); await refresh(); } });
  const restore = useMutation({ mutationFn: (version: number) => agentProfilesApi.restore(companyId, selected!, { expectedVersion: profile!.version, version, applyToLinked: apply }), onSuccess: async row => { setMessage("선택한 버전으로 복원했습니다."); await refresh(row); } });
  const importAgent = useMutation({ mutationFn: () => agentProfilesApi.fromAgent(companyId, importAgentId), onSuccess: async row => { setImportAgentId(""); setMessage("기존 에이전트의 역할과 지침을 프로필로 저장하고 연결했습니다."); await refresh(row); } });
  const pending = save.isPending || remove.isPending || restore.isPending || importAgent.isPending;
  const error = save.error ?? remove.error ?? restore.error ?? importAgent.error;
  const linked = profile?.linkedCount ?? 0;
  function setConfig<K extends keyof CreateAgentProfile["config"]>(field: K, value: CreateAgentProfile["config"][K]) { setDraft(d => ({ ...d, config: { ...d.config, [field]: value } })); }
  return <div className="space-y-4">
    <header className="flex items-start justify-between gap-4"><div><h1 className="text-xl font-semibold">에이전트 프로필</h1><p className="mt-1 text-sm text-muted-foreground">역할과 작업 방식을 저장하고 여러 에이전트에 함께 반영합니다.</p></div><Button disabled={pending || editing} onClick={() => begin()}><Plus className="size-4" />프로필 추가</Button></header>
    {message && <p role="status" className="text-sm">{message}</p>}
    <div className="flex flex-wrap items-center gap-2"><label className="text-sm" htmlFor="import-profile-agent">기존 에이전트에서 가져오기</label><select id="import-profile-agent" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={importAgentId} disabled={pending || editing} onChange={e => setImportAgentId(e.target.value)}><option value="">에이전트 선택</option>{agents.data?.filter(a => a.status !== "terminated").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><Button variant="outline" disabled={pending || editing || !importAgentId} onClick={() => importAgent.mutate()}>프로필로 저장</Button></div>
    {(list.error || error) && <p role="alert" className="text-sm text-destructive">{(list.error ?? error)?.message}</p>}
    {list.isLoading && <p role="status" className="text-sm text-muted-foreground">프로필을 불러오는 중입니다.</p>}
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section aria-label="프로필 목록" className="grid gap-3 sm:grid-cols-2">
        {list.data?.map(row => <button key={row.id} type="button" aria-pressed={selected === row.id} disabled={editing || pending} onClick={() => { setSelected(row.id); setApply(false); setMessage(""); }} className={`space-y-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent ${selected === row.id ? "border-primary bg-accent" : "border-border bg-card"}`}>
          <UserRound className="size-5 text-muted-foreground" /><h2 className="font-semibold">{row.name}</h2><p className="line-clamp-3 text-sm text-muted-foreground">{row.description || row.config.title || "핵심 역할 설명을 추가해 주세요."}</p><p className="text-xs text-muted-foreground">버전 {row.version} · 연결된 에이전트 {row.linkedCount}개</p>
        </button>)}
        {list.data?.length === 0 && <p className="col-span-full rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">저장된 프로필이 없습니다. 프로필을 추가해 역할과 지침을 저장해 주세요.</p>}
      </section>
      <aside aria-label="프로필 상세" className="min-w-0 space-y-5 rounded-lg border border-border bg-card p-5">
        {editing ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
          <h2 className="text-lg font-semibold">{creating ? "프로필 추가" : "프로필 수정"}</h2>
          <label className="block space-y-1 text-sm">프로필 이름<Input required maxLength={100} value={draft.name} disabled={pending} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="block space-y-1 text-sm">핵심 역할 설명<Input maxLength={300} value={draft.description} disabled={pending} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <label className="block space-y-1 text-sm">역할<select className={control} value={draft.config.role} disabled={pending} onChange={e => setConfig("role", e.target.value as typeof draft.config.role)}>{AGENT_ROLES.map(role => <option key={role} value={role}>{role}</option>)}</select></label>
          <label className="block space-y-1 text-sm">직책<Input maxLength={200} value={draft.config.title} disabled={pending} onChange={e => setConfig("title", e.target.value)} /></label>
          <label className="block space-y-1 text-sm">담당 업무<textarea className={control} rows={3} maxLength={4000} value={draft.config.capabilities} disabled={pending} onChange={e => setConfig("capabilities", e.target.value)} /></label>
          <label className="block space-y-1 text-sm">작업 지침<textarea className={`${control} font-mono`} rows={10} maxLength={200000} value={draft.config.instructions} disabled={pending} onChange={e => setConfig("instructions", e.target.value)} /></label>
          <label className="block space-y-1 text-sm">실행 방식<select className={control} required value={draft.config.adapterType} disabled={pending || !creating} onChange={e => { setConfig("adapterType", e.target.value); setConfig("model", ""); }}>
            {!supported?.some(a => a.type === draft.config.adapterType) && <option value={draft.config.adapterType}>{draft.config.adapterType}</option>}{supported?.map(a => <option key={a.type} value={a.type}>{a.label}</option>)}
          </select></label>
          {draft.config.adapterType === "paperclip_runner" && <label className="block space-y-1 text-sm">실행 제공자<select className={control} value={draft.config.runnerProvider} disabled={pending || !creating} onChange={e => setConfig("runnerProvider", e.target.value as typeof draft.config.runnerProvider)}>{["codex", "claude", "grok", "opencode"].map(provider => <option key={provider} value={provider}>{provider}</option>)}</select></label>}
          <label className="block space-y-1 text-sm">모델<Input list="profile-models" maxLength={200} placeholder="기본 모델 사용" value={draft.config.model} disabled={pending} onChange={e => setConfig("model", e.target.value)} /><datalist id="profile-models">{models.data?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist></label>
          <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">사용할 스킬</legend>{skills.error && <p role="alert" className="text-sm text-destructive">스킬을 불러오지 못했습니다.</p>}{skills.data?.map(skill => <label key={skill.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.config.skills.includes(skill.key)} disabled={pending} onChange={e => setConfig("skills", e.target.checked ? [...draft.config.skills, skill.key] : draft.config.skills.filter(k => k !== skill.key))} />{skill.name}</label>)}{skills.data?.length === 0 && <p className="text-sm text-muted-foreground">등록된 스킬이 없습니다.</p>}</fieldset>
          {!creating && linked > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={apply} disabled={pending} onChange={e => setApply(e.target.checked)} />연결된 에이전트 {linked}개에도 반영</label>}
          {!creating && <p className="text-xs text-muted-foreground">작업 중인 에이전트는 작업이 끝난 뒤 반영됩니다. 에이전트별로 따로 바꾼 설정은 유지합니다.</p>}
          <div className="flex justify-between gap-3"><Button variant="outline" type="button" disabled={pending} onClick={() => { setEditing(false); setCreating(false); save.reset(); }}>취소</Button><Button disabled={pending || !draft.name.trim()} type="submit">{save.isPending ? "저장 중…" : "저장"}</Button></div>
        </form> : profile ? <>
          <div className="space-y-2"><h2 className="text-lg font-semibold">{profile.name}</h2><p className="text-sm text-muted-foreground">{profile.description}</p><p className="text-xs text-muted-foreground">버전 {profile.version} · {profile.config.title || profile.config.role}</p></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { setAgentName(""); setReportsTo(""); setHire(true); }}>이 프로필로 에이전트 만들기</Button><Button variant="outline" size="sm" disabled={pending} onClick={() => begin(profile)}><Pencil className="size-4" />수정</Button><Button variant="outline" size="sm" disabled={pending} onClick={() => begin(profile, true)}><Copy className="size-4" />복사</Button><Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" />삭제</Button></div>
          <div className="space-y-2"><h3 className="text-sm font-semibold">담당 업무</h3><p className="whitespace-pre-wrap text-sm">{profile.config.capabilities || "등록된 업무 설명이 없습니다."}</p></div>
          <div className="space-y-2"><h3 className="text-sm font-semibold">작업 지침</h3><pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{profile.config.instructions || "등록된 지침이 없습니다."}</pre></div>
          <p className="text-sm">모델: {profile.config.model || "기본 모델"}</p><p className="text-sm">스킬: {profile.config.skills.map(k => skills.data?.find(s => s.key === k)?.name ?? k).join(", ") || "선택 없음"}</p>
          <section className="space-y-2"><h3 className="text-sm font-semibold">연결된 에이전트</h3>{profile.bindings.length === 0 && <p className="text-sm text-muted-foreground">이 프로필로 생성한 에이전트가 없습니다.</p>}{profile.bindings.map(b => <div key={b.agentId} className="rounded-md border border-border p-3 text-sm"><p>{b.name} · 적용 버전 {b.appliedVersion}{b.pendingVersion ? ` · 버전 ${b.pendingVersion} 반영 대기` : ""}</p>{b.overrides.length > 0 && <p className="mt-1 text-xs text-muted-foreground">개별 설정 유지: {b.overrides.join(", ")}</p>}{b.error && <p role="alert" className="mt-1 text-destructive">{b.error}</p>}</div>)}</section>
          <section className="space-y-2"><h3 className="text-sm font-semibold">버전 기록</h3>{linked > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={apply} onChange={e => setApply(e.target.checked)} />복원할 때 연결된 에이전트에도 반영</label>}{profile.versions.map(v => <div key={v.version} className="flex items-center justify-between gap-2 text-sm"><span>버전 {v.version} · {v.name}</span>{v.version !== profile.version && <Button variant="ghost" size="sm" disabled={pending} onClick={() => restore.mutate(v.version)}><RotateCcw className="size-4" />복원</Button>}</div>)}</section>
        </> : <p role={detail.error ? "alert" : "status"} className="text-sm text-muted-foreground">{detail.error ? detail.error.message : selected ? "프로필을 불러오는 중입니다." : "프로필 카드를 선택하면 상세 내용을 볼 수 있습니다."}</p>}
      </aside>
    </div>
    <Dialog open={confirmDelete} onOpenChange={value => { if (!pending) setConfirmDelete(value); }}><DialogContent><DialogHeader><DialogTitle>프로필 삭제</DialogTitle><DialogDescription>프로필과 연결을 삭제합니다. 이 프로필로 만든 에이전트와 개별 설정은 유지됩니다.</DialogDescription></DialogHeader><div className="flex justify-between gap-3"><Button variant="outline" disabled={pending} onClick={() => setConfirmDelete(false)}>취소</Button><Button variant="destructive" disabled={pending} onClick={() => remove.mutate()}>삭제</Button></div>{remove.error && <p role="alert" className="text-sm text-destructive">{remove.error.message}</p>}</DialogContent></Dialog>
    <Dialog open={hire} onOpenChange={setHire}><DialogContent><DialogHeader><DialogTitle>에이전트 만들기</DialogTitle><DialogDescription>{profile?.name} 프로필을 적용하고 연결 설정을 이어서 진행합니다.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!profile) return; const params = new URLSearchParams({ name: agentName.trim(), adapterType: profile.config.adapterType, profileId: profile.id, profileVersion: String(profile.version), runnerProvider: profile.config.runnerProvider, reportsTo }); navigate(`/agents/new?${params}`); }}><label className="block space-y-1 text-sm">에이전트 이름<Input required value={agentName} onChange={e => setAgentName(e.target.value)} /></label><label className="block space-y-1 text-sm">상위 에이전트<select className={control} value={reportsTo} onChange={e => setReportsTo(e.target.value)}><option value="">없음</option>{agents.data?.filter(a => a.status !== "terminated").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><div className="flex justify-between gap-3"><Button type="button" variant="outline" onClick={() => setHire(false)}>취소</Button><Button type="submit" disabled={!agentName.trim()}>연결 설정으로</Button></div></form></DialogContent></Dialog>
  </div>;
}
