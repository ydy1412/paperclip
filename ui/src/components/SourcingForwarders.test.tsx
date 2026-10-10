// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SourcingForwarders } from "./SourcingForwarders";

const mock = vi.hoisted(() => ({ list: vi.fn(), providers: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), open: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: { issuePrefix: "DOB" } }) }));
vi.mock("../hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: false }) }));
vi.mock("../api/sourcing", () => ({ sourcingForwardersApi: mock }));
const row = { providerId: "provider", id: "forwarder", companyId: "company", projectId: "project", name: "넥스트배송", homepageUrl: "https://www.next1688.com/", loginUrl: "https://www.next1688.com/Front/Join/Login.asp?gMnu1=207&gMnu2=20702", enabled: true, credentialConfigured: true, automaticLogin: true };
describe("shipping forwarder registration and browser action", () => {
  let root: Root, container: HTMLDivElement, cache: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks(); mock.providers.mockResolvedValue([{ id: "provider", name: "넥스트배송", homepageUrl: row.homepageUrl, loginUrl: row.loginUrl }, { id: "other-provider", name: "다른 배송대행지", homepageUrl: "https://example.com/", loginUrl: "https://example.com/login" }]); mock.list.mockResolvedValue([row]); mock.create.mockResolvedValue(row); mock.update.mockResolvedValue(row); mock.open.mockResolvedValue({ status: "login_submitted", browser: "chrome" });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });
  afterEach(() => { act(() => root.unmount()); cache.clear(); container.remove(); });
  async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
  async function render(orderId?: string) { await act(async () => root.render(<MemoryRouter><QueryClientProvider client={cache}><SourcingForwarders companyId="company" projectId="project" orderId={orderId} onClose={vi.fn()} /></QueryClientProvider></MemoryRouter>)); await settle(); }
  async function click(text: string) { await act(async () => Array.from(document.querySelectorAll("button")).find(el => el.textContent === text)!.click()); await settle(); }
  async function fill(label: string, value: string) {
    const input = Array.from(document.querySelectorAll("label")).find(el => el.textContent === label)!.querySelector("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  it("registers synthetic credentials through the scoped API, clears password fields after saving and reloads metadata", async () => {
    mock.list.mockResolvedValueOnce([]); await render(); await click("배송대행지 추가");
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    await fill("로그인 아이디", "synthetic-id"); await fill("비밀번호", "synthetic-password");
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(mock.create).toHaveBeenCalledWith("company", "project", expect.objectContaining({ providerId: "provider", loginId: "synthetic-id", password: "synthetic-password" }));
    expect(document.querySelector('input[type="password"]')).toBeNull(); expect(document.body.textContent).toContain("배송대행지를 저장했습니다."); expect(mock.list).toHaveBeenCalledTimes(2);
  });
  it("requests Chrome login without putting credentials into links or claiming account access", async () => {
    await render(); await click("넥스트배송 열기"); expect(mock.open).toHaveBeenCalledWith("company", "project", row.id);
    expect(document.body.textContent).toContain("로그인 버튼을 눌렀습니다"); expect(document.body.textContent).toContain("로그인 결과를 확인"); expect(document.body.textContent).not.toContain("로그인 성공");
  });
  it("keeps the stored account on blank edits and blocks partial credential replacement", async () => {
    await render(); await click("수정"); await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(mock.update).toHaveBeenCalledWith("company", "project", row.id, { providerId: row.providerId, enabled: true });
    await click("수정"); await fill("로그인 아이디", "replacement-only"); await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(mock.update).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain("아이디와 비밀번호를 함께");
  });
  it("reports browser failures and disables opening inactive forwarders", async () => {
    mock.open.mockRejectedValueOnce(new Error("Chrome 설치를 확인해 주세요.")); await render(); await click("넥스트배송 열기"); expect(document.body.textContent).toContain("Chrome 설치를 확인");
    mock.list.mockResolvedValue([{ ...row, enabled: false }]); await act(async () => { await cache.invalidateQueries(); }); await settle();
    expect(Array.from(document.querySelectorAll("button")).find(el => el.textContent === "넥스트배송 열기")!.disabled).toBe(true);
  });
  it("keeps administration in settings and shows only opening and the settings link in the order chooser", async () => {
    await render("fixture-order");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("넥스트배송 열기");
    expect(document.body.textContent).not.toContain("배송대행지 추가");
    expect(document.body.textContent).not.toContain("수정");
    expect(document.body.textContent).not.toContain("삭제");
    expect(document.querySelector('a')?.getAttribute('href')).toBe("/DOB/sourcing?view=settings&project=project");
    await click("넥스트배송 열기");
    expect(mock.open).toHaveBeenCalledWith("company", "project", row.id);
  });
  it("keeps existing registrations visible after adding another forwarder account", async () => {
    const first = { ...row, name: "넥스트배송 A계정" };
    const second = { ...row, id: "second", name: "넥스트배송 B계정" };
    const third = { ...row, id: "third", name: "다른 배송대행지" };
    mock.list.mockResolvedValueOnce([first, second]).mockResolvedValue([first, second, third]);
    mock.create.mockResolvedValue(third);
    await render();
    await click("배송대행지 추가");
    await act(async () => { const select = document.querySelector("select")!; select.value = "other-provider"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await fill("로그인 아이디", "synthetic-third-user"); await fill("비밀번호", "synthetic-third-password");
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(mock.create).toHaveBeenCalledWith("company", "project", expect.objectContaining({ providerId: "other-provider" }));
    expect(mock.update).not.toHaveBeenCalled();
    const buttons = Array.from(document.querySelectorAll("button")).map(el => el.textContent);
    expect(buttons).toEqual(expect.arrayContaining(["넥스트배송 A계정 열기", "넥스트배송 B계정 열기", "다른 배송대행지 열기", "배송대행지 추가"]));
  });
  it("opens only the chosen account from a multiple-forwarder order chooser", async () => {
    const first = { ...row, name: "넥스트배송 A계정" };
    const second = { ...row, id: "second", name: "넥스트배송 B계정" };
    mock.list.mockResolvedValue([first, second]);
    await render("fixture-order"); await click("넥스트배송 B계정 열기");
    expect(mock.open).toHaveBeenCalledExactlyOnceWith("company", "project", second.id);
    expect(mock.create).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
  });

});
