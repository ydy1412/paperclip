import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StoreSettings } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { catalogErrorMessage } from "../lib/sourcing-catalog";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

const fieldClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";
type Store = StoreSettings["stores"][number];
export function SourcingStoreSettings({ companyId, projectId }: { companyId: string; projectId: string }) {
  const cache = useQueryClient(); const key = ["sourcing-store-settings", companyId, projectId];
  const data = useQuery({ queryKey: key, queryFn: () => sourcingCatalogApi.request<StoreSettings>(companyId, projectId, { operation: "settings" }),
    refetchInterval: query => query.state.data?.stores.some(s => s.importState === "running") ? 2000 : false, retry: false });
  const [dialog, setDialog] = useState<"business" | "store" | null>(null);
  const [editing, setEditing] = useState<Store | null>(null); const [name, setName] = useState(""); const [number, setNumber] = useState("");
  const [businessId, setBusinessId] = useState(""); const [providerId, setProviderId] = useState(""); const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState(""); const [enabled, setEnabled] = useState(true); const [error, setError] = useState("");
  const provider = data.data?.providers.find(p => p.id === providerId);
  const mutate = useMutation({ mutationFn: (input: Record<string, unknown>) => sourcingCatalogApi.request(companyId, projectId, input),
    onSuccess: async (_, input) => { if (["store", "business"].includes(String(input.operation))) { setDialog(null); setCredentials({}); } setError(""); await cache.invalidateQueries({ queryKey: key }); await cache.invalidateQueries({ queryKey: ["sourcing-catalog", companyId, projectId] }); },
    onError: e => setError(catalogErrorMessage(e)) });
  function openStore(store: Store | null, group = "") {
    setEditing(store); setName(store?.name ?? ""); setBusinessId(store?.businessId ?? group ?? ""); setProviderId(store?.provider ?? data.data?.providers[0]?.id ?? "");
    setCredentials({}); setTemplate(store?.templateProductId ?? ""); setEnabled(store?.enabled ?? true); setError(""); setDialog("store");
  }
  return <section aria-label="사업자 및 쇼핑몰 설정" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">사업자·쇼핑몰</h2><div className="flex gap-2">
      <Button variant="outline" onClick={() => { setName(""); setNumber(""); setError(""); setDialog("business"); }}>사업자 등록</Button>
      <Button disabled={!data.data?.businesses.length} onClick={() => openStore(null, data.data?.businesses[0]?.id)}>쇼핑몰 등록</Button>
      <Button variant="outline" onClick={() => data.refetch()}>새로고침</Button></div></div>
    {data.isLoading && <p className="text-sm text-muted-foreground">설정 조회 중</p>}
    {(error || data.error) && <p role="alert" className="text-sm text-destructive">{error || catalogErrorMessage(data.error)}</p>}
    {data.data && !data.data.businesses.length && <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">사업자를 등록한 다음 사업자별 쇼핑몰을 추가해 주세요.</p>}
    {data.data?.businesses.map(b => <section key={b.id} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">{b.name}</h3>{b.registrationNumber && <p className="text-xs text-muted-foreground">사업자번호 {b.registrationNumber}</p>}</div><Button variant="outline" size="sm" onClick={() => openStore(null, b.id)}>쇼핑몰 추가</Button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.data!.stores.filter(s => s.businessId === b.id).map(s => <article key={s.id} className="space-y-3 rounded-md border border-border p-3">
        <button type="button" className="w-full text-left" onClick={() => openStore(s)}><span className="block font-medium">{s.name}</span><span className="text-xs text-muted-foreground">{data.data!.providers.find(p => p.id === s.provider)?.name} · {s.enabled ? "사용 중" : "사용 중지"} · {s.hasCredentials ? "연결 정보 저장됨" : "연결 정보 필요"}</span></button>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => openStore(s)}>연결 정보</Button><Button size="sm" disabled={!s.enabled || !s.catalogSupported || mutate.isPending || s.importState === "running"} onClick={() => mutate.mutate({ operation: "import", storeId: s.id })}>{s.importState === "running" ? "가져오는 중" : s.importState === "failed" ? "가져오기 재개" : "쿠팡 상품 가져오기"}</Button></div>
        {!s.catalogSupported && <p className="text-xs text-muted-foreground">계정 등록 지원 · 상품 연동 준비 중</p>}
        {s.importState === "succeeded" && <p className="text-xs text-muted-foreground">상품 가져오기 완료</p>}{s.importError && <p className="text-xs text-destructive">{catalogErrorMessage(new Error(s.importError))}</p>}
      </article>)}</div>
      {!!data.data!.legacyAccounts.length && <label className="grid gap-1 text-sm">기존 판매 계정 연결<select aria-label={`${b.name} 기존 계정 연결`} className={fieldClass} value="" disabled={mutate.isPending} onChange={e => e.target.value && mutate.mutate({ operation: "attach", businessId: b.id, accountId: e.target.value })}><option value="">계정 선택</option>{data.data!.legacyAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>)}</select></label>}
    </section>)}
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !mutate.isPending) { setDialog(null); setCredentials({}); } }}><DialogContent className="max-h-screen overflow-y-auto"><DialogHeader><DialogTitle>{dialog === "business" ? "사업자 등록" : editing ? `${editing.name} 연결 정보` : "쇼핑몰 등록"}</DialogTitle><DialogDescription>{dialog === "business" ? "쇼핑몰을 묶어서 관리할 사업자를 등록합니다." : "비밀키는 암호화해서 저장하며 다시 표시하지 않습니다. 비워 두면 기존 값을 유지합니다."}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); mutate.mutate(dialog === "business" ? { operation: "business", name, registrationNumber: number } : { operation: "store", businessId, provider: providerId, name, credentials, templateProductId: template, enabled, ...(editing ? { storeId: editing.id, expectedRevision: editing.revision } : {}) }); }}>
        <label className="grid gap-1 text-sm">{dialog === "business" ? "사업자명" : "쇼핑몰 이름"}<input aria-label={dialog === "business" ? "사업자명" : "쇼핑몰 이름"} className={fieldClass} value={name} maxLength={120} required onChange={e => setName(e.target.value)} /></label>
        {dialog === "business" ? <label className="grid gap-1 text-sm">사업자번호 (선택)<input aria-label="사업자번호" className={fieldClass} value={number} maxLength={12} onChange={e => setNumber(e.target.value)} /></label> : <>
          <label className="grid gap-1 text-sm">사업자<select aria-label="사업자" className={fieldClass} value={businessId} required onChange={e => setBusinessId(e.target.value)}><option value="">선택</option>{data.data?.businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm">쇼핑몰 종류<select aria-label="쇼핑몰 종류" className={fieldClass} value={providerId} disabled={!!editing} required onChange={e => { setProviderId(e.target.value); setCredentials({}); }}>{data.data?.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {provider?.fields.map(f => <label key={f.key} className="grid gap-1 text-sm">{f.label}<input aria-label={f.label} className={fieldClass} type={f.secret ? "password" : "text"} autoComplete="off" required={f.required && !editing} maxLength={4096} value={credentials[f.key] ?? ""} placeholder={editing ? "변경할 때만 입력" : ""} onChange={e => setCredentials({ ...credentials, [f.key]: e.target.value })} /></label>)}
          {provider?.catalogSupported && <label className="grid gap-1 text-sm">배송 설정 기준 쿠팡 상품 ID (추가 등록용)<input aria-label="배송 설정 기준 상품 ID" className={fieldClass} value={template} inputMode="numeric" pattern="[0-9]*" maxLength={30} onChange={e => setTemplate(e.target.value)} /><span className="text-xs text-muted-foreground">이 쇼핑몰의 기존 상품에서 배송·반품 설정을 가져옵니다.</span></label>}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />사용</label>
          {!provider?.catalogSupported && <p className="text-sm text-muted-foreground">연결 정보 저장만 지원합니다. 상품 가져오기·업로드는 연동 구현 후 사용할 수 있습니다.</p>}
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={mutate.isPending}>{mutate.isPending ? "저장 중" : "저장"}</Button>
      </form></DialogContent></Dialog>
  </section>;
}
