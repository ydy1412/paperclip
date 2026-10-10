import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CloudDownload, Loader2, Search, Unplug, X } from "lucide-react";
import { useSearchParams } from "@/lib/router";
import { sourcingApi, type OrderSyncState, type SourcingAccount, type SourcingOrder, type SourcingOrderPage } from "../api/sourcing";
import { EmptyState } from "./EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { SourcingDispatch, canDispatch, canPrepare, dispatchLabels } from "./SourcingDispatch";

import { SourcingForwarders } from "./SourcingForwarders";

export const orderStates: Record<string, string> = { Unknown: "확인 필요", Paid: "신규 주문", Preparing: "상품준비중", Shipped: "배송 중 · 출고", InTransit: "배송 중 · 운송", Delivered: "배송 완료", Untracked: "추적 불가" };
const orderTabs = [["Paid", "신규 주문"], ["Preparing", "상품준비중"], ["Shipping", "배송 중"], ["Delivered", "배송 완료"], ["Unknown", "확인 필요"], ["Untracked", "추적 불가"], ["all", "전체 주문"]] as const;
function recentOrderDays(days: number) {
  const to = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: start.toISOString().slice(0, 10), to };
}
const syncLabels: Record<string, string> = { not_synced: "아직 동기화하지 않음", unknown: "이전 기록 · 새로고침 필요", queued: "조회 대기", running: "쿠팡 주문 조회 중", completed: "조회 완료", failed: "조회 실패 · 기존 주문 보존" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";
const money = (amount: number | null, currency: string | null) => amount !== null && currency ? `${amount.toLocaleString("ko-KR")} ${currency}` : "-";
const control = "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const iconButton = "inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input hover:bg-accent disabled:opacity-40";

export function SourcingOrders({ companyId, projectId }: { companyId: string; projectId: string }) {
  const cache = useQueryClient();
  const [forwarderOrder, setForwarderOrder] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [periodError, setPeriodError] = useState("");
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const [dispatchBatch, setDispatchBatch] = useState<{ pluginId: string; companyId: string; projectId: string; accountId: string; orders: SourcingOrder[]; prepare: boolean } | null>(null);
  const plugin = useQuery({ queryKey: ["sourcing-plugin", companyId], queryFn: sourcingApi.plugin, enabled: !!companyId, retry: false });
  const pluginId = plugin.data?.id;
  const accounts = useQuery({ queryKey: ["sourcing-accounts", companyId, projectId, pluginId],
    queryFn: () => sourcingApi.data<SourcingAccount[]>(pluginId!, companyId, projectId, "accounts"), enabled: !!pluginId && !!projectId, retry: false });
  const accountId = accounts.data?.find(account => account.id === params.get("account"))?.id ?? accounts.data?.[0]?.id ?? "";
  const account = accounts.data?.find(value => value.id === accountId);
  const rawState = params.get("state") ?? "";
  const state = ["Shipped", "InTransit"].includes(rawState) ? "Shipping" : rawState;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get("page"))) || 1));
  const q = params.get("q") ?? "";
  const shipmentId = params.get("item") ?? "";
  const selectionScope = JSON.stringify([companyId, projectId, accountId, state, q, page, from, to]);
  const selected = selection.scope === selectionScope ? selection.ids : [];
  useEffect(() => { setSelection({ scope: selectionScope, ids: [] }); }, [selectionScope]);
  const baseKey = ["sourcing-orders", companyId, projectId, accountId];
  const orders = useQuery({ queryKey: [...baseKey, state, q, page, from, to],
    queryFn: () => sourcingApi.data<SourcingOrderPage>(pluginId!, companyId, projectId, "orders", { accountId, ...(state ? { state } : {}), q, page, ...(from ? { from } : {}), ...(to ? { to } : {}) }), enabled: !!pluginId && !!accountId, retry: false });
  const statusKey = ["sourcing-sync", companyId, projectId, accountId];
  const status = useQuery({ queryKey: statusKey,
    queryFn: () => sourcingApi.data<OrderSyncState>(pluginId!, companyId, projectId, "sync-state", { accountId }), enabled: !!pluginId && !!accountId, retry: false,
    refetchInterval: query => ["queued", "running"].includes(query.state.data?.state ?? "") ? 5000 : false });
  const detail = useQuery({ queryKey: ["sourcing-order-detail", companyId, projectId, accountId, shipmentId],
    queryFn: () => sourcingApi.data<SourcingOrder>(pluginId!, companyId, projectId, "detail", { accountId, shipmentId }), enabled: !!pluginId && !!accountId && !!shipmentId, retry: false });
  const dispatchStatus = useQuery({ queryKey: ["sourcing-shipping-status", companyId, projectId, accountId, shipmentId],
    queryFn: () => sourcingApi.shipping(pluginId!, companyId, projectId, accountId, { operation: "status", shipmentId }),
    enabled: !!pluginId && !!accountId && !!shipmentId, retry: false });
  const sync = useMutation({
    mutationFn: async () => {
      const period = recentOrderDays(31);
      return sourcingApi.sync(pluginId!, companyId, projectId, accountId, period.from, period.to);
    }, onSuccess: value => cache.setQueryData(statusKey, value),
  });
  const busy = sync.isPending || ["queued", "running"].includes(status.data?.state ?? "");
  const prepare = state === "Paid";
  const canSelect = prepare ? canPrepare : canDispatch;
  const selectionName = prepare ? "상품준비중" : "발송";
  const selectAllLabel = prepare ? "현재 페이지 신규 주문 전체 선택" : "현재 페이지 상품준비중 주문 전체 선택";
  const actionLabel = prepare ? "선택 주문 상품준비중 처리" : "운송장 등록·발송";
  const eligible = (orders.data?.orders ?? []).filter(canSelect);
  const selectedOrders = eligible.filter(order => selected.includes(order.shipmentId));
  function shippingChanged() {
    void cache.invalidateQueries({ queryKey: ["sourcing-orders"] });
    void cache.invalidateQueries({ queryKey: ["sourcing-order-detail"] });
    void cache.invalidateQueries({ queryKey: ["sourcing-shipping-status"] });
  }
  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => {
    if (["completed", "failed"].includes(status.data?.state ?? "")) {
      void cache.invalidateQueries({ queryKey: baseKey });
      void cache.invalidateQueries({ queryKey: ["sourcing-order-detail", companyId, projectId, accountId] });
    }
  }, [status.data?.jobId, status.data?.state, cache, companyId, projectId, accountId]);

  function change(values: Record<string, string | null>, clearItem = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    if (clearItem) next.delete("item");
    setParams(next);
  }
  if (!projectId) return <EmptyState icon={Unplug} message="프로젝트 선택" />;
  if (plugin.isLoading || accounts.isLoading) return <p role="status" className="text-sm text-muted-foreground">주문 연결 조회 중</p>;
  if (!plugin.data) return <EmptyState icon={Unplug} message={plugin.error ? "플러그인 조회 실패" : "주문 데이터 미연결"} />;
  if (accounts.error) return <p role="alert" className="text-sm text-destructive">판매 계정 조회 실패 · 프로젝트 연결 확인 필요</p>;
  if (!accountId) return <EmptyState icon={Unplug} message="연결된 판매 계정 없음" />;
  return <section aria-label="주문 목록" className="min-w-0 space-y-4">
    {forwarderOrder && <SourcingForwarders key={`${companyId}:${projectId}:${forwarderOrder}`} companyId={companyId} projectId={projectId} orderId={forwarderOrder} onClose={() => setForwarderOrder(null)} />}
    {orders.data?.summary && <section aria-label="주문 통계" className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["주문 금액 합계", orders.data.summary.revenue.length ? orders.data.summary.revenue.map(r => money(r.amount, r.currency)).join(" / ") : "-"],
          ["전체 주문", `${orders.data.summary.totalOrders.toLocaleString("ko-KR")}건`],
          ["배송 완료", `${orders.data.summary.deliveredOrders.toLocaleString("ko-KR")}건`],
          ["배송 중", `${orders.data.summary.shippingOrders.toLocaleString("ko-KR")}건`]].map(([label, value]) =>
          <dl key={label} className="rounded-lg border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-lg font-semibold tabular-nums">{value}</dd></dl>)}
      </div>
      <p className="text-xs text-muted-foreground">선택 계정 · 조회 기간·검색 전체 기준 · 신규 {orders.data.summary.newOrders}건 · 상품준비중 {orders.data.summary.preparingOrders}건 · 주문 수량 {orders.data.summary.totalQuantity}개{orders.data.summary.unknownAmountOrders > 0 && ` · 금액 미확인 ${orders.data.summary.unknownAmountOrders}건 제외`}</p>
    </section>}
    <Tabs value={state || "all"} onValueChange={value => change({ state: value === "all" ? null : value, page: null })} className="min-w-0">
    <div className="min-w-0 overflow-x-auto border-b border-border pb-2">
      <TabsList variant="line" aria-label="주문 상태">
        {orderTabs.map(([value, label]) => <TabsTrigger key={value} value={value} title={value === "Preparing" ? "쿠팡 상품 준비 상태" : label} className="px-3">{label}</TabsTrigger>)}
      </TabsList>
    </div>
    <TabsContent value={state || "all"} className="space-y-4 pt-2">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <select className={`${control} max-w-full`} aria-label="판매 계정" value={accountId} onChange={event => change({ account: event.target.value, page: null })}>
        {accounts.data?.map(value => <option key={value.id} value={value.id}>{value.displayName}{value.enabled ? "" : " · 비활성"}</option>)}
      </select>
      <Popover open={periodOpen} onOpenChange={open => {
        setPeriodOpen(open);
        if (open) { const today = recentOrderDays(1).to; setDraftFrom(from || today); setDraftTo(to || today); setPeriodError(""); }
      }}>
        <PopoverTrigger asChild><button type="button" aria-label="조회 기간 선택" className={`${control} inline-flex max-w-full items-center gap-2 hover:bg-accent`}>
          <CalendarDays className="size-4 shrink-0" /><span className="min-w-0 truncate">{from && to ? `${from} ~ ${to}` : "조회 기간 · 전체"}</span><ChevronDown className="size-4 shrink-0" />
        </button></PopoverTrigger>
        <PopoverContent align="start" className="space-y-4">
          <div className="space-y-1"><h2 className="text-sm font-medium">조회 기간</h2><p className="text-xs text-muted-foreground">주문일 기준 · 한국 시간</p></div>
          <div className="flex flex-wrap gap-2">
            {[[1, "오늘"], [7, "최근 7일"], [30, "최근 30일"], [90, "최근 90일"]].map(([days, label]) => <button key={days} type="button" className={`${control} hover:bg-accent`} onClick={() => {
              change({ ...recentOrderDays(Number(days)), page: null }); setPeriodOpen(false);
            }}>{label}</button>)}
            <button type="button" className={`${control} hover:bg-accent`} onClick={() => { change({ from: null, to: null, page: null }); setPeriodOpen(false); }}>전체 기간</button>
          </div>
          <form className="space-y-3 border-t border-border pt-3" onSubmit={event => {
            event.preventDefault();
            if (!draftFrom || !draftTo || draftFrom > draftTo) { setPeriodError("시작일과 종료일을 올바른 순서로 선택해 주세요."); return; }
            change({ from: draftFrom, to: draftTo, page: null }); setPeriodOpen(false);
          }}>
            <label className="block space-y-1 text-xs text-muted-foreground">시작일<input type="date" aria-label="조회 시작일" required className={`${control} w-full text-foreground`} value={draftFrom} onChange={event => setDraftFrom(event.target.value)} /></label>
            <label className="block space-y-1 text-xs text-muted-foreground">종료일<input type="date" aria-label="조회 종료일" required className={`${control} w-full text-foreground`} value={draftTo} onChange={event => setDraftTo(event.target.value)} /></label>
            {periodError && <p role="alert" className="text-xs text-destructive">{periodError}</p>}
            <button type="submit" className="h-9 w-full rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">기간 적용</button>
          </form>
        </PopoverContent>
      </Popover>
      <form className="flex min-w-0 flex-1 gap-2" onSubmit={event => { event.preventDefault(); change({ q: search.trim(), page: null }); }}>
        <input aria-label="주문번호 검색" placeholder="주문번호·주문자·수령자·상품명 검색" maxLength={100} className={`${control} w-full`} value={search} onChange={event => setSearch(event.target.value)} />
        <button className={iconButton} aria-label="검색" title="검색"><Search className="size-4" /></button>
      </form>
      <button className={iconButton} aria-label="쿠팡 주문 새로고침" title="최근 31일 쿠팡 주문 새로고침" disabled={busy || !account?.enabled} onClick={() => sync.mutate()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <CloudDownload className="size-4" />}
      </button>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" role="status"><span>{syncLabels[status.data?.state ?? ""] ?? "동기화 상태 확인 중"}</span>{status.data?.finishedAt && <span>{date(status.data.finishedAt)}</span>}{orders.data && <span>{orders.data.total.toLocaleString("ko-KR")}건</span>}{from && to && <span>주문일 기준 · 한국 시간</span>}</div>
    {(orders.error || sync.error || status.error || status.data?.state === "failed") && <p role="alert" className="text-sm text-destructive">주문 조회에 문제가 있습니다. 기존 저장 주문을 표시합니다.{status.data?.errorCode ? ` (${status.data.errorCode})` : ""}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{selectedOrders.length ? `${selectedOrders.length}건 선택` : prepare ? "신규 주문을 선택해 상품준비중으로 변경하십시오." : "상품준비중 주문을 선택해 운송장 번호를 등록하십시오."} · 현재 페이지 최대 20건</p>
      <button type="button" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40" disabled={!selectedOrders.length || !account?.enabled || busy || orders.isFetching || !!orders.error}
        onClick={() => setDispatchBatch({ pluginId: pluginId!, companyId, projectId, accountId, orders: selectedOrders, prepare })}>{actionLabel}{selectedOrders.length > 0 ? ` (${selectedOrders.length})` : ""}</button>
    </div>
    <div className="grid min-w-0 gap-6 xl:grid-cols-3">
      <div className={`${shipmentId ? "hidden xl:block" : ""} min-w-0 xl:col-span-2`}>
        <div className="min-w-0 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">쿠팡 주문</caption>
          <thead><tr className="border-y border-border text-xs text-muted-foreground"><th scope="col" className="px-3 py-3"><Checkbox aria-label={selectAllLabel} disabled={!eligible.length || busy || orders.isFetching || !!orders.error || !account?.enabled}
            checked={selectedOrders.length > 0 && selectedOrders.length === eligible.length ? true : selectedOrders.length > 0 ? "indeterminate" : false}
            onCheckedChange={checked => setSelection({ scope: selectionScope, ids: checked ? eligible.map(order => order.shipmentId) : [] })} /></th>{["주문번호", "주문자 / 수령자", "상품명", "상태", "수량", "금액", "주문일", ...(state === "Preparing" ? ["배송대행지"] : [])].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{orders.data?.orders.map(order => <tr key={order.shipmentId} className={`cursor-pointer border-b border-border ${shipmentId === order.shipmentId ? "bg-accent" : "hover:bg-accent/50"}`} onClick={() => change({ item: order.shipmentId }, false)}>
            <td className="px-3 py-3" onClick={event => event.stopPropagation()}><Checkbox aria-label={`${order.orderId} ${selectionName} 선택`} title={canSelect(order) ? "처리할 주문 선택" : prepare ? "취소 대기가 없는 신규 주문만 변경할 수 있습니다." : "취소 대기가 없는 상품준비중 주문만 발송할 수 있습니다."}
              disabled={!canSelect(order) || busy || orders.isFetching || !!orders.error || !account?.enabled} checked={selected.includes(order.shipmentId) && canSelect(order)}
              onCheckedChange={checked => setSelection({ scope: selectionScope, ids: checked ? [...selected, order.shipmentId] : selected.filter(id => id !== order.shipmentId) })} /></td>
            <td className="px-3 py-3"><button type="button" className="break-all text-left font-medium text-foreground underline-offset-4 hover:underline">{order.orderId}</button><div className="mt-1 text-xs text-muted-foreground">{order.shipmentId}</div></td>
            <td className="min-w-28 px-3 py-3"><p>{order.buyerName || "-"}</p><p className="text-xs text-muted-foreground">{order.recipientName || "-"}</p></td>
            <td className="min-w-40 max-w-72 px-3 py-3"><p className="line-clamp-2">{order.items.map(item => item.productName || item.productId || item.itemId).join(" · ")}</p></td>
            <td className="whitespace-nowrap px-3 py-3"><span className={`inline-flex rounded px-2 py-1 text-xs ${["Shipped", "InTransit"].includes(order.state) ? "bg-warning/10 text-warning" : order.state === "Delivered" ? "bg-success/10 text-success" : "bg-accent text-foreground"}`}>{orderStates[order.state] ?? "확인 필요"}</span></td>
            <td className="px-3 py-3 tabular-nums">{order.quantity}</td><td className="whitespace-nowrap px-3 py-3 tabular-nums">{money(order.amount, order.currency)}</td><td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">{date(order.orderedAt)}</td>
            {state === "Preparing" && <td className="whitespace-nowrap px-3 py-3" onClick={event => event.stopPropagation()}><button type="button" className={`${control} hover:bg-accent`} aria-label={`${order.orderId} 배송대행지`} onClick={() => setForwarderOrder(order.orderId)}>배송대행지</button></td>}
          </tr>)}</tbody>
        </table></div>
        {orders.isLoading && <p role="status" className="py-8 text-sm text-muted-foreground">주문 조회 중</p>}
        {orders.data?.orders.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{q || state || from || to ? "조건에 맞는 저장 주문 없음" : status.data?.state === "not_synced" ? "저장된 주문 없음 · 쿠팡 조회 필요" : "저장된 주문 없음"}</p>}
        <div className="mt-3 flex items-center justify-end gap-3 text-xs text-muted-foreground"><button className={iconButton} aria-label="이전 페이지" title="이전 페이지" disabled={page <= 1 || orders.isFetching} onClick={() => change({ page: String(page - 1) })}><ChevronLeft className="size-4" /></button><span>{page} / {Math.max(1, Math.ceil((orders.data?.total ?? 0) / 20))}</span><button className={iconButton} aria-label="다음 페이지" title="다음 페이지" disabled={!orders.data || page * 20 >= orders.data.total || orders.isFetching} onClick={() => change({ page: String(page + 1) })}><ChevronRight className="size-4" /></button></div>
      </div>
      <aside aria-label="주문 상세" className={`${shipmentId ? "" : "hidden xl:block"} min-w-0 border-border xl:border-l xl:pl-6`}>
        {!shipmentId ? <p className="py-6 text-sm text-muted-foreground">선택한 주문 없음</p> : <>
          <header className="mb-4 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">주문 상세</h2><button className={iconButton} aria-label="주문 상세 닫기" title="주문 상세 닫기" onClick={() => change({ item: null }, false)}><ArrowLeft className="size-4 xl:hidden" /><X className="hidden size-4 xl:block" /></button></header>
          {detail.isLoading && <p role="status" className="text-sm text-muted-foreground">상세 조회 중</p>}{detail.error && <p role="alert" className="text-sm text-destructive">주문 상세 조회 실패</p>}
          {dispatchStatus.data?.ticket && <p role="status" className="mb-4 text-xs text-muted-foreground">최근 발송 처리 · {dispatchLabels[dispatchStatus.data.ticket.state]}</p>}
          {dispatchStatus.error && <p className="mb-4 text-xs text-muted-foreground">발송 처리 기록 조회 실패</p>}
          {detail.data && <div className="space-y-5 text-sm"><dl className="grid min-w-0 gap-2"><dt className="text-xs text-muted-foreground">주문번호</dt><dd className="break-all font-medium">{detail.data.orderId}</dd><dt className="text-xs text-muted-foreground">주문자</dt><dd>{detail.data.buyerName || "-"}</dd><dt className="text-xs text-muted-foreground">수령자</dt><dd>{detail.data.recipientName || "-"}</dd><dt className="text-xs text-muted-foreground">상태</dt><dd>{orderStates[detail.data.state] ?? "확인 필요"}</dd><dt className="text-xs text-muted-foreground">마지막 확인</dt><dd>{date(detail.data.observedAt)}</dd><dt className="text-xs text-muted-foreground">금액</dt><dd>{money(detail.data.amount, detail.data.currency)}</dd></dl>
            <section aria-label="주문 품목" className="space-y-3 border-t border-border pt-4"><h3 className="text-xs font-medium text-muted-foreground">품목 {detail.data.items.length}개</h3>{detail.data.items.map(item => <div key={item.itemId} className="space-y-1 border-b border-border pb-3"><p className="break-all font-medium">{item.productName || item.productId || item.itemId}</p><p className="break-all text-xs text-muted-foreground">옵션 {item.itemId}</p><p>수량 {item.quantity} · 취소 {item.cancelledQuantity} · 취소 대기 {item.pendingCancellationQuantity}</p><p>{money(item.orderPrice, item.currency)}</p></div>)}</section>
          </div>}
        </>}
      </aside>
    </div>
    </TabsContent>
    </Tabs>
    {dispatchBatch && <SourcingDispatch {...dispatchBatch} onChanged={shippingChanged} onClose={() => { setDispatchBatch(null); setSelection({ scope: "", ids: [] }); }}
      onPrepared={() => { setDispatchBatch(null); setSelection({ scope: "", ids: [] }); change({ state: "Preparing", page: null }); }} />}
  </section>;
}
