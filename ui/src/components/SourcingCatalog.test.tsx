// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SourcingProductEditor } from "./SourcingProductEditor";
import { productDraftKey, writeProductDraft } from "../lib/sourcing-product-draft";
import { SourcingStoreSettings } from "./SourcingStoreSettings";
import { SourcingProducts } from "./SourcingProducts";
import type { ManagedProduct, StoreSettings } from "@paperclipai/shared";
import { ApiError } from "../api/client";

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
  window.localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  settings = { businesses: [{ id: business, name: "사업자 A", registrationNumber: "", companyId: "company", projectId: "project" }],
    providers: [{ id: "coupang", name: "쿠팡", catalogSupported: true, fields: [{ key: "vendorId", label: "판매자 코드", required: true, secret: false }, { key: "accessKey", label: "Access Key", required: true, secret: true }, { key: "secretKey", label: "Secret Key", required: true, secret: true }] }, { id: "naver", name: "스마트스토어", catalogSupported: false, fields: [{ key: "clientSecret", label: "애플리케이션 Secret", required: true, secret: true }] }],
    stores: [storeA, storeB].map((id, index) => ({ id, businessId: business, accountId: id, provider: "coupang", name: `쿠팡 ${index + 1}`, enabled: true, revision: 1, templateProductId: "900", hasCredentials: true, catalogSupported: true, importState: "idle", importError: "" })), legacyAccounts: [] };
  product = { id: productId, title: "상품 A", mainImage: "https://images.example.test/main.jpg", description: "상세 설명", categoryCode: "100", revision: 1, sourceProvider: "coupang", sourceProductId: "101", skus: [{ id: "11", name: "빨강", image: "https://images.example.test/main.jpg", options: [{ name: "색상", value: "빨강" }] }], listings: [{ storeId: storeA, remoteProductId: "101", state: "registered", publishedRevision: 1 }] };
  mock.request.mockReset(); mock.request.mockImplementation(async (_company, _project, request) => {
    if (request.operation === "import-status") return { state: "idle", errorCode: "", products: 0 };
    if (request.operation === "stages") return { all: 1, processing: 0, ready: 1, queued: 0, attention: 0, uploaded: 0 };
    if (request.operation === "category-metadata") return { code: 100, name: "가구 / 의자" };
    if (request.operation === "settings") return structuredClone(settings);
    if (request.operation === "list") return [structuredClone(product)];
    if (request.operation === "workspace") return [{ id: product.id, kind: "product", title: product.title, mainImage: product.mainImage, stage: "ready", product: structuredClone(product), candidate: null, source: null }];
    if (request.operation === "price-preview") return { productRevision: product.revision, confirmation: "e".repeat(64), stores: [] };
    if (request.operation === "sources") return [{ sourceProvider: "taobao", sourceProductId: "123", title: "수집 상품", mainImage: "" }];
    if (request.operation === "jobs" || request.operation === "queue" || request.operation === "image-jobs") return [];
    if (request.operation === "image-job-settings") return { enabled: false, scanIntervalSeconds: 60, workerEnabled: false, errorCode: "" };
    if (request.operation === "get") return structuredClone(product);
    if (request.operation === "save") { product = { ...product, ...request, revision: product.revision + 1 }; return structuredClone(product); }
    return structuredClone(settings);
  });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); });
