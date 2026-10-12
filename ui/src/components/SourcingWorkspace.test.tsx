// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourcingWorkspaceItem } from "@paperclipai/shared";
import { ApiError } from "../api/client";
import { SourcingWorkspace } from "./SourcingWorkspace";

const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../api/sourcing", () => ({ sourcingCatalogApi: mock }));
vi.mock("./SourcingProcessing", () => ({ SourcingProcessing: () => null }));
let root: Root; let host: HTMLDivElement; let cache: QueryClient; let rows: SourcingWorkspaceItem[];
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
const candidate = (id: string, state: NonNullable<SourcingWorkspaceItem["candidate"]>["collectionState"] = "idle"): SourcingWorkspaceItem => ({ id, kind: "candidate", title: `후보 ${id}`, stage: "candidate", mainImage: "", product: null, source: null,
  candidate: { id, sourceProductId: id, url: `https://item.taobao.com/item.htm?id=${id}`, mainKeyword: "", subKeyword: "", collectionState: state, errorCode: "" } });
async function render(companyId = "company", projectId = "project") {
  await act(async () => root.render(<QueryClientProvider client={cache}><SourcingWorkspace companyId={companyId} projectId={projectId} /></QueryClientProvider>)); await settle();
}
function button(text: string) { const b = [...host.querySelectorAll<HTMLButtonElement>("button")].find(x => x.textContent === text); expect(b).toBeDefined(); return b!; }
function checkbox(label: string) { const el = host.querySelector<HTMLButtonElement>(`[role="checkbox"][aria-label="${label}"]`); expect(el).not.toBeNull(); return el!; }
async function click(el: HTMLElement) { await act(async () => el.click()); await settle(); }
const requests = () => mock.request.mock.calls.filter(call => call[2].operation === "candidate-collect");
const all = () => checkbox("현재 페이지 수집 가능한 후보 전체 선택");
const queue = () => button("선택한 후보 수집 큐에 추가");

beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  rows = [candidate("1"), candidate("2", "failed"), candidate("3", "queued"), candidate("4", "collecting"), candidate("5", "importing"), candidate("6", "reconciliation_required")];
  mock.request.mockReset(); mock.request.mockImplementation(async (_company, _project, input) => {
    if (input.operation === "workspace") return structuredClone(rows);
    if (input.operation === "settings") return { businesses: [], stores: [], providers: [], legacyAccounts: [] };
    if (input.operation === "jobs" || input.operation === "image-jobs") return [];
    if (input.operation === "image-job-settings") return { enabled: false, scanIntervalSeconds: 60, workerEnabled: true, errorCode: "" };
    if (input.operation === "stages") return { all: rows.length, candidate: rows.length, unprocessed: 0, processing: 0, ready: 0, queued: 0, uploaded: 0, attention: 0 };
    if (input.operation === "candidate-collect") {
      const row = rows.find(item => item.candidate?.id === input.candidateId)!; row.candidate!.collectionState = "queued"; return structuredClone(row.candidate);
    }
  });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); });

