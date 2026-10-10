import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import type { CreateSourcingForwarder, SourcingForwarder } from "@paperclipai/shared";
import { sourcingForwardersApi } from "../api/sourcing";
import { Link } from "@/lib/router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

const emptyForm = { providerId: "", loginId: "", password: "", enabled: true };
const inputClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const buttonClass = "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-accent disabled:opacity-50";

export function SourcingForwarders({ companyId, projectId, orderId, onClose }: { companyId: string; projectId: string; orderId?: string; onClose?: () => void }) {
  const cache = useQueryClient();
  const key = ["sourcing-forwarders", companyId, projectId];
  const rows = useQuery({ queryKey: key, queryFn: () => sourcingForwardersApi.list(companyId, projectId), retry: false });
  const providers = useQuery({ queryKey: [...key, "providers"], queryFn: () => sourcingForwardersApi.providers(companyId, projectId), retry: false, enabled: !orderId });
  const [editing, setEditing] = useState<SourcingForwarder | "new" | null>(null);
  const [form, setForm] = useState<CreateSourcingForwarder>({ ...emptyForm });
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  function edit(row?: SourcingForwarder) {
    setEditing(row ?? "new");
    setForm(row ? { providerId: row.providerId ?? "", enabled: row.enabled, loginId: "", password: "" } : { ...emptyForm, providerId: providers.data?.[0]?.id ?? "" });
    setFormError(""); setMessage("");
  }
  const save = useMutation({
    mutationFn: async () => {
      if (editing === "new") return sourcingForwardersApi.create(companyId, projectId, form);
      if (!editing) throw new Error("등록 항목을 선택해 주세요.");
      const { loginId, password, ...metadata } = form;
      return sourcingForwardersApi.update(companyId, projectId, editing.id, { ...metadata, ...(password ? { loginId, password } : {}) });
    },
    onSuccess: async () => { setForm({ ...emptyForm }); setEditing(null); setMessage("배송대행지를 저장했습니다."); await cache.invalidateQueries({ queryKey: key }); },
  });
  const open = useMutation({
    mutationFn: (id: string) => sourcingForwardersApi.open(companyId, projectId, id),
    onSuccess: result => setMessage(result.status === "login_submitted"
      ? "Chrome에서 저장한 계정으로 로그인 버튼을 눌렀습니다. 열린 창에서 로그인 결과를 확인해 주세요."
      : "Chrome에서 배송대행지 화면을 열었습니다. 열린 창에서 계속 진행해 주세요."),
  });
  const remove = useMutation({ mutationFn: (id: string) => sourcingForwardersApi.remove(companyId, projectId, id),
    onSuccess: async () => { setDeleteId(null); setMessage("배송대행지와 저장 계정을 삭제했습니다."); await cache.invalidateQueries({ queryKey: key }); } });
  const pending = save.isPending || open.isPending || remove.isPending;
  function resetActions() { save.reset(); open.reset(); remove.reset(); setMessage(""); }
  const content = <>
      <p className="text-xs text-muted-foreground">Chrome 창은 Dovix가 실행 중인 컴퓨터에 열립니다. 넥스트배송은 저장한 계정으로 로그인 버튼까지 누릅니다.</p>
      {rows.isLoading && <p role="status" className="text-sm text-muted-foreground">배송대행지 조회 중</p>}
      {rows.error && <p role="alert" className="text-sm text-destructive">배송대행지를 조회하지 못했습니다. <button type="button" className="underline" onClick={() => void rows.refetch()}>다시 조회</button></p>}
      {!editing && <div className="space-y-3">
        {rows.data?.length === 0 && <p className="py-4 text-sm text-muted-foreground">등록된 배송대행지가 없습니다.{orderId ? " 쇼핑몰 관리 설정에서 먼저 등록해 주세요." : " 먼저 계정을 등록해 주세요."}</p>}
        {rows.data?.map(row => <div key={row.id} className="space-y-2 rounded-md border border-border p-3">
          <div><p className="font-medium">{row.name}{row.enabled ? "" : " · 비활성"}</p></div>
          <p className="text-xs text-muted-foreground">{row.automaticLogin ? row.credentialConfigured ? "저장 계정으로 로그인" : "저장 계정 확인 필요 · 설정에서 다시 입력" : "로그인 페이지 열기 · 직접 로그인"}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={pending || !row.enabled || (row.automaticLogin && !row.credentialConfigured)} onClick={() => { resetActions(); open.mutate(row.id); }}><ExternalLink className="size-4" />{row.name} 열기{open.isPending && open.variables === row.id && <Loader2 className="size-4 animate-spin" />}</button>
            {!orderId && <>
              <button type="button" className={buttonClass} disabled={pending} aria-label={`${row.name} 수정`} onClick={() => { resetActions(); edit(row); }}>수정</button>
              <button type="button" className={`${buttonClass} text-destructive`} disabled={pending} aria-label={`${row.name} 삭제`} onClick={() => { resetActions(); setDeleteId(row.id); }}>삭제</button>
            </>}
          </div>
          {deleteId === row.id && <div className="space-y-2 border-t border-border pt-2"><p className="text-sm">이 배송대행지와 저장한 계정을 삭제할까요?</p><div className="flex gap-2"><button type="button" disabled={pending} className={`${buttonClass} text-destructive`} onClick={() => remove.mutate(row.id)}>삭제 확인</button><button type="button" disabled={pending} className={buttonClass} onClick={() => setDeleteId(null)}>취소</button></div></div>}
        </div>)}
        {!orderId && <button type="button" className={buttonClass} disabled={pending || rows.isLoading || !!rows.error} onClick={() => { resetActions(); setDeleteId(null); edit(); }}><Plus className="size-4" />배송대행지 추가</button>}
        {orderId && !pending && <Link className="inline-block text-sm text-muted-foreground underline hover:text-foreground" to={`/sourcing?view=settings&project=${encodeURIComponent(projectId)}`}>쇼핑몰 관리 설정</Link>}
      </div>}
      {editing && <form className="space-y-3" onSubmit={event => {
        event.preventDefault(); setFormError("");
        if (editing !== "new" && Boolean(form.loginId) !== Boolean(form.password)) { setFormError("계정을 바꾸려면 아이디와 비밀번호를 함께 입력해 주세요."); return; }
        save.mutate();
      }}>
        <h3 className="font-medium">{editing === "new" ? "배송대행지 추가" : "배송대행지 수정"}</h3>
        <label className="block space-y-1 text-sm">배송대행지<select className={inputClass} required value={form.providerId} disabled={pending || providers.isLoading} onChange={event => setForm({ ...form, providerId: event.target.value })}>
          <option value="">배송대행지 선택</option>{providers.data?.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </select></label>
        {providers.error && <p role="alert" className="text-sm text-destructive">배송대행지 목록을 불러오지 못했습니다. <button type="button" className="underline" onClick={() => void providers.refetch()}>다시 조회</button></p>}
        {providers.data?.length === 0 && <p className="text-sm text-muted-foreground">사용 가능한 배송대행지가 없습니다.</p>}
        <p className="text-xs text-muted-foreground">접속 주소는 선택한 배송대행지의 등록 정보로 자동 설정됩니다.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">로그인 아이디<input className={inputClass} autoComplete="off" required={editing === "new" || !!form.password} maxLength={200} value={form.loginId} disabled={pending} onChange={event => setForm({ ...form, loginId: event.target.value })} /></label>
        <label className="block space-y-1 text-sm">비밀번호<input className={inputClass} type="password" autoComplete="new-password" required={editing === "new" || !!form.loginId} maxLength={1000} value={form.password} disabled={pending} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
        </div>
        <p className="text-xs text-muted-foreground">아이디와 비밀번호는 암호화해 저장합니다.{editing !== "new" && " 두 칸을 비워 두면 저장한 계정을 유지합니다."}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} disabled={pending} onChange={event => setForm({ ...form, enabled: event.target.checked })} />사용</label>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <div className="flex flex-row-reverse justify-between gap-2"><button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50">{save.isPending && <Loader2 className="size-4 animate-spin" />}저장</button><button type="button" className={buttonClass} disabled={pending} onClick={() => { setEditing(null); setForm({ ...emptyForm }); save.reset(); }}>취소</button></div>
      </form>}
      {(save.error || open.error || remove.error) && <p role="alert" className="text-sm text-destructive">{(save.error ?? open.error ?? remove.error)?.message}</p>}
      {message && <p role="status" className="text-sm text-foreground">{message}</p>}
  </>;
  if (!orderId) return <section aria-label="배송대행지 관리" className="max-w-3xl space-y-4 rounded-lg border border-border p-4 sm:p-6">
    <header className="space-y-1"><h2 className="text-base font-semibold">배송대행지 관리</h2>
      <p className="text-sm text-muted-foreground">이 프로젝트에서 사용할 배송대행지와 로그인 계정을 등록합니다.</p>
    </header>
    {content}
  </section>;
  return <Dialog open onOpenChange={value => { if (!value && !pending) onClose?.(); }}>
    <DialogContent showCloseButton={!pending} className="max-h-(--sz-folder-sheet-max) overflow-y-auto sm:max-w-xl" onInteractOutside={event => { if (pending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>주문 배송대행지</DialogTitle>
        <DialogDescription>주문 {orderId} · 사용할 배송대행지를 선택해 주세요.</DialogDescription>
      </DialogHeader>
      {content}
    </DialogContent>
  </Dialog>;
}