describe("store settings and common product editor", () => {
  it("compares edited prices before saving, preserves cancelled edits and requires a fresh store confirmation", async () => {
    product.skus[0].salePrice = 10000;
    const original = mock.request.getMockImplementation(); let rejectQueue = true;
    mock.request.mockImplementation(async (...args) => {
      if (args[2].operation === "price-preview") return { productRevision: product.revision, confirmation: "e".repeat(64), stores: [{ storeId: storeA, accountRevision: 1, snapshotDigest: "digest", changes: [{ skuId: "11", name: "빨강", before: 11000, after: 12000 }] }] };
      if (args[2].operation === "queue" && rejectQueue) { rejectQueue = false; throw new ApiError("price_confirmation_required", 409, {}); }
      return original?.(...args);
    });
    await render(<SourcingProducts companyId="company" projectId="project" view="uploads" />);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="업로드 상품 목록"] button[aria-pressed]')!.click()); await settle();
    expect(document.querySelector('iframe')?.getAttribute("sandbox")).toBe("");
    await input("옵션 1 판매가격", "12000"); await click("변경 저장");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("10,000원");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("12,000원");
    expect(mock.request.mock.calls.some(c => c[2].operation === "save")).toBe(false);
    await click("취소"); expect(document.querySelector<HTMLInputElement>('[aria-label="옵션 1 판매가격"]')?.value).toBe("12000");
    await click("변경 저장"); await click("가격 변경 저장");
    expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: "save", confirmPriceChanges: true, skus: [expect.objectContaining({ salePrice: 12000 })] }));
    await act(async () => document.querySelector<HTMLInputElement>('[aria-label="상품 편집"] input[type="checkbox"]')!.click());
    await click("선택 쇼핑몰 업로드"); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("11,000원");
    expect(mock.request.mock.calls.some(c => c[2].operation === "queue")).toBe(false);
    await click("확인 후 큐 등록"); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('[aria-label="상품명"]')?.disabled).toBe(false);
    const rejectedId = mock.request.mock.calls.find(c => c[2].operation === "queue")![2].requestId;
    await click("선택 쇼핑몰 업로드"); await click("확인 후 큐 등록");
    const requests = mock.request.mock.calls.filter(c => c[2].operation === "queue");
    expect(requests[1][2].requestId).not.toBe(rejectedId); expect(requests[1][2].priceConfirmation).toBe("e".repeat(64));
  });
  it("keeps candidates and unprocessed originals separate and promotes only after an explicit click", async () => {
    const original = mock.request.getMockImplementation(); let imported = false; let promoted = false;
    const candidate = { id: "candidate", kind: "candidate", title: "소싱 후보 A", mainImage: "", stage: "candidate", product: null, source: null, candidate: { id: "candidate", sourceProductId: "123", url: "https://item.taobao.com/item.htm?id=123", mainKeyword: "키워드", subKeyword: "보조", collectionState: "idle", errorCode: "" } };
    const source = { id: "source", kind: "source", title: "수집 원본 B", mainImage: "", stage: "unprocessed", product: null, candidate: null, source: { sourceProvider: "taobao", sourceProductId: "456", title: "수집 원본 B", mainImage: "", url: "https://item.taobao.com/item.htm?id=456", description: "<p>상세 HTML</p>", optionCount: 1 } };
    mock.request.mockImplementation(async (...args) => {
      const request = args[2];
      if (request.operation === "candidate-import") { imported = true; return { added: 1 }; }
      if (request.operation === "workspace") return promoted ? [{ id: product.id, kind: "product", title: product.title, mainImage: product.mainImage, stage: "processing", product, candidate: null, source: null }] : imported ? [candidate, source] : [];
      if (request.operation === "stages") return { all: imported ? 2 : 0, candidate: imported ? 1 : 0, unprocessed: imported && !promoted ? 1 : 0, processing: promoted ? 1 : 0, ready: 0, queued: 0, uploaded: 0, attention: 0 };
      if (request.operation === "source") { promoted = true; return { ...product, listings: [], stage: "processing" }; }
      return original?.(...args);
    });
    await render(<SourcingProducts companyId="company" projectId="project" view="source" />); await click("기존 후보 불러오기");
    expect(document.querySelector('[aria-label="소싱 단계"]')?.textContent).toContain("수집 후보 1");
    await act(async () => document.querySelectorAll<HTMLButtonElement>('[aria-label="소싱 상품 목록"] button[aria-pressed]')[0].click()); await settle();
    expect(document.querySelector('[aria-label="소싱 후보 정보"]')?.textContent).toContain("키워드");
    expect(mock.request.mock.calls.some(c => c[2].operation === "candidate-collect")).toBe(false);
    await act(async () => document.querySelectorAll<HTMLButtonElement>('[aria-label="소싱 상품 목록"] button[aria-pressed]')[1].click()); await settle();
    expect(document.querySelector('[aria-label="가공 전 상품 정보"] iframe')).not.toBeNull();
    expect(mock.request.mock.calls.some(c => c[2].operation === "source")).toBe(false);
    await click("가공 시작"); expect(mock.request).toHaveBeenCalledWith("company", "project", { operation: "source", sourceProvider: "taobao", sourceProductId: "456" });
    expect(document.querySelector('[aria-label="상품 편집"]')).not.toBeNull();
  });
  it("blocks candidate selection and collection while a product has unsaved edits", async () => {
    const original = mock.request.getMockImplementation();
    const candidate = { id: "candidate", kind: "candidate", title: "선택 후보", mainImage: "", stage: "candidate", product: null, source: null, candidate: { id: "candidate", sourceProductId: "123", url: "https://item.taobao.com/item.htm?id=123", mainKeyword: "", subKeyword: "", collectionState: "idle", errorCode: "" } };
    mock.request.mockImplementation(async (...args) => args[2].operation === "workspace" ? [candidate, ...(await original?.(...args))] : original?.(...args));
    await render(<SourcingProducts companyId="company" projectId="project" view="source" />);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="소싱 후보 선택: 선택 후보"]')!.click()); await settle();
    await act(async () => document.querySelectorAll<HTMLButtonElement>('[aria-label="소싱 상품 목록"] button[aria-pressed]')[1].click()); await settle();
    await input("상품명", "수정 중 상품");
    expect(document.querySelector<HTMLButtonElement>('[aria-label="소싱 후보 선택: 선택 후보"]')!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="현재 페이지 수집 가능한 후보 전체 선택"]')!.disabled).toBe(true);
    const queue = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "선택한 후보 수집 큐에 추가")!;
    expect(queue.disabled).toBe(true); await act(async () => queue.click());
    expect(mock.request.mock.calls.some(c => c[2].operation === "candidate-collect")).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[aria-label="상품명"]')!.value).toBe("수정 중 상품");
  });
  it.each(["source", "uploads"] as const)("searches and clears %s across server pages without losing unsaved edits", async view => {
    const original = mock.request.getMockImplementation();
    mock.request.mockImplementation(async (...args) => {
      const request = args[2];
      if (["list", "workspace"].includes(request.operation)) {
        const products = request.query === "없음" ? [] : Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(product), id: `${i}` }));
        return request.operation === "workspace" ? products.map(p => ({ id: p.id, kind: "product", title: p.title, mainImage: p.mainImage, stage: "ready", product: p, candidate: null, source: null })) : products;
      }
      return original?.(...args);
    });
    await render(<SourcingProducts companyId="company" projectId="project" view={view} />);
    await click("다음");
    expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: view === "source" ? "workspace" : "list", page: 2 }));
    await input("상품 검색 키워드", "  없음  "); await click("검색");
    expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: view === "source" ? "workspace" : "list", page: 1, query: "없음" }));
    expect(document.body.textContent).toContain("검색 결과가 없습니다.");
    if (view === "source") expect(mock.request).toHaveBeenCalledWith("company", "project", { operation: "stages", query: "없음" });
    await click("검색 초기화");
    expect(document.querySelector<HTMLInputElement>('[aria-label="상품 검색 키워드"]')?.value).toBe("");
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="소싱 상품 목록"] button[aria-pressed], [aria-label="업로드 상품 목록"] button[aria-pressed]')!.click()); await settle();
    await input("상품명", "저장 전 이름");
    expect(document.querySelector<HTMLInputElement>('[aria-label="상품 검색 키워드"]')?.disabled).toBe(true);
    expect([...document.querySelectorAll("button")].find(b => b.textContent === "검색")?.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[aria-label="상품명"]')?.value).toBe("저장 전 이름");
  });
  it("reads stage totals from the server and sends the selected filter before paging", async () => {
    await render(<SourcingProducts companyId="company" projectId="project" view="source" />);
    expect(document.querySelector('[aria-label="소싱 단계"]')?.textContent).toContain("등록 준비 1");
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(el => el.textContent === "등록 준비 1")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    await settle();
    expect(mock.request).toHaveBeenCalledWith("company", "project", { operation: "workspace", page: 1, pageSize: 20, stage: "ready" });
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
    expect(document.querySelectorAll('[aria-label="업로드 상품 목록"] button[aria-pressed]')).toHaveLength(1);
    expect(document.querySelector<HTMLImageElement>('[aria-label="업로드 상품 목록"] img')?.src).toBe(product.mainImage);
    const card = document.querySelector<HTMLButtonElement>('[aria-label="업로드 상품 목록"] button[aria-pressed]')!; await act(async () => card.click()); await settle();
    expect(document.body.textContent).toContain("등록됨 / 수정"); expect(document.body.textContent).toContain("미등록 / 추가 등록");
    await input("상품명", "상품 A 수정"); expect([...document.querySelectorAll("button")].find(b => b.textContent === "선택 쇼핑몰 업로드")?.disabled).toBe(true);
    await click("변경 저장"); expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: "save", productId, expectedRevision: 1, title: "상품 A 수정" }));
    const checks = [...document.querySelectorAll<HTMLInputElement>('[aria-label="상품 편집"] input[type="checkbox"]')]; await act(async () => { checks[0].click(); checks[1].click(); }); await click("선택 쇼핑몰 업로드");
    expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: "queue", productId, expectedRevision: 2, storeIds: [storeA, storeB], requestId: expect.any(String) }));
  });
  it("refreshes completed registrations without marking metadata as unsaved or overwriting edits", async () => {
    await render(<SourcingProducts companyId="company" projectId="project" view="uploads" />);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="업로드 상품 목록"] button[aria-pressed]')!.click()); await settle();
    product.listings.push({ storeId: storeB, remoteProductId: "201", state: "registered", publishedRevision: 1 });
    await click("새로고침");
    expect(document.body.textContent).toContain("2개 쇼핑몰 등록");
    expect(document.body.textContent).not.toContain("서버 저장 전");
    expect([...document.querySelectorAll("button")].find(b => b.textContent === "변경 저장")?.disabled).toBe(true);
    await input("상품명", "아직 저장하지 않은 이름");
    await act(async () => { cache.setQueryData(["sourcing-catalog", "company", "project", "jobs"], [{ id: "job-done", state: "succeeded", productId, storeId: storeA }]); }); await settle();
    expect(document.querySelector<HTMLInputElement>('[aria-label="상품명"]')?.value).toBe("아직 저장하지 않은 이름");
    expect(document.body.textContent).toContain("서버 저장 전");
  });
  it("provides the same editable fields from a sourcing item", async () => {
    product.listings = []; await render(<SourcingProducts companyId="company" projectId="project" view="source" />); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="소싱 상품 목록"] button[aria-pressed]')!.click()); await settle();
    await click("HTML 편집");
    for (const label of ["상품명", "대표 이미지 URL", "카테고리 코드", "상세 설명", "옵션 1 상품명", "옵션 1-1 이름", "옵션 1-1 값"]) expect(document.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    expect(document.body.textContent).toContain("쇼핑몰 선택");
  });
});


