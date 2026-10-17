// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourcingCaptureSettings } from "./SourcingCaptureSettings";
const mock = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("../api/sourcing", () => ({ sourcingCaptureApi: mock }));
let root: Root, host: HTMLDivElement, cache: QueryClient;
const row = { id: "11111111-1111-4111-8111-111111111111", name: "내 크롬", expiresAt: "2099-01-01T00:00:00Z", lastUsedAt: null, revokedAt: null };
const token = `dvc_${"a".repeat(43)}`;
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
async function click(label: string) { const button = [...host.querySelectorAll("button")].find(b => b.textContent === label); expect(button).toBeDefined(); await act(async () => button!.click()); await settle(); }
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks();
  mock.list.mockResolvedValue({ connections: [], serverUrl: "https://capture.example" }); mock.create.mockResolvedValue({ ...row, token }); mock.revoke.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={cache}><SourcingCaptureSettings companyId="company" projectId="project" projectName="Auto Sourcing" /></QueryClientProvider>)); await settle();
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); });
it("issues project-labelled one-time setup and hides it without leaving credential text", async () => {
  const download = host.querySelector<HTMLAnchorElement>('a[download]')!;
  expect(download.textContent).toBe("확장 파일 받기");
  expect(download.getAttribute("href")).toBe("/downloads/dovix-chrome-product-capture.zip");
  expect(host.textContent).toContain("chrome://extensions");
  expect(host.textContent).not.toContain(token); await click("연결 정보 만들기");
  expect(mock.create).toHaveBeenCalledWith("company", "project", "내 크롬");
  const setup = JSON.parse(host.querySelector<HTMLTextAreaElement>("textarea")!.value);
  expect(setup).toMatchObject({ serverUrl: "https://capture.example", connectionId: row.id, projectName: "Auto Sourcing", token });
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  await click("연결 정보 복사"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("직접 선택해 복사");
  if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor); else Reflect.deleteProperty(navigator, "clipboard");
  await click("연결 정보 닫기"); expect(host.querySelector("textarea")).toBeNull(); expect(host.innerHTML).not.toContain(token);
});
it("rejects a non-HTTPS remote receiver before creating any credential", async () => {
  const input = host.querySelector<HTMLInputElement>('input[type="url"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "http://remote.example"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await click("연결 정보 만들기"); expect(mock.create).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("HTTPS");
});
it("lists only safe metadata and reports revocation failure without claiming it succeeded", async () => {
  mock.list.mockResolvedValue({ connections: [row], serverUrl: "https://capture.example" }); await cache.invalidateQueries(); await settle();
  expect(host.textContent).toContain("아직 수집하지 않음"); mock.revoke.mockRejectedValueOnce(new Error("offline"));
  await click("연결 해제"); expect(mock.revoke).toHaveBeenCalledWith("company", "project", row.id); expect(host.querySelector('[role="alert"]')?.textContent).toContain("해제하지 못했습니다");
});

it("shows copy success only after the shared clipboard write resolves and clears success on a later failure", async () => {
  await click("연결 정보 만들기");
  let finish: () => void = () => {};
  const write = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const commandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
  try {
    await click("연결 정보 복사"); expect(host.textContent).not.toContain("복사됨");
    expect(write).toHaveBeenCalledWith(host.querySelector<HTMLTextAreaElement>("textarea")!.value);
    await act(async () => finish()); await settle(); expect(host.textContent).toContain("복사됨");
    write.mockRejectedValueOnce(new Error("Denied")); await click("복사됨");
    expect(host.textContent).not.toContain("복사됨"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("직접 선택해 복사");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain(token);
  } finally {
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor); else Reflect.deleteProperty(navigator, "clipboard");
    if (commandDescriptor) Object.defineProperty(document, "execCommand", commandDescriptor); else Reflect.deleteProperty(document, "execCommand");
  }
});
