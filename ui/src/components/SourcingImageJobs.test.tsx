// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourcingImageJobs } from "./SourcingImageJobs";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../api/sourcing", () => ({ sourcingCatalogApi: mock }));
let host: HTMLDivElement, root: Root, cache: QueryClient;
let savedSettings: typeof settings;
const changed = vi.fn();
const scope = { companyId: "company", projectId: "project" };
const settings = { ...scope, enabled: false, scanIntervalSeconds: 60, workerEnabled: true, errorCode: "" };
const rows = [
  { id: "one", productId: "product", assetId: "", imageUrl: "https://img.alicdn.com/original.jpg", state: "processing", errorCode: "" },
  { id: "two", productId: "product", assetId: "asset", imageUrl: "https://img.alicdn.com/2.jpg", state: "attention", errorCode: "image_text_review_required" },
  { id: "three", productId: "product", assetId: "", imageUrl: "https://img.alicdn.com/3.jpg", state: "attention", errorCode: "higgsfield_submission_unknown" },
];
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
async function render(settingsOnly = false) { await act(async () => root.render(<QueryClientProvider client={cache}><SourcingImageJobs {...scope} onChanged={changed} settingsOnly={settingsOnly} /></QueryClientProvider>)); await settle(); }
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mock.request.mockReset(); changed.mockReset(); savedSettings = { ...settings };
  mock.request.mockImplementation(async (_company, _project, i) => {
    if (i.operation === "image-job-configure") savedSettings = { ...settings, ...i };
    return i.operation === "image-jobs" ? structuredClone(rows) : structuredClone(savedSettings);
  });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); });
it("shows server job status and owned preview with explicit retry but blocks ambiguous resubmission", async () => {
  await render(); expect(host.textContent).toContain("1개 가공 중");
  expect(host.querySelector('img[src$="asset.png"]')!.getAttribute('src')).toBe("/api/companies/company/sourcing/projects/project/images/product/asset.png");
  const buttons = [...host.querySelectorAll('tbody button')]; expect(buttons.map(b => b.textContent)).toEqual(["다시 가공"]);
  expect(host.textContent).not.toContain("힉스필드 크레딧");
  await act(async () => (buttons[0] as HTMLButtonElement).click()); await settle();
  expect(mock.request).toHaveBeenCalledWith("company", "project", { operation: "image-job-retry", jobId: "two" });
  expect(mock.request.mock.calls.every(c => !["image-process", "image-job-adopt"].includes(c[2].operation))).toBe(true);
});
it("explains a local memory stop and retries only the selected persisted job", async () => {
  const normal = mock.request.getMockImplementation();
  mock.request.mockImplementation(async (...args) => args[2].operation === "image-jobs"
    ? [{ ...rows[0], state: "attention", errorCode: "image_processing_memory_limit" }] : normal?.(...args));
  await render();
  expect(host.textContent).toContain("메모리 한도를 넘어 이미지 처리를 중단했습니다.");
  await act(async () => ([...host.querySelectorAll('tbody button')].find(b => b.textContent === "재시도") as HTMLButtonElement).click());
  await settle();
  expect(mock.request).toHaveBeenCalledWith("company", "project", { operation: "image-job-retry", jobId: "one" });
});
it("persists enabled and interval settings in project scope and refreshes only on changed job results", async () => {
  await render(true); expect(changed).not.toHaveBeenCalled();
  await act(async () => (host.querySelector('input[type=checkbox]') as HTMLInputElement).click());
  await act(async () => { const input = host.querySelector('input[type=number]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await settle();
  expect(mock.request).toHaveBeenCalledWith("company", "project", { operation: "image-job-configure", enabled: true, scanIntervalSeconds: 120 });
  expect(host.textContent).toContain("자동 확인 켜짐"); expect(changed).not.toHaveBeenCalled();
  await act(async () => cache.setQueryData(["sourcing-image-jobs", "company", "project"], [{ ...rows[0], state: "succeeded", assetId: "saved" }])); await settle();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(cache.getQueryData(["sourcing-image-jobs", "company", "project"])).toEqual([{ ...rows[0], state: "succeeded", assetId: "saved" }]);
  expect(host.querySelector("tbody")).toBeNull();
});

it("reads product details only when the review opens and passes the loaded product without a second request", async () => {
  const normal = mock.request.getMockImplementation();
  const product = { id: "product", title: "검토 상품", sourceProductId: "source-1" };
  mock.request.mockImplementation(async (...args) => args[2].operation === "get" ? product : normal?.(...args));
  const onOpen = vi.fn();
  await act(async () => root.render(<QueryClientProvider client={cache}><SourcingImageJobs {...scope} onChanged={changed} onOpenProduct={onOpen} /></QueryClientProvider>)); await settle();
  expect(mock.request.mock.calls.filter(c => c[2].operation === "get")).toHaveLength(0);
  await act(async () => { host.querySelector('details')!.open = true; }); await settle();
  expect(mock.request.mock.calls.filter(c => c[2].operation === "get")).toHaveLength(1);
  await act(async () => ([...host.querySelectorAll('button')].find(b => b.textContent === "상품 편집") as HTMLButtonElement).click()); await settle();
  expect(onOpen).toHaveBeenCalledWith(product);
  expect(host.querySelector('details')!.open).toBe(false);
  expect(mock.request.mock.calls.filter(c => c[2].operation === "get")).toHaveLength(1);
});

it("distinguishes an unavailable job list from an empty review", async () => {
  const normal = mock.request.getMockImplementation();
  mock.request.mockImplementation(async (...args) => { if (args[2].operation === "image-jobs") throw new Error("unavailable"); return normal?.(...args); });
  await render();
  expect(host.querySelector('summary')!.textContent).toContain("조회 실패");
  expect(host.textContent).not.toContain("아직 이미지 가공 작업이 없습니다.");
});