describe("managed product browser buffer and save-next", () => {
  function editor(extra: Partial<React.ComponentProps<typeof SourcingProductEditor>> = {}) {
    return <SourcingProductEditor companyId="company" projectId="project" product={product} settings={settings} jobs={[]} onDirty={() => {}} onSaved={() => {}} onQueued={() => {}} {...extra} />;
  }
  it("restores scoped unfinished edits after remount and clears the buffer only on cancel or successful save", async () => {
    await render(editor()); await input("상품명", "브라우저 초안");
    await click("옵션·가격"); await click("기본정보");
    expect(host.querySelector<HTMLInputElement>('[aria-label="상품명"]')!.value).toBe("브라우저 초안");
    expect(host.textContent).toContain("브라우저 임시 저장됨 · 서버 저장 전");
    const key = productDraftKey("company", "project", product.id);
    expect(JSON.parse(window.localStorage.getItem(key)!).baseRevision).toBe(1);
    expect(mock.request.mock.calls.some(c => c[2].operation === "save")).toBe(false);
    await render(null); await render(editor({ projectId: "other" }));
    expect(host.querySelector<HTMLInputElement>('[aria-label="상품명"]')!.value).toBe("상품 A");
    await render(null); await render(editor());
    expect(host.querySelector<HTMLInputElement>('[aria-label="상품명"]')!.value).toBe("브라우저 초안");
    await click("변경 취소"); expect(window.localStorage.getItem(key)).toBeNull();
    await input("상품명", "서버 저장한 이름"); await click("변경 저장");
    expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: "save", expectedRevision: 1, title: "서버 저장한 이름" }));
    expect(window.localStorage.getItem(key)).toBeNull(); expect(host.textContent).toContain("서버에 저장됨");
  });
  it("offers explicit recovery or discard for another revision without overwriting current server metadata", async () => {
    writeProductDraft("company", "project", 1, { ...product, title: "이전 버전 초안", categoryCode: "999" });
    product = { ...product, revision: 2, title: "현재 서버 이름" };
    await render(editor());
    expect(host.querySelector<HTMLInputElement>('[aria-label="상품명"]')!.value).toBe("현재 서버 이름");
    expect(host.textContent).toContain("다른 저장 버전");
    await click("편집기로 복구");
    expect(host.querySelector<HTMLInputElement>('[aria-label="상품명"]')!.value).toBe("이전 버전 초안");
    expect(host.querySelector<HTMLInputElement>('[aria-label="카테고리 코드"]')!.value).toBe("100");
    await click("변경 저장");
    expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: "save", expectedRevision: 2 }));
    await render(null); writeProductDraft("company", "project", 1, { ...product, title: "폐기할 초안" }); await render(editor()); await click("임시 저장 폐기");
    expect(window.localStorage.getItem(productDraftKey("company", "project", product.id))).toBeNull();
  });
  it("reports browser storage failure without claiming a saved buffer", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!; const storage = window.localStorage; const fail = vi.fn(() => { throw new DOMException("Full", "QuotaExceededError"); }); Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: storage.getItem.bind(storage), removeItem: storage.removeItem.bind(storage), setItem: fail } });
    try { await render(editor()); await input("상품명", "메모리 편집"); expect(host.textContent).toContain("임시 저장을 보관하거나 정리하지 못했습니다"); expect(fail).toHaveBeenCalled(); expect(host.textContent).not.toContain("브라우저 임시 저장됨"); expect(host.querySelector<HTMLInputElement>('[aria-label="상품명"]')!.value).toBe("메모리 편집"); } finally { Object.defineProperty(window, "localStorage", descriptor); }
  });
  it("moves next only after successful save and preserves edits on price cancellation and conflict", async () => {
    product.skus[0].salePrice = 10000; const next = vi.fn();
    await render(editor({ onNext: next })); await input("옵션 1 판매가격", "12000"); await click("저장하고 다음 상품 →"); await click("취소");
    expect(next).not.toHaveBeenCalled(); expect(mock.request.mock.calls.some(c => c[2].operation === "save")).toBe(false);
    const original = mock.request.getMockImplementation(); let resolveSave: (p: ManagedProduct) => void = () => {};
    mock.request.mockImplementation(async (...args) => args[2].operation === "save" ? new Promise<ManagedProduct>(resolve => { resolveSave = resolve; }) : original?.(...args));
    await click("저장하고 다음 상품 →"); await click("가격 변경 저장"); expect(next).not.toHaveBeenCalled();
    await act(async () => resolveSave({ ...product, revision: 2, skus: [{ ...product.skus[0], salePrice: 12000 }] })); await settle(); expect(next).toHaveBeenCalledTimes(1);
    await input("상품명", "충돌시 보존"); mock.request.mockImplementation(async (...args) => { if (args[2].operation === "save") throw new ApiError("revision_conflict", 409, {}); return original?.(...args); });
    await click("저장하고 다음 상품 →"); await settle(); expect(next).toHaveBeenCalledTimes(1); expect(host.querySelector<HTMLInputElement>('[aria-label="상품명"]')!.value).toBe("충돌시 보존");
  });
  it("has no save-next action for the last item and changes preview without changing the representative image", async () => {
    product.skus[0].image = "https://images.example.test/option.jpg";
    await render(editor()); expect([...host.querySelectorAll("button")].some(b => b.textContent === "저장하고 다음 상품 →")).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="상품 이미지 2 미리보기"]')!.click());
    expect(host.querySelector('img[alt="상품 대표 이미지"]')!.getAttribute("src")).toBe(product.skus[0].image);
    expect(host.querySelector<HTMLInputElement>('[aria-label="대표 이미지 URL"]')!.value).toBe(product.mainImage);
    expect(host.textContent).toContain("서버에 저장됨"); expect(window.localStorage.getItem(productDraftKey("company", "project", product.id))).toBeNull();
  });
});

