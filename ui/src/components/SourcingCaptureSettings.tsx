import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sourcingCaptureApi } from "../api/sourcing";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function SourcingCaptureSettings({ companyId, projectId, projectName = "선택한 프로젝트" }: { companyId: string; projectId: string; projectName?: string }) {
  const cache = useQueryClient(), key = ["sourcing-capture-connections", companyId, projectId];
  const connections = useQuery({ queryKey: key, queryFn: () => sourcingCaptureApi.list(companyId, projectId), retry: false });
  const [name, setName] = useState("내 크롬"), [origin, setOrigin] = useState<string | null>(null);
  const [setup, setSetup] = useState(""), [error, setError] = useState(""), [copied, setCopied] = useState(false);
  const serverUrl = origin ?? connections.data?.serverUrl ?? "";
  const create = useMutation({ mutationFn: async () => {
    const url = new URL(serverUrl);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !(url.protocol === "https:" || url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("HTTPS 수집 서버 주소를 확인해 주세요.");
    const row = await sourcingCaptureApi.create(companyId, projectId, name.trim());
    setSetup(JSON.stringify({ serverUrl: url.origin, connectionId: row.id, token: row.token, projectName }, null, 2)); setCopied(false);
  }, onSuccess: () => { setError(""); void cache.invalidateQueries({ queryKey: key }); }, onError: e => setError(e instanceof Error ? e.message : "연결을 만들지 못했습니다.") });
  const revoke = useMutation({ mutationFn: (id: string) => sourcingCaptureApi.revoke(companyId, projectId, id),
    onSuccess: () => { setSetup(""); setError(""); void cache.invalidateQueries({ queryKey: key }); }, onError: () => setError("연결을 해제하지 못했습니다.") });
  return <section aria-label="크롬 상품 수집" className="space-y-4">
    <div><h2 className="text-lg font-semibold">크롬 상품 수집</h2><p className="text-sm text-muted-foreground">타오바오 상품 페이지에서 확장 버튼을 누르면 이 프로젝트의 가공 전 상품으로 보냅니다.</p></div>
    <form className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={e => { e.preventDefault(); setSetup(""); create.mutate(); }}>
      <label className="min-w-0 space-y-1 text-sm">연결 이름<Input value={name} onChange={e => setName(e.target.value)} required maxLength={100} /></label>
      <label className="min-w-0 space-y-1 text-sm sm:flex-1">수집 서버 주소<Input type="url" value={serverUrl} onChange={e => setOrigin(e.target.value)} placeholder="https://수집-서버-주소" required /></label>
      <Button disabled={create.isPending || !name.trim()}>연결 정보 만들기</Button>
    </form>
    {(error || connections.error) && <p role="alert" className="text-sm text-destructive">{error || "수집 연결을 조회하지 못했습니다."}</p>}
    {setup && <div className="space-y-2 rounded-md border border-border p-4"><label htmlFor="capture-setup" className="text-sm font-medium">확장의 연결 설정에 붙여넣으세요. 연결키는 이 화면에서만 표시됩니다.</label>
      <textarea id="capture-setup" readOnly value={setup} rows={7} className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs" />
      <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" onClick={() => setSetup("")}>연결 정보 닫기</Button><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(setup).then(() => setCopied(true), () => setError("연결 정보를 직접 선택해 복사해 주세요.")); }}>{copied ? "복사됨" : "연결 정보 복사"}</Button></div></div>}
    <ul className="space-y-2">{connections.data?.connections.filter(row => !row.revokedAt).map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
      <div><p className="text-sm font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{new Date(row.expiresAt).getTime() <= Date.now() ? "만료됨" : row.lastUsedAt ? `최근 수집 ${new Date(row.lastUsedAt).toLocaleString()}` : "아직 수집하지 않음"}</p></div>
      <Button variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(row.id)}>연결 해제</Button>
    </li>)}</ul>
    <p className="text-xs text-muted-foreground">확장을 처음 설치할 때 개발자 모드에서 제공된 폴더를 불러온 뒤 연결 정보를 붙여넣으세요. 이후에는 상품 페이지에서 확장 버튼만 누르면 됩니다.</p>
  </section>;
}