describe("candidate collection selection", () => {
  it("queries 20, 50 and 100 rows, resets the page and clears selections when the size changes", async () => {
    rows = Array.from({ length: 125 }, (_, i) => candidate(String(i + 1)));
    mock.request.mockImplementation(async (_company, _project, input) => {
      if (input.operation === "workspace") return structuredClone(rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize));
      if (input.operation === "settings") return { businesses: [], stores: [], providers: [], legacyAccounts: [] };
      if (input.operation === "stages") return { all: 125, candidate: 125 };
      if (input.operation === "image-job-settings") return { enabled: false, scanIntervalSeconds: 60, workerEnabled: true, errorCode: "" };
      return [];
    });
    await render(); expect(host.querySelectorAll('tbody tr')).toHaveLength(20);
    await click(button("다음")); expect(host.querySelector('nav')?.textContent).toContain("2 페이지");
    await click(all()); expect(host.textContent).toContain("20개 선택");
    await click(button("50개 조회")); expect(host.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(host.querySelector('nav')?.textContent).toContain("1 페이지"); expect(host.textContent).toContain("0개 선택");
    await click(button("100개 조회")); expect(host.querySelectorAll('tbody tr')).toHaveLength(100);
    await click(button("다음")); expect(host.querySelectorAll('tbody tr')).toHaveLength(25); expect(button("다음").disabled).toBe(true);
    expect(requests()).toHaveLength(0);
  });
  it("shows a compact candidate table with site, product ID and URL while preserving full keywords in details", async () => {
    rows = [candidate("732092188696")];
    rows[0].candidate!.mainKeyword = "장스탠드, 마카롱 램프, 스탠드 조명";
    rows[0].candidate!.subKeyword = "긴 서브 키워드와 검색용 문구";
    rows[0].title = `${rows[0].candidate!.mainKeyword} · ${rows[0].candidate!.subKeyword}`;
    await render();
    const table = host.querySelector('table')!;
    expect(table.querySelector('caption')?.textContent).toBe("소싱 후보 목록");
    expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(["선택", "대표 키워드", "사이트", "상품 ID", "URL", "수집 상태"]);
    expect(table.textContent).toContain("장스탠드"); expect(table.textContent).toContain("타오바오");
    expect(table.textContent).not.toContain("마카롱 램프"); expect(table.textContent).not.toContain("긴 서브 키워드");
    const link = table.querySelector<HTMLAnchorElement>('a')!;
    expect(link.href).toBe(rows[0].candidate!.url); expect(link.target).toBe("_blank");
    expect(requests()).toHaveLength(0);
    await click(button("장스탠드"));
    const detail = host.querySelector('[aria-label="소싱 후보 정보"]')!;
    expect(detail.textContent).toContain(rows[0].candidate!.mainKeyword); expect(detail.textContent).toContain(rows[0].candidate!.subKeyword);
    await click(checkbox("소싱 후보 선택: 장스탠드"));
    expect(button("장스탠드").getAttribute("aria-pressed")).toBe("true"); expect(requests()).toHaveLength(0);
  });

  it("derives the site from the real URL host and never links invalid or executable URLs", async () => {
    rows = [candidate("1"), candidate("2"), candidate("3"), candidate("4")];
    rows[1].candidate!.url = "https://example.com/item/2";
    rows[2].candidate!.url = "https://taobao.com.example.com/item/3";
    rows[3].candidate!.url = "javascript:alert(1)";
    await render();
    const tableRows = [...host.querySelectorAll('tbody tr')];
    expect(tableRows[0].textContent).toContain("타오바오");
    expect(tableRows[1].querySelectorAll('td')[1].textContent).toBe("example.com");
    expect(tableRows[2].querySelectorAll('td')[1].textContent).toBe("taobao.com.example.com");
    expect(tableRows[3].querySelector('a')).toBeNull(); expect(tableRows[3].textContent).toContain("URL 확인 필요");
    expect(requests()).toHaveLength(0);
  });

  it("selects only eligible candidates and queues each once without opening the detail panel", async () => {
    await render(); expect(queue().disabled).toBe(true);
    await click(checkbox("소싱 후보 선택: 후보 1"));
    expect(all().getAttribute("aria-checked")).toBe("mixed");
    expect(host.querySelector('[aria-label="소싱 후보 정보"]')).toBeNull();
    await click(all()); expect(host.textContent).toContain("2개 선택");
    for (const id of ["3", "4", "5", "6"]) expect(checkbox(`소싱 후보 선택: 후보 ${id}`).disabled).toBe(true);
    await click(queue());
    expect(requests().map(call => call[2].candidateId)).toEqual(["1", "2"]);
    expect(requests().every(call => call[0] === "company" && call[1] === "project")).toBe(true);
    expect(host.textContent).toContain("수집 요청 2개 접수"); expect(host.textContent).toContain("0개 선택");
    expect(queue().disabled).toBe(true);
  });

  it("reports partial failure, refreshes uncertain submissions and never retries them automatically", async () => {
    const normal = mock.request.getMockImplementation(); let attempts = 0;
    mock.request.mockImplementation(async (...args) => {
      if (args[2].operation === "candidate-collect" && args[2].candidateId === "2") { attempts++; throw new ApiError("collection_not_configured", 409, {}); }
      return normal?.(...args);
    });
    await render(); await click(all()); await click(queue());
    expect(host.textContent).toContain("수집 요청 1개 접수 · 1개 확인 필요");
    expect(host.textContent).toContain("후보 2:"); expect(host.textContent).toContain("1개 선택");
    expect(checkbox("소싱 후보 선택: 후보 1").getAttribute("aria-checked")).toBe("false");
    expect(checkbox("소싱 후보 선택: 후보 2").getAttribute("aria-checked")).toBe("true"); expect(attempts).toBe(1);
    await click(queue()); expect(requests().map(call => call[2].candidateId)).toEqual(["1", "2", "2"]);
  });

  it("drops a failed response from selection when persisted readback shows it was already queued", async () => {
    const normal = mock.request.getMockImplementation();
    mock.request.mockImplementation(async (...args) => {
      if (args[2].operation === "candidate-collect") { await normal?.(...args); throw new Error("Response lost"); }
      return normal?.(...args);
    });
    await render(); await click(checkbox("소싱 후보 선택: 후보 1")); await click(queue());
    expect(host.textContent).toContain("1개 확인 필요"); expect(host.textContent).toContain("0개 선택");
    expect(queue().disabled).toBe(true); expect(requests()).toHaveLength(1);
  });

  it("blocks another submission and navigation until all selected requests settle", async () => {
    const normal = mock.request.getMockImplementation(); let release!: () => void;
    mock.request.mockImplementation(async (...args) => {
      if (args[2].operation === "candidate-collect" && args[2].candidateId === "1") await new Promise<void>(resolve => { release = resolve; });
      return normal?.(...args);
    });
    rows.push(...Array.from({ length: 14 }, (_, index) => candidate(String(7 + index), "queued")));
    await render(); await click(all()); await click(queue());
    const pending = button("수집 큐에 추가 중"); expect(pending.disabled).toBe(true);
    expect(all().disabled).toBe(true); expect(button("다음").disabled).toBe(true); expect(button("검색").disabled).toBe(true);
    expect([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].every(tab => tab.disabled)).toBe(true);
    await click(pending); expect(requests()).toHaveLength(1);
    await act(async () => release()); await settle(); expect(requests()).toHaveLength(2);
  });

  it("keeps selection within its page, query, company and project and excludes newly busy candidates", async () => {
    rows.push(...Array.from({ length: 14 }, (_, index) => candidate(String(7 + index), "queued")));
    await render(); await click(checkbox("소싱 후보 선택: 후보 1"));
    await click(button("다음")); expect(host.textContent).toContain("0개 선택");
    await click(checkbox("소싱 후보 선택: 후보 2"));
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('[aria-label="상품 검색 키워드"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "장스탠드"); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(mock.request).toHaveBeenCalledWith("company", "project", expect.objectContaining({ operation: "workspace", page: 1, query: "장스탠드" }));
    expect(host.textContent).toContain("0개 선택");
    await click(checkbox("소싱 후보 선택: 후보 1")); await render("other-company"); expect(host.textContent).toContain("0개 선택");
    await click(checkbox("소싱 후보 선택: 후보 2")); await render("other-company", "other-project"); expect(host.textContent).toContain("0개 선택");
    await click(checkbox("소싱 후보 선택: 후보 1")); rows[0].candidate!.collectionState = "collecting";
    await act(async () => cache.invalidateQueries({ queryKey: ["sourcing-catalog", "other-company", "other-project"] })); await settle();
    expect(host.textContent).toContain("0개 선택"); expect(queue().disabled).toBe(true); expect(requests()).toHaveLength(0);
  });
});
