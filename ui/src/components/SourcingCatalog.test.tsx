// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SourcingStoreSettings } from "./SourcingStoreSettings";
import { SourcingProducts } from "./SourcingProducts";
import type { ManagedProduct, StoreSettings } from "@paperclipai/shared";

const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../api/sourcing", () => ({ sourcingCatalogApi: mock }));
vi.mock("./SourcingProcessing", () => ({ SourcingProcessing: () => null }));
const business = "a".repeat(32), storeA = "b".repeat(32), storeB = "c".repeat(32), productId = "d".repeat(32);
let settings: StoreSettings; let product: ManagedProduct; let root: Root; let host: HTMLDivElement; let cache: QueryClient;
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
async function click(name: string) { await act(async () => { const button = [...document.querySelectorAll("button")].find(b => b.textContent === name); expect(button).toBeDefined(); button!.click(); }); await settle(); }
async function input(label: string, value: string) { await act(async () => { const el = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; expect(el).not.toBeNull(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function render(node: React.ReactNode) { await act(async () => { root.render(<QueryClientProvider client={cache}>{node}</QueryClientProvider>); }); await settle(); }
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  settings = { businesses: [{ id: business, name: "사업자 A", registrationNumber: "", companyId: "company", projectId: "project" }],
    providers: [{ id: "coupang", name: "쿠팡", catalogSupported: true, fields: [{ key: "vendorId", label: "판매자 코드", required: true, secret: false }, { key: "accessKey", label: "Access Key", required: true, secret: true }, { key: "secretKey", label: "Secret Key", required: true, secret: true }] }, { id: "naver", name: "스마트스토어", catalogSupported: false, fields: [{ key: "clientSecret", label: "애플리케이션 Secret", required: true, secret: true }] }],
    stores: [storeA, storeB].map((id, index) => ({ id, businessId: business, accountId: id, provider: "coupang", name: `쿠팡 ${index + 1}`, enabled: true, revision: 1, templateProductId: "900", hasCredentials: true, catalogSupported: true, importState: "idle", importError: "" })), legacyAccounts: [] };
  product = { id: productId, title: "상품 A", mainImage: "https://images.example.test/main.jpg", description: "상세 설명", categoryCode: "100", revision: 1, sourceProvider: "coupang", sourceProductId: "101", skus: [{ id: "11", name: "빨강", image: "https://images.example.test/main.jpg", options: [{ name: "색상", value: "빨강" }] }], listings: [{ storeId: storeA, remoteProductId: "101", state: "registered", publishedRevision: 1 }] };
  mock.request.mockReset(); mock.request.mockImplementation(async (_company, _project, request) => {
    if (request.operation === "import-status") return { state: "idle", errorCode: "", products: 0 };
    if (request.operation === "stages") return { all: 1, processing: 0, ready: 1, queued: 0, attention: 0, uploaded: 0 };
    if (request.operation === "settings") return structuredClone(settings);
    if (request.operation === "list") return [structuredClone(product)];
    if (request.operation === "sources") return [{ sourceProvider: "taobao", sourceProductId: "123", title: "수집 상품", mainImage: "" }];
    if (request.operation === "jobs" || request.operation === "queue") return [];
    if (request.operation === "get") return structuredClone(product);
    if (request.operation === "save") { product = { ...product, ...request, revision: product.revision + 1 }; return structuredClone(product); }
    return structuredClone(settings);
  });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); });
describe("store settings and common product editor", () => {
  it("reads stage totals from the server and sends the selected filter before paging", async () => {
    await render(<SourcingProducts companyId="company" projectId="project" view="source" />);
    expect(document.querySelector('[aria-label="소싱 단계"]')?.textContent).toContain("업로드 준비 (1)");
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(el => el.textContent === "업로드 준비 (1)")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    await settle();
    expect(mock.request).toHaveBeenCalledWith("company", "project", { operation: "list", view: "source", page: 1, stage: "ready" });
  });
  it("starts selected-store import and refreshes cards on verified completion", async () => {
    const original = mock.request.getMockImplementation(); let imported = false;
    mock.request.mockImplementation(async (...args) => {
      const request = args[2];
      if (request.operation === "import") { imported = true; return { state: "succeeded", products: 1, errorCode: "" }; }
      if (request.operation === "import-status") return { state: imported ? "succeeded" : "idle", products: imported ? 1 : 0, errorCode: "" };
      return original?.(...args);
    });
    await render(<SourcingProducts companyId="company" projectId="project" view="uploads" />);
    await click("쿠팡 상품 가져오기");
    expect(mock.request).toHaveBeenCalledWith("company", "project", { operation: "import", storeId: storeA });
    expect(document.body.textContent).toContain("가져오기 완료 · 저장 상품 1개");
  });
  it("shows all registered stores and opens the selected store's dynamic secret-safe connection dialog", async () => {
    await render(<SourcingStoreSettings companyId="company" projectId="project" />);
    expect(document.body.textContent).toContain("쿠팡 1"); expect(document.body.textContent).toContain("쿠팡 2");
    const buttons = [...document.querySelectorAll("button")].filter(b => b.textContent === "연결 정보"); await act(async () => buttons[1].click()); await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("쿠팡 2 연결 정보");
    expect(document.querySelector<HTMLInputElement>('[aria-label="Secret Key"]')?.type).toBe("password");
    expect(document.querySelector<HTMLInputElement>('[aria-label="Secret Key"]')?.value).toBe("");
    await input("쇼핑몰 이름", "쿠팡 두 번째 변경");
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: "store", storeId: storeB, expectedRevision: 1, name: "쿠팡 두 번째 변경", credentials: {} }));
  });
  it("registers a business and uses provider metadata for a new store form", async () => {
    await render(<SourcingStoreSettings companyId="company" projectId="project" />); await click("사업자 등록"); await input("사업자명", "사업자 B");
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(mock.request).toHaveBeenCalledWith("company", "project", { operation: "business", name: "사업자 B", registrationNumber: "" });
    await click("쇼핑몰 등록"); const select = document.querySelector<HTMLSelectElement>('[aria-label="쇼핑몰 종류"]')!;
    await act(async () => { select.value = "naver"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(document.querySelector('[aria-label="애플리케이션 Secret"]')).not.toBeNull(); expect(document.querySelector('[aria-label="Secret Key"]')).toBeNull(); expect(document.body.textContent).toContain("연결 정보 저장만 지원");
  });
  it("renders one image/title card, saves edits and queues selected registered and missing stores", async () => {
    await render(<SourcingProducts companyId="company" projectId="project" view="uploads" />);
    expect(document.querySelectorAll('[aria-label="업로드 상품 목록"] button')).toHaveLength(1);
    expect(document.querySelector<HTMLImageElement>('[aria-label="업로드 상품 목록"] img')?.src).toBe(product.mainImage);
    const card = document.querySelector<HTMLButtonElement>('[aria-label="업로드 상품 목록"] button')!; await act(async () => card.click()); await settle();
    expect(document.body.textContent).toContain("등록됨 / 수정"); expect(document.body.textContent).toContain("미등록 / 추가 등록");
    await input("상품명", "상품 A 수정"); expect([...document.querySelectorAll("button")].find(b => b.textContent === "선택 쇼핑몰 업로드")?.disabled).toBe(true);
    await click("변경 저장"); expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: "save", productId, expectedRevision: 1, title: "상품 A 수정" }));
    const checks = [...document.querySelectorAll<HTMLInputElement>('[aria-label="상품 편집"] input[type="checkbox"]')]; await act(async () => { checks[0].click(); checks[1].click(); }); await click("선택 쇼핑몰 업로드");
    expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: "queue", productId, expectedRevision: 2, storeIds: [storeA, storeB], requestId: expect.any(String) }));
  });
  it("refreshes completed registrations without marking metadata as unsaved or overwriting edits", async () => {
    await render(<SourcingProducts companyId="company" projectId="project" view="uploads" />);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="업로드 상품 목록"] button')!.click()); await settle();
    product.listings.push({ storeId: storeB, remoteProductId: "201", state: "registered", publishedRevision: 1 });
    await click("새로고침");
    expect(document.body.textContent).toContain("2개 쇼핑몰 등록");
    expect(document.body.textContent).not.toContain("저장하지 않은 변경 있음");
    expect([...document.querySelectorAll("button")].find(b => b.textContent === "변경 저장")?.disabled).toBe(true);
    await input("상품명", "아직 저장하지 않은 이름");
    await act(async () => { cache.setQueryData(["sourcing-catalog", "company", "project", "jobs"], [{ id: "job-done", state: "succeeded", productId, storeId: storeA }]); }); await settle();
    expect(document.querySelector<HTMLInputElement>('[aria-label="상품명"]')?.value).toBe("아직 저장하지 않은 이름");
    expect(document.body.textContent).toContain("저장하지 않은 변경 있음");
  });
  it("provides the same editable fields from a sourcing item", async () => {
    product.listings = []; await render(<SourcingProducts companyId="company" projectId="project" view="source" />); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="소싱 상품 목록"] button')!.click()); await settle();
    for (const label of ["상품명", "대표 이미지 URL", "카테고리 코드", "상세 설명", "옵션 1 상품명", "옵션 1-1 이름", "옵션 1-1 값"]) expect(document.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    expect(document.body.textContent).toContain("쇼핑몰 선택");
  });
});