it("keeps the browser buffer and blocks save-next when a successful HTTP response drops edited prices", async () => {
  const next = vi.fn();
  const original = mock.request.getMockImplementation();
  mock.request.mockImplementation(async (...args) => args[2].operation === "save" ? { ...product, revision: 2 } : original?.(...args));
  await render(<SourcingProductEditor companyId="company" projectId="project" product={product} settings={settings} jobs={[]} onDirty={() => {}} onSaved={() => {}} onQueued={() => {}} onNext={next} />);
  await input("옵션 1 판매가격", "12000"); await click("저장하고 다음 상품 →"); await click("가격 변경 저장");
  expect(next).not.toHaveBeenCalled(); expect(host.textContent).toContain("서버 저장 결과가 편집 내용과 다릅니다");
  expect(host.querySelector<HTMLInputElement>('[aria-label="옵션 1 판매가격"]')!.value).toBe("12000");
  const retained = JSON.parse(window.localStorage.getItem(productDraftKey("company", "project", product.id))!);
  expect(retained.baseRevision).toBe(2); expect(retained.product.skus[0].salePrice).toBe(12000);
});

it("accepts equivalent server fields with reordered object keys and null optional prices", async () => {
  const saved = vi.fn(), next = vi.fn(); const original = mock.request.getMockImplementation();
  mock.request.mockImplementation(async (...args) => args[2].operation === "save" ? { ...product, revision: 2, title: args[2].title, skus: product.skus.map(s => ({ options: s.options.map(o => ({ value: o.value, name: o.name })), salePrice: null, image: s.image, name: s.name, id: s.id })) } : original?.(...args));
  await render(<SourcingProductEditor companyId="company" projectId="project" product={product} settings={settings} jobs={[]} onDirty={() => {}} onSaved={saved} onQueued={() => {}} onNext={next} />);
  await input("상품명", "정상 저장"); await click("저장하고 다음 상품 →");
  expect(saved).toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(1); expect(host.textContent).not.toContain("서버 저장 결과가 편집 내용과 다릅니다");
});
