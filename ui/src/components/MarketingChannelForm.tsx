import { useState, type FormEvent } from "react";
import type { MarketingChannel, MarketingProfile, CreateMarketingChannel } from "@paperclipai/shared";
import { createMarketingChannelSchema, marketingPlatformSchema } from "@paperclipai/shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export const marketingPlatformNames: Record<string, string> = {
  naver_blog: "네이버 블로그", threads: "Threads", x: "X", linkedin: "LinkedIn",
  instagram: "Instagram", youtube: "YouTube", tistory: "티스토리",
};
export function MarketingChannelForm({ projectId, profiles, channel, initialPlatform = "naver_blog", pending, onSave, onCancel }: {
  projectId: string; profiles: MarketingProfile[]; channel?: MarketingChannel;
  pending: boolean; onSave: (input: CreateMarketingChannel) => void; onCancel: () => void;
  initialPlatform?: CreateMarketingChannel["platform"];
}) {
  const [form, setForm] = useState<CreateMarketingChannel>(channel ? {
    projectId, profileId: channel.profileId, platform: channel.platform, name: channel.name,
    accountId: channel.accountId, accountUrl: channel.accountUrl, concept: channel.concept,
    tone: channel.tone, audience: channel.audience, writingRules: channel.writingRules,
  } : { projectId, profileId: profiles[0]?.id || "", platform: initialPlatform, name: marketingPlatformNames[initialPlatform], accountId: "", accountUrl: "", concept: "", tone: "", audience: "", writingRules: "" });
  const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent) {
    event.preventDefault(); const result = createMarketingChannelSchema.safeParse(form);
    if (!result.success) { setError(result.error.issues[0].message); return; }
    setError(null); onSave(result.data);
  }
  return <form onSubmit={submit} className="grid min-w-0 gap-4">
    <label className="grid gap-1 text-sm">브라우저 프로필<select aria-label="채널 브라우저 프로필" value={form.profileId} onChange={e => setForm({ ...form, profileId: e.target.value })} className="h-9 min-w-0 rounded-md border border-input bg-background px-2">{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.browserProfileName}</option>)}</select></label>
    <label className="grid gap-1 text-sm">SNS<select aria-label="SNS 플랫폼" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value as CreateMarketingChannel["platform"] })} className="h-9 min-w-0 rounded-md border border-input bg-background px-2">{marketingPlatformSchema.options.map(platform => <option key={platform} value={platform}>{marketingPlatformNames[platform]}</option>)}</select></label>
    {([ ["name", "채널 이름"], ["accountId", "SNS 계정 ID"], ["accountUrl", "SNS 계정 주소"], ["concept", "컨셉"], ["tone", "말투"], ["audience", "독자층"]] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm">{label}<Input aria-label={label} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} required={["name", "accountId", "accountUrl", "concept"].includes(key)} /></label>)}
    <label className="grid gap-1 text-sm">작성 규칙<Textarea aria-label="작성 규칙" value={form.writingRules} onChange={e => setForm({ ...form, writingRules: e.target.value })} /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>취소</Button><Button disabled={pending}>{pending ? "저장 중" : "저장"}</Button></div>
  </form>;
}
