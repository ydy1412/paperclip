import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Truck } from "lucide-react";
import { sourcingApi, type DispatchResult, type DispatchRequest, type SourcingOrder, type SourcingCarrier } from "../api/sourcing";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

function invoiceHint(carrier: SourcingCarrier) {
  const lengths = carrier.lengths.length ? `${carrier.lengths.join(", ")}자리` : "1~30자리";
  return `${carrier.format === "numeric" ? "숫자" : "숫자 또는 영문"} ${lengths}${carrier.trackingSupported ? "" : " · 배송 추적 불가"}`;
}
export const dispatchLabels: Record<string, string> = { Previewed: "발송 준비 완료", Sending: "처리 중 · 재발송 금지",
  Verified: "발송 완료", ReadbackPending: "접수됨 · 배송 확인 필요", OutcomeUnknown: "결과 확인 필요 · 재발송 금지",
  Partial: "일부 접수 · 확인 필요", Rejected: "접수 거절" };
const errors: Record<string, string> = { shipment_not_actionable: "상품준비중 상태가 바뀌었습니다.", invalid_shipment_item: "취소 대기 품목을 확인하십시오.",
  unsupported_carrier: "택배사가 비활성화됐거나 등록되지 않았습니다. 목록을 새로고침하십시오.", invalid_shipping_catalog: "택배사 설정을 확인하십시오.",
  order_not_preparable: "신규 주문 상태 또는 취소 대기 품목을 확인하십시오.", preparation_failed: "상품준비중 처리 결과를 확인하지 못했습니다.",
  invalid_invoice_input: "발송할 품목이 없습니다.", invalid_invoice_number: "운송장 번호 형식을 확인하십시오.",
  confirmation_changed: "주문 또는 입력 내용이 바뀌었습니다. 다시 확인하십시오.", confirmation_expired: "확인 시간이 지났습니다. 다시 확인하십시오.",
  confirmation_already_consumed: "이미 처리한 요청입니다. 처리 기록을 확인하십시오.", operation_requires_reconciliation: "이전 발송 결과를 먼저 확인하십시오.",
  account_operation_in_progress: "계정에서 다른 작업이 진행 중입니다.", account_changed_or_disabled: "판매 계정 설정이 바뀌었습니다.",
  account_disabled_or_unsupported: "사용할 수 없는 판매 계정입니다.", rate_limited: "쿠팡 요청 한도에 도달했습니다. 잠시 후 확인하십시오.",
  invalid_provider_response: "쿠팡 응답을 확인하지 못했습니다.", transport_failure: "쿠팡 통신 결과를 확인하지 못했습니다.",
  operation_timeout: "처리 시간이 초과되었습니다. 기록을 확인하십시오.", response_failure: "쿠팡 요청 결과를 확인하십시오.",
  credential_failure: "판매 계정 인증 설정을 확인하십시오.", authentication_failure: "쿠팡 인증을 확인하십시오.", permission_failure: "쿠팡 발송 권한을 확인하십시오.",
  INVALID_STATUS: "발송할 수 없는 주문 상태입니다.", DUPLICATE_INVOICE_NUMBER: "이미 등록된 운송장 번호입니다.",
  INVALID_INVOICE_NUMBER: "운송장 번호가 유효하지 않습니다.", ORDER_DELIVERY_CANCELED: "취소된 주문입니다.",
  ORDER_DELIVERY_PARTIAL_STOP_REQUESTED: "출고 중지 요청을 확인하십시오.", ORDER_DELIVERY_CANCELED_HOLDING_FOR_CANCEL: "취소 대기 주문입니다.",
  PERMISSION_DENIED: "쿠팡 발송 권한을 확인하십시오.", NOT_FOUND_VENDOR_ITEM: "묶음배송 품목을 확인하십시오." };
export function dispatchError(code: string) { return errors[code] ?? `처리 확인 필요 (${code})`; }

export function canDispatch(order: SourcingOrder) {
  return order.state === "Preparing" && order.items.some(item => item.quantity > item.cancelledQuantity)
    && order.items.every(item => item.pendingCancellationQuantity === 0);
}
export function canPrepare(order: SourcingOrder) {
  return order.state === "Paid" && order.items.some(item => item.quantity > item.cancelledQuantity)
    && order.items.every(item => item.pendingCancellationQuantity === 0);
}
const preparationLabels: Record<string, string> = { ...dispatchLabels, Previewed: "변경 준비 완료", Verified: "상품준비중 변경 완료",
  Sending: "변경 처리 중 · 재요청 금지", ReadbackPending: "접수됨 · 상태 확인 필요", OutcomeUnknown: "결과 확인 필요 · 재요청 금지" };

