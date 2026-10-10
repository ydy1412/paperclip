// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcingOrders } from "./SourcingOrders";

const mock = vi.hoisted(() => ({ data: vi.fn(), plugin: vi.fn(), sync: vi.fn(), shipping: vi.fn(), forwarders: vi.fn() }));
vi.mock("../api/sourcing", () => ({ sourcingApi: mock, sourcingForwardersApi: { list: mock.forwarders } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: { issuePrefix: "DOB" } }) }));
vi.mock("../hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: false }) }));
const row = { shipmentId: "123456789012345678", orderId: "28000008707838", state: "Shipped", orderedAt: "2026-10-05T12:00:00Z", observedAt: "2026-10-08T01:00:00Z", quantity: 2, amount: null, currency: null, items: [{ itemId: "3187044096", productId: null, quantity: 2, cancelledQuantity: 0, pendingCancellationQuantity: 0, orderPrice: null, currency: null }] };
function Location() { const location = useLocation(); return <output data-location>{location.search}</output>; }

describe("Native order workspace", () => {
  let root: Root, container: HTMLDivElement, cache: QueryClient;
  beforeEach(() => {
    mock.forwarders.mockResolvedValue([]);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mock.plugin.mockResolvedValue({ id: "plugin" });
    mock.sync.mockResolvedValue({ state: "queued", jobId: "job" });
    mock.shipping.mockResolvedValue({ ticket: null, errorCode: null });
    mock.data.mockImplementation(async (_plugin, _company, _project, key) => key === "accounts" ? [{ id: "seller", displayName: "Coupang", enabled: true }] : key === "carriers" ? [{ code: "CJGLS", name: "CJ대한통운", lengths: [10, 12], format: "numeric", trackingSupported: true }] : key === "orders" ? { orders: [row], total: 47, page: 1, pageSize: 20 } : key === "detail" ? row : { state: "completed", jobId: "before", finishedAt: "2026-10-08T01:00:00Z" });
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); cache.clear(); container.remove(); vi.restoreAllMocks(); });
  async function render(url = "/DOB/sourcing?view=orders&project=project") {
    await act(async () => root.render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={cache}><SourcingOrders companyId="company" projectId="project" /><Location /></QueryClientProvider></MemoryRouter>));
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  it("shows actual response names and full-scope summary rather than page totals", async () => {
    const original = mock.data.getMockImplementation();
    mock.data.mockImplementation(async (...args) => args[3] === "orders" ? { orders: [{ ...row, buyerName: "테스트 주문자", recipientName: "테스트 수령자", items: [{ ...row.items[0], productName: "테스트 상품" }] }], total: 47, page: 1, pageSize: 20,
      summary: { totalOrders: 47, totalQuantity: 60, newOrders: 3, preparingOrders: 4, shippingOrders: 30, deliveredOrders: 10, unknownAmountOrders: 1, revenue: [{ currency: "KRW", amount: 123000 }] } } : original?.(...args));
    await render();
    expect(container.querySelector("tbody")?.textContent).toContain("테스트 주문자");
    expect(container.querySelector("tbody")?.textContent).toContain("테스트 수령자");
    expect(container.querySelector("tbody")?.textContent).toContain("테스트 상품");
    const stats = container.querySelector('[aria-label="주문 통계"]')!;
    expect(stats.textContent).toContain("123,000 KRW"); expect(stats.textContent).toContain("47건");
    expect(stats.textContent).toContain("금액 미확인 1건 제외");
  });
  it("opens the Preparing order's scoped forwarder chooser without opening order details", async () => {
    const original = mock.data.getMockImplementation();
    mock.data.mockImplementation(async (...args) => args[3] === "orders"
      ? { orders: [{ ...row, state: "Preparing" }], total: 1, page: 1, pageSize: 20 }
      : original?.(...args));
    await render("/DOB/sourcing?view=orders&project=project&state=Preparing");
    expect(container.textContent).not.toContain("배송대행지 관리");
    await act(async () => (container.querySelector(`[aria-label="${row.orderId} 배송대행지"]`) as HTMLElement).click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(`주문 ${row.orderId}`);
    expect(mock.forwarders).toHaveBeenCalledWith("company", "project");
    expect(new URLSearchParams(container.querySelector("[data-location]")?.textContent ?? "").has("item")).toBe(false);
  });
  it("reads actual scoped plugin data without provider sync on page load", async () => {
    await render();
    expect(container.textContent).toContain(row.orderId);
    expect(container.textContent).toContain("배송 중 · 출고");
    expect(container.textContent).toContain("47건");
    expect(mock.data).toHaveBeenCalledWith("plugin", "company", "project", "orders", expect.objectContaining({ accountId: "seller", page: 1 }));
    expect(mock.sync).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("0 KRW");
    expect(container.textContent).not.toContain("취소하기");
  });
  it.each([
    "tbody tr",
    "tbody tr td:nth-child(2)",
    "tbody tr td:nth-child(3)",
    "tbody tr td:nth-child(4)",
    "tbody tr td:nth-child(5)",
    "tbody tr td:nth-child(2) button",
  ])("opens details from %s without losing the list context", async selector => {
    await render("/DOB/sourcing?view=orders&project=project&account=seller&state=Shipping&page=2&q=28000008707838");
    await act(async () => (container.querySelector(selector) as HTMLElement).click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const location = new URLSearchParams(container.querySelector("[data-location]")?.textContent ?? "");
    expect(Object.fromEntries(location)).toEqual({ view: "orders", project: "project", account: "seller", state: "Shipping", page: "2", q: row.orderId, item: row.shipmentId });
    expect(container.querySelector('[aria-label="주문 상세"]')?.textContent).toContain("3187044096");
    expect(mock.data).toHaveBeenCalledWith("plugin", "company", "project", "detail", { accountId: "seller", shipmentId: row.shipmentId });
    expect(mock.sync).not.toHaveBeenCalled();
    expect(container.querySelector("tbody tr td:nth-child(2) button")?.tagName).toBe("BUTTON");
  });
  it("opens stored item details using the string shipment ID and restores via URL", async () => {
    await render(`/DOB/sourcing?view=orders&project=project&item=${row.shipmentId}`);
    expect(container.querySelector('[aria-label="주문 상세"]')?.textContent).toContain("3187044096");
    expect(mock.data).toHaveBeenCalledWith("plugin", "company", "project", "detail", { accountId: "seller", shipmentId: row.shipmentId });
    await act(async () => (container.querySelector('[aria-label="주문 상세 닫기"]') as HTMLButtonElement).click());
    expect(container.querySelector("[data-location]")?.textContent).not.toContain("item=");
  });
  it("filters shipping and resets pagination/detail without losing project", async () => {
    await render("/DOB/sourcing?view=orders&project=project&page=2");
    const tab = Array.from(container.querySelectorAll('[role="tab"]')).find(tab => tab.textContent === "배송 중") as HTMLElement;
    await act(async () => tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    expect(container.querySelector("[data-location]")?.textContent).toContain("state=Shipping");
    expect(container.querySelector("[data-location]")?.textContent).toContain("project=project");
    expect(container.querySelector("[data-location]")?.textContent).not.toContain("page=2");
  });
  it("presents status tabs in operating order and preserves the selected period/search", async () => {
    await render("/DOB/sourcing?view=orders&project=project&state=Shipping&page=2&item=123&from=2026-10-01&to=2026-10-08&q=2026");
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map(tab => tab.textContent)).toEqual(["신규 주문", "상품준비중", "배송 중", "배송 완료", "확인 필요", "추적 불가", "전체 주문"]);
    expect(container.querySelector('select[aria-label="주문 상태"]')).toBeNull();
    await act(async () => tabs[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    const location = new URLSearchParams(container.querySelector("[data-location]")?.textContent ?? "");
    expect(location.get("state")).toBe("Paid");
    expect(location.get("from")).toBe("2026-10-01");
    expect(location.get("to")).toBe("2026-10-08");
    expect(location.get("q")).toBe("2026");
    expect(location.has("page")).toBe(false);
    expect(location.has("item")).toBe(false);
    expect(mock.sync).not.toHaveBeenCalled();
  });
  it("applies an inclusive seven-day Korean period before pagination without provider sync", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T16:00:00Z")); // Oct 9 in Korea.
    await render("/DOB/sourcing?view=orders&project=project&state=Shipping&page=2&item=123");
    await act(async () => (container.querySelector('[aria-label="조회 기간 선택"]') as HTMLElement).click());
    const button = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "최근 7일")!;
    await act(async () => button.click());
    const location = new URLSearchParams(container.querySelector("[data-location]")?.textContent ?? "");
    expect(location.get("from")).toBe("2026-10-03");
    expect(location.get("to")).toBe("2026-10-09");
    expect(location.get("state")).toBe("Shipping");
    expect(location.has("page")).toBe(false);
    expect(location.has("item")).toBe(false);
    expect(mock.data).toHaveBeenCalledWith("plugin", "company", "project", "orders", expect.objectContaining({ from: "2026-10-03", to: "2026-10-09", page: 1 }));
    expect(mock.sync).not.toHaveBeenCalled();
  });
  it("restores dates from a URL and retains them when paging or opening details", async () => {
    await render("/DOB/sourcing?view=orders&project=project&from=2026-10-01&to=2026-10-08");
    expect(container.querySelector('[aria-label="조회 기간 선택"]')?.textContent).toContain("2026-10-01 ~ 2026-10-08");
    await act(async () => (container.querySelector('[aria-label="다음 페이지"]') as HTMLElement).click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    await act(async () => (container.querySelector("tbody tr") as HTMLElement).click());
    const location = new URLSearchParams(container.querySelector("[data-location]")?.textContent ?? "");
    expect(location.get("from")).toBe("2026-10-01");
    expect(location.get("to")).toBe("2026-10-08");
    expect(location.get("page")).toBe("2");
    expect(location.get("item")).toBe(row.shipmentId);
  });
  it("rejects reversed custom dates and clears dates with All period", async () => {
    await render("/DOB/sourcing?view=orders&project=project&from=2026-10-01&to=2026-10-08&state=Shipping");
    await act(async () => (container.querySelector('[aria-label="조회 기간 선택"]') as HTMLElement).click());
    const input = document.querySelector('[aria-label="조회 시작일"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2026-10-09");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => document.querySelector('[data-slot="popover-content"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(document.querySelector('[data-slot="popover-content"] [role="alert"]')?.textContent).toContain("올바른 순서");
    expect(container.querySelector("[data-location]")?.textContent).toContain("from=2026-10-01");
    const all = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "전체 기간")!;
    await act(async () => all.click());
    const location = new URLSearchParams(container.querySelector("[data-location]")?.textContent ?? "");
    expect(location.has("from")).toBe(false);
    expect(location.has("to")).toBe(false);
    expect(location.get("state")).toBe("Shipping");
    expect(mock.sync).not.toHaveBeenCalled();
  });
  it("manual refresh queues background sync and disables repeat submission", async () => {
    await render();
    await act(async () => (container.querySelector('[aria-label="쿠팡 주문 새로고침"]') as HTMLButtonElement).click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mock.sync).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("조회 대기");
    expect((container.querySelector('[aria-label="쿠팡 주문 새로고침"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it("retains cached rows during a failed refetch instead of inventing an empty account", async () => {
    await render();
    mock.data.mockImplementation(async (_p, _c, _project, key) => { if (key === "orders") throw new Error("unavailable"); return []; });
    await act(async () => { await cache.invalidateQueries({ queryKey: ["sourcing-orders"] }); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(container.textContent).toContain(row.orderId);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("기존 저장 주문");
  });
  it("has an explicit missing-plugin state without fabricated order counts", async () => {
    mock.plugin.mockResolvedValue(null);
    await render();
    expect(container.textContent).toContain("주문 데이터 미연결");
    expect(mock.data).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("0건");
  });
  it("selects only eligible Preparing orders, supports page selection and clears with list scope", async () => {
    const pending = { ...row, orderId: "pending", shipmentId: "33", state: "Preparing", items: row.items.map(item => ({ ...item, pendingCancellationQuantity: 1 })) };
    const preparing = { ...row, state: "Preparing" };
    mock.data.mockImplementation(async (_p, _c, _pr, key) => key === "accounts" ? [{ id: "seller", displayName: "Coupang", enabled: true }] : key === "orders" ? { orders: [preparing, { ...preparing, orderId: "second", shipmentId: "22" }, pending, { ...row, orderId: "paid", shipmentId: "44", state: "Paid" }], total: 24, page: 1, pageSize: 20 } : { state: "not_synced" });
    await render();
    expect((container.querySelector('[aria-label="pending 발송 선택"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[aria-label="paid 발송 선택"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (container.querySelector(`[aria-label="${row.orderId} 발송 선택"]`) as HTMLElement).click());
    expect(container.querySelector("[data-location]")?.textContent).not.toContain("item=");
    expect(container.querySelector('[aria-label="현재 페이지 상품준비중 주문 전체 선택"]')?.getAttribute("data-state")).toBe("indeterminate");
    await act(async () => (container.querySelector('[aria-label="현재 페이지 상품준비중 주문 전체 선택"]') as HTMLElement).click());
    expect(container.textContent).toContain("운송장 등록·발송 (2)");
    await act(async () => (container.querySelector('[aria-label="다음 페이지"]') as HTMLElement).click());
    expect(container.textContent).not.toContain("2건 선택");
    expect(container.querySelector('[aria-label="현재 페이지 상품준비중 주문 전체 선택"]')?.getAttribute("data-state")).toBe("unchecked");
    await act(async () => (container.querySelector('[aria-label="이전 페이지"]') as HTMLElement).click());
    expect(container.textContent).not.toContain("2건 선택");
  });
  it("moves selected new orders through preparation results into the invoice registration list", async () => {
    let prepared = false;
    const paid = { ...row, state: "Paid" };
    const pending = { ...paid, orderId: "pending", shipmentId: "33", items: row.items.map(item => ({ ...item, pendingCancellationQuantity: 1 })) };
    mock.data.mockImplementation(async (_p, _c, _pr, key) => key === "accounts" ? [{ id: "seller", displayName: "Coupang", enabled: true }] : key === "carriers" ? [{ code: "CJGLS", name: "CJ대한통운", lengths: [10, 12], format: "numeric", trackingSupported: true }] : key === "orders" ? {
      orders: prepared ? [{ ...paid, state: "Preparing" }] : [paid, pending], total: prepared ? 1 : 2, page: 1, pageSize: 20
    } : { state: "not_synced" });
    mock.shipping.mockImplementation(async (_p, _c, _pr, _a, input) => {
      if (input.operation === "prepare") prepared = true;
      return { ticket: { id: "a".repeat(32), targetId: row.shipmentId, state: prepared ? "Verified" : "Previewed", expiresAt: "2026-10-09T01:00:00Z", readbackVerified: prepared, results: [] }, errorCode: null };
    });
    await render("/DOB/sourcing?view=orders&project=project&state=Paid");
    expect((container.querySelector('[aria-label="pending 상품준비중 선택"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (container.querySelector('[aria-label="현재 페이지 신규 주문 전체 선택"]') as HTMLElement).click());
    expect(container.textContent).toContain("선택 주문 상품준비중 처리 (1)");
    async function click(text: string) { await act(async () => Array.from(document.querySelectorAll("button")).find(button => button.textContent === text)!.click()); }
    await click("선택 주문 상품준비중 처리 (1)");
    expect(document.querySelector('[role="dialog"] input')).toBeNull();
    await click("변경 내용 확인"); await click("확인한 1건 상품준비중 처리");
    await click("상품준비중 목록 보기");
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(container.querySelector("[data-location]")?.textContent).toContain("state=Preparing");
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("상품준비중");
    await act(async () => (container.querySelector(`[aria-label="${row.orderId} 발송 선택"]`) as HTMLElement).click());
    await click("운송장 등록·발송 (1)");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelectorAll('[role="dialog"] input[type="radio"]')).toHaveLength(1);
    expect(document.querySelector(`[aria-label="${row.orderId} 운송장 번호"]`)).not.toBeNull();
    expect(mock.sync).not.toHaveBeenCalled();
  });

});
