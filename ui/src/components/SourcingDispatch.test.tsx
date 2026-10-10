// @vitest-environment jsdom
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcingDispatch } from "./SourcingDispatch";
import type { SourcingOrder } from "../api/sourcing";
const shipping = vi.hoisted(() => vi.fn());
const data = vi.hoisted(() => vi.fn());
const catalog = [{ code: "CJGLS", name: "CJ대한통운", lengths: [10, 12], format: "numeric", trackingSupported: true }, { code: "HANJIN", name: "한진택배", lengths: [10, 12], format: "numeric", trackingSupported: true }];
vi.mock("../api/sourcing", () => ({ sourcingApi: { shipping, data } }));
const orders: SourcingOrder[] = ["123456789012345678", "123456789012345679"].map((shipmentId, i) => ({ shipmentId, orderId: String(28000008707838 + i), state: "Preparing", quantity: 1, amount: null, currency: null, observedAt: "2026-10-08T01:00:00Z", orderedAt: null, items: [{ itemId: "111", productId: null, quantity: 1, cancelledQuantity: 0, pendingCancellationQuantity: 0, unitPrice: null, orderPrice: null, currency: null }] }));
const ticket = (id: string, state = "Previewed") => ({ ticket: { id: id.padStart(32, "a"), targetId: orders[0].shipmentId, state, expiresAt: "2026-10-08T02:00:00Z", readbackVerified: state === "Verified", results: [] }, errorCode: null });
describe("Operator dispatch dialog", () => {
  let cache: QueryClient, root: Root, container: HTMLDivElement, changed: ReturnType<typeof vi.fn<() => void>>, closed: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    shipping.mockReset(); data.mockReset(); data.mockResolvedValue(catalog);
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); changed = vi.fn(); closed = vi.fn();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<QueryClientProvider client={cache}><SourcingDispatch pluginId="plugin" companyId="company" projectId="project" accountId="seller" orders={orders} onChanged={changed} onClose={closed} /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  });
  afterEach(() => { act(() => root.unmount()); cache.clear(); container.remove(); });
  async function click(text: string) { await act(async () => Array.from(document.querySelectorAll("button")).find(button => button.textContent === text)!.click()); }
  async function fill(index: number, value: string) {
    const input = document.querySelector(`[aria-label="${orders[index].orderId} 운송장 번호"]`) as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  async function validInput() {
    await act(async () => (document.querySelector('input[type="radio"][value="CJGLS"]') as HTMLInputElement).click());
    await fill(0, "001234567890"); await fill(1, "001234567891");
  }
  async function prepareDialog() {
    await act(async () => root.render(<QueryClientProvider client={cache}><SourcingDispatch key="prepare" prepare pluginId="plugin" companyId="company" projectId="project" accountId="seller"
      orders={orders.map(order => ({ ...order, state: "Paid" }))} onChanged={changed} onClose={closed} /></QueryClientProvider>));
  }
  it("reads scoped catalog options and accepts a newly added alphanumeric courier without a code list", async () => {
    expect(data).toHaveBeenCalledWith("plugin", "company", "project", "carriers", { accountId: "seller" });
    data.mockResolvedValue([...catalog, { code: "CUSTOM", name: "DB 새 택배사", lengths: [13], format: "alphanumeric", trackingSupported: false }]);
    await click("택배사 목록 새로고침");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    await act(async () => (document.querySelector('input[value="CUSTOM"]') as HTMLInputElement).click());
    expect(document.body.textContent).toContain("배송 추적 불가");
    expect(document.querySelector('[aria-label$="운송장 번호"]')?.getAttribute("inputmode")).toBe("text");
    await fill(0, "AB00123456789"); await fill(1, "CD00123456789");
    shipping.mockResolvedValue(ticket("1"));
    await click("발송 내용 확인");
    expect(shipping).toHaveBeenNthCalledWith(1, "plugin", "company", "project", "seller", {
      operation: "preview", shipmentId: orders[0].shipmentId, carrierCode: "CUSTOM", invoiceNumber: "AB00123456789" });
  });
  it("removes disabled catalog options and blocks cached choices when a refresh fails", async () => {
    await validInput();
    data.mockResolvedValue([catalog[1]]);
    await click("택배사 목록 새로고침");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('input[value="CJGLS"]')).toBeNull();
    expect(Array.from(document.querySelectorAll("button")).find(button => button.textContent === "발송 내용 확인")?.disabled).toBe(true);
    await act(async () => (document.querySelector('input[value="HANJIN"]') as HTMLInputElement).click());
    data.mockRejectedValue(new Error("unavailable"));
    await click("택배사 목록 새로고침");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("택배사 목록 조회에 실패");
    expect(document.querySelector('input[value="HANJIN"]')?.matches(":disabled")).toBe(true);
    await click("발송 내용 확인"); expect(shipping).not.toHaveBeenCalled();
  });
  it("prepares reviewed new orders without courier or invoice fields and excludes rejected rows", async () => {
    await prepareDialog();
    expect(document.querySelectorAll('input')).toHaveLength(0);
    shipping.mockImplementation(async (_p, _c, _pr, _a, input) => input.operation === "prepare" ? ticket("1", "Verified") :
      input.shipmentId === orders[0].shipmentId ? ticket("1") : { ticket: null, errorCode: "order_not_preparable" });
    await click("변경 내용 확인");
    expect(shipping).toHaveBeenCalledTimes(2);
    expect(shipping).toHaveBeenNthCalledWith(1, "plugin", "company", "project", "seller", { operation: "prepare-preview", shipmentId: orders[0].shipmentId });
    expect(document.body.textContent).toContain("신규 주문 상태 또는 취소 대기");
    await click("확인한 1건 상품준비중 처리");
    expect(shipping).toHaveBeenCalledTimes(3);
    expect(shipping).toHaveBeenLastCalledWith("plugin", "company", "project", "seller", { operation: "prepare", shipmentId: orders[0].shipmentId, confirmation: "1".padStart(32, "a") });
    expect(document.body.textContent).toContain("상품준비중 변경 완료");
    expect(document.body.textContent).toContain("변경 보류");
  });
  it("recovers lost preparation responses through prepare-status without repeating a mutation", async () => {
    await prepareDialog();
    shipping.mockImplementation(async (_p, _c, _pr, _a, input) => {
      if (input.operation === "prepare-preview") return ticket(input.shipmentId.endsWith("8") ? "1" : "2");
      if (input.operation === "prepare") throw new Error("lost response");
      return ticket("1", "OutcomeUnknown");
    });
    await click("변경 내용 확인"); await click("확인한 2건 상품준비중 처리");
    expect(shipping.mock.calls.filter(call => call[4].operation === "prepare")).toHaveLength(2);
    expect(shipping.mock.calls.filter(call => call[4].operation === "prepare-status")).toHaveLength(2);
    expect(document.body.textContent).toContain("결과 확인 필요 · 재요청 금지");
    await click("처리 기록 확인");
    expect(shipping.mock.calls.filter(call => call[4].operation === "prepare")).toHaveLength(2);
  });
  it("requires radio selection and a valid independent invoice for every selected order before any request", async () => {
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(Array.from(document.querySelectorAll("button")).find(button => button.textContent === "발송 내용 확인")?.disabled).toBe(true);
    await act(async () => (document.querySelector('input[value="CJGLS"]') as HTMLInputElement).click());
    await fill(0, "001234567890"); await fill(1, "123");
    await click("발송 내용 확인"); expect(document.querySelector('[role="alert"]')?.textContent).toContain("주문마다");
    expect(shipping).not.toHaveBeenCalled();
  });
  it("reviews each order without shipping then sends only explicitly confirmed eligible rows", async () => {
    shipping.mockImplementation(async (_p, _c, _pr, _a, input) => input.operation === "dispatch" ? ticket("1", "Verified") : input.shipmentId === orders[0].shipmentId ? ticket("1") : { ticket: null, errorCode: "invalid_shipment_item" });
    await validInput(); await click("발송 내용 확인");
    expect(shipping).toHaveBeenCalledTimes(2);
    expect(shipping).toHaveBeenNthCalledWith(1, "plugin", "company", "project", "seller", { operation: "preview", shipmentId: orders[0].shipmentId, carrierCode: "CJGLS", invoiceNumber: "001234567890" });
    expect(document.body.textContent).toContain("취소 대기 품목");
    expect(document.body.textContent).toContain("확인한 1건 발송");
    await click("확인한 1건 발송");
    expect(shipping).toHaveBeenCalledTimes(3);
    expect(shipping).toHaveBeenLastCalledWith("plugin", "company", "project", "seller", { operation: "dispatch", shipmentId: orders[0].shipmentId, carrierCode: "CJGLS", invoiceNumber: "001234567890", confirmation: "1".padStart(32, "a") });
    expect(document.body.textContent).toContain("발송 완료");
    expect(document.body.textContent).toContain("발송 보류");
    expect(Array.from(document.querySelectorAll("button")).some(button => button.textContent?.startsWith("확인한"))).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("recovers lost write responses using status only and preserves partial successes", async () => {
    shipping.mockImplementation(async (_p, _c, _pr, _a, input) => {
      if (input.operation === "preview") return ticket(input.shipmentId.endsWith("8") ? "1" : "2");
      if (input.operation === "dispatch") { if (input.shipmentId === orders[0].shipmentId) throw new Error("lost"); return ticket("2", "Verified"); }
      return ticket("1", "OutcomeUnknown");
    });
    await validInput(); await click("발송 내용 확인"); await click("확인한 2건 발송");
    expect(shipping.mock.calls.filter(call => call[4].operation === "dispatch")).toHaveLength(2);
    expect(shipping.mock.calls.filter(call => call[4].operation === "status")).toHaveLength(1);
    expect(document.body.textContent).toContain("결과 확인 필요 · 재발송 금지");
    expect(document.body.textContent).toContain("발송 완료");
    await click("처리 기록 확인");
    expect(shipping.mock.calls.filter(call => call[4].operation === "dispatch")).toHaveLength(2);
  });
  it("locks inputs and duplicate submission while reviewing", async () => {
    let finish!: (value: unknown) => void;
    shipping.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await validInput();
    const button = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "발송 내용 확인")!;
    await act(async () => { button.click(); button.click(); });
    expect(shipping).toHaveBeenCalledTimes(1); expect(button.disabled).toBe(true);
    expect(document.querySelector('input[type="radio"]')!.matches(":disabled")).toBe(true);
    expect((document.querySelector('[aria-label$="운송장 번호"]') as HTMLInputElement).disabled).toBe(true);
    await act(async () => finish(ticket("1")));
    await act(async () => finish(ticket("2")));
  });
});