type Row = { order: SourcingOrder; invoice: string; result?: DispatchResult; progress?: string };
export function SourcingDispatch({ pluginId, companyId, projectId, accountId, orders, prepare = false, onClose, onChanged, onPrepared }: {
  pluginId: string; companyId: string; projectId: string; accountId: string; orders: SourcingOrder[];
  prepare?: boolean; onClose: () => void; onChanged: () => void; onPrepared?: () => void;
}) {
  const [carrierCode, setCarrierCode] = useState("");
  const [rows, setRows] = useState<Row[]>(() => orders.map(order => ({ order, invoice: "" })));
  const [stage, setStage] = useState<"input" | "review" | "result">("input");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const catalog = useQuery({ queryKey: ["sourcing-carriers", pluginId, companyId, projectId, accountId],
    queryFn: () => sourcingApi.data<SourcingCarrier[]>(pluginId, companyId, projectId, "carriers", { accountId }),
    enabled: !prepare, retry: false, staleTime: 0, refetchInterval: busy ? false : 5000, refetchOnWindowFocus: "always" });
  const carriers = catalog.data ?? [];
  const catalogReady = !catalog.isError && !catalog.isPending && carriers.length > 0;
  const carrier = carriers.find(value => value.code === carrierCode);
  const ready = rows.filter(row => !row.result?.errorCode && row.result?.ticket?.state === "Previewed");
  function update(id: string, patch: Partial<Row>) { setRows(previous => previous.map(row => row.order.shipmentId === id ? { ...row, ...patch } : row)); }
  async function request(row: Row, operation: "preview" | "dispatch"): Promise<DispatchResult> {
    const input: DispatchRequest = { operation: prepare ? operation === "preview" ? "prepare-preview" : "prepare" : operation,
      shipmentId: row.order.shipmentId, ...(!prepare ? { carrierCode, invoiceNumber: row.invoice } : {}),
      ...(operation === "dispatch" ? { confirmation: row.result!.ticket!.id } : {}) };
    try { return await sourcingApi.shipping(pluginId, companyId, projectId, accountId, input); }
    catch {
      // Recover exact ticket after a lost response; recovery is a read, never a second dispatch.
      try {
        const status = await sourcingApi.shipping(pluginId, companyId, projectId, accountId, { operation: prepare ? "prepare-status" : "status", shipmentId: row.order.shipmentId,
          ...(operation === "dispatch" ? { confirmation: row.result!.ticket!.id } : {}) });
        return { ...status, errorCode: status.ticket?.state === "Verified" ? null : "transport_failure" };
      } catch { return { ticket: operation === "dispatch" ? { ...row.result!.ticket!, state: "OutcomeUnknown" } : null, errorCode: "transport_failure" }; }
    }
  }
  async function run(operation: "preview" | "dispatch") {
    if (submitting.current) return;
    if (!prepare && !catalogReady) { setError("택배사 목록을 다시 조회하십시오."); return; }
    if (operation === "preview" && !prepare) {
      if (!carrier) { setError("택배사를 선택하십시오."); return; }
      const format = carrier.format === "numeric" ? /^\d{1,30}$/ : /^[a-zA-Z0-9]{1,30}$/;
      if (rows.some(row => !format.test(row.invoice) || carrier.lengths.length > 0 && !carrier.lengths.includes(row.invoice.length))) {
        setError(`${carrier.name} 운송장 번호를 ${invoiceHint(carrier)}로 주문마다 입력하십시오.`); return;
      }
    }
    const selected = operation === "preview" ? rows : ready;
    if (selected.length === 0) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      for (const row of selected) {
        update(row.order.shipmentId, { progress: operation === "preview" ? "주문 상태 확인 중" : prepare ? "상품준비중 변경 요청 중" : "발송 요청 중" });
        update(row.order.shipmentId, { result: await request(row, operation), progress: undefined });
      }
      setStage(operation === "preview" ? "review" : "result");
      onChanged();
    } finally { submitting.current = false; setBusy(false); }
  }
  async function checkResults() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      for (const row of rows.filter(value => value.result?.ticket)) {
        try {
          const result = await sourcingApi.shipping(pluginId, companyId, projectId, accountId, { operation: prepare ? "prepare-status" : "status",
            shipmentId: row.order.shipmentId, confirmation: row.result!.ticket!.id });
          update(row.order.shipmentId, { result });
        } catch { setError("처리 기록을 조회하지 못했습니다. 중복 요청하지 말고 다시 확인하십시오."); }
      }
      onChanged();
    } finally { submitting.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !submitting.current) onClose(); }}>
    <DialogContent className="max-h-(--sz-folder-sheet-max) overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}
      onEscapeKeyDown={event => { if (submitting.current) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()}>
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Truck className="size-5" />{prepare ? "선택 주문 상품준비중 처리" : "선택 주문 발송"} · {rows.length}건</DialogTitle>
        <DialogDescription>{prepare ? stage === "result" ? "주문별 상태 변경 결과를 확인하십시오." : "선택한 신규 주문을 확인한 뒤 상품준비중으로 변경하십시오." : stage === "input" ? "택배사를 선택하고 각 주문의 운송장 번호를 입력하십시오." : stage === "review" ? "아래 주문과 운송장 번호를 확인한 뒤 발송하십시오." : "주문별 발송 결과를 확인하십시오."}</DialogDescription></DialogHeader>
      {!prepare && <fieldset disabled={stage !== "input" || busy || !catalogReady} className="min-w-0 space-y-2"><legend className="mb-2 text-sm font-medium">택배사</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-3">{carriers.map(value => <label key={value.code} className="inline-flex items-center gap-2 text-sm">
          <input type="radio" name="dispatch-carrier" className="size-4 accent-primary" value={value.code} checked={carrierCode === value.code} onChange={() => setCarrierCode(value.code)} />{value.name}
        </label>)}</div>
        {catalog.isPending && <p role="status" className="text-xs text-muted-foreground">택배사 목록 불러오는 중</p>}
        {!catalog.isPending && !catalog.isError && carriers.length === 0 && <p role="status" className="text-xs text-muted-foreground">등록된 사용 가능한 택배사가 없습니다.</p>}
        {carrier && <p className="text-xs text-muted-foreground">{carrier.name} · {invoiceHint(carrier)}</p>}
      </fieldset>}
      {!prepare && <div className="flex flex-wrap items-center justify-between gap-2">
        {catalog.isError && <p role="alert" className="text-xs text-destructive">택배사 목록 조회에 실패했습니다. 다시 조회하십시오.</p>}
        <button type="button" disabled={busy || catalog.isFetching} className="ml-auto text-xs text-muted-foreground underline disabled:opacity-40"
          onClick={() => void catalog.refetch()}>택배사 목록 새로고침</button>
      </div>}
      <div className="space-y-3" aria-label="발송할 주문">{rows.map(row => <div key={row.order.shipmentId} className="space-y-2 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="break-all text-sm font-medium">주문 {row.order.orderId}</p><span className="text-xs text-muted-foreground">수량 {row.order.quantity}</span></div>
        <p className="break-all text-xs text-muted-foreground">배송번호 {row.order.shipmentId}</p>
        {!prepare && <label className="block space-y-1 text-xs text-muted-foreground">운송장 번호<input aria-label={`${row.order.orderId} 운송장 번호`} type="text" inputMode={carrier?.format === "alphanumeric" ? "text" : "numeric"} autoComplete="off" maxLength={30}
          placeholder={carrier?.format === "alphanumeric" ? "숫자 또는 영문 입력" : "숫자만 입력"} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:opacity-70" value={row.invoice} disabled={stage !== "input" || busy}
          onChange={event => update(row.order.shipmentId, { invoice: event.target.value.trim() })} /></label>}
        {(row.progress || row.result) && <div role="status" className={`space-y-1 text-xs ${row.result?.ticket?.state === "Verified" ? "text-success" : "text-muted-foreground"}`}>
          <p>{row.progress ?? (row.result?.ticket ? (prepare ? preparationLabels : dispatchLabels)[row.result.ticket.state] : prepare ? "변경 보류" : "발송 보류")}</p>
          {!row.progress && row.result?.errorCode && <p>{dispatchError(row.result.errorCode)}</p>}
          {!row.progress && row.result?.ticket?.results.filter(result => !result.succeeded).map((result, i) => <p key={i}>{dispatchError(result.code)}</p>)}
        </div>}
      </div>)}</div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {stage === "review" && <p className="text-xs text-muted-foreground">{ready.length}건 {prepare ? "변경" : "발송"} 가능 · 확인 후 15분 이내 처리 · 제외된 주문은 전송하지 않습니다.</p>}
      {stage === "result" && <p className="text-xs text-muted-foreground">결과 확인이 필요한 주문은 쿠팡 처리 기록을 확인하십시오. 이 화면은 자동으로 중복 요청하지 않습니다.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} className="h-9 rounded-md border border-input px-3 text-sm disabled:opacity-40" onClick={() => { if (!submitting.current) onClose(); }}>닫기</button>
        {prepare && stage === "result" && onPrepared && rows.some(row => row.result?.ticket?.state === "Verified") && <button type="button" disabled={busy}
          className="h-9 rounded-md border border-input px-3 text-sm disabled:opacity-40" onClick={onPrepared}>상품준비중 목록 보기</button>}
        {stage === "review" && <button type="button" disabled={busy} className="h-9 rounded-md border border-input px-3 text-sm disabled:opacity-40" onClick={() => { if (submitting.current) return; setStage("input"); setRows(previous => previous.map(row => ({ ...row, result: undefined }))); }}>내용 수정</button>}
        {stage === "result" ? <button type="button" disabled={busy} className="h-9 rounded-md border border-input px-3 text-sm disabled:opacity-40" onClick={() => void checkResults()}>처리 기록 확인</button> :
          <button type="button" disabled={busy || !prepare && (!catalogReady || !carrier) || stage === "review" && ready.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40" onClick={() => void run(stage === "input" ? "preview" : "dispatch")}>
            {busy && <Loader2 className="size-4 animate-spin" />}{busy ? "처리 중" : stage === "input" ? prepare ? "변경 내용 확인" : "발송 내용 확인" : prepare ? `확인한 ${ready.length}건 상품준비중 처리` : `확인한 ${ready.length}건 발송`}
          </button>}
      </div>
    </DialogContent>
  </Dialog>;
}
