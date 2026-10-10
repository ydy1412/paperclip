// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcingCatalogPreview } from "./SourcingCatalogPreview";

const native = vi.hoisted(() => ({ plugin: vi.fn(), data: vi.fn(), sync: vi.fn() }));
vi.mock("../api/sourcing", () => ({ sourcingApi: native }));
function Location() { const location = useLocation(); return <output data-location>{location.search}</output>; }

describe("Sourcing and upload example workspaces", () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  async function render(view: "sourcing" | "uploads" = "sourcing", query = "", projectId = "project", companyId = "company") {
    await act(async () => root.render(<MemoryRouter key={`${companyId}:${projectId}:${view}:${query}`} initialEntries={[`/DOB/sourcing?project=${projectId}&view=${view}${query}`]}><SourcingCatalogPreview key={`${companyId}:${projectId}:${view}`} view={view} projectId={projectId} companyId={companyId} /><Location /></MemoryRouter>));
  }
  const location = () => new URLSearchParams(container.querySelector("[data-location]")?.textContent ?? "");
  const text = () => container.textContent ?? "";
  async function click(selector: string) { await act(async () => (container.querySelector(selector) as HTMLElement).click()); }
  async function select(label: string, value: string) {
    const field = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    await act(async () => { field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  async function tab(name: string) {
    const trigger = [...container.querySelectorAll('[role="tab"]')].find(node => node.textContent === name) as HTMLElement;
    await act(async () => trigger.focus());
  }
  it.each(["sourcing", "uploads"] as const)("identifies %s examples without native reads or marketplace actions", async view => {
    await render(view);
    expect(text()).toContain("예시 데이터");
    expect(text()).toContain(view === "sourcing" ? "상품 수집 미연결" : "상품 등록 미연결");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(view === "sourcing" ? 4 : 3);
    expect(native.plugin).not.toHaveBeenCalled(); expect(native.data).not.toHaveBeenCalled(); expect(native.sync).not.toHaveBeenCalled();
    expect([...container.querySelectorAll("button")].some(button => /등록하기|수집 시작/.test(button.textContent ?? ""))).toBe(false);
  });
  it.each(["sourcing", "uploads"] as const)("selects %s rows independently from opening detail", async view => {
    await render(view);
    await click('tbody [role="checkbox"]');
    expect(location().has("item")).toBe(false);
    expect(container.querySelector('[aria-label="현재 목록 전체 선택"]')?.getAttribute("aria-checked")).toBe("mixed");
    await click('[aria-label="현재 목록 전체 선택"]');
    expect(container.querySelectorAll('tbody [aria-checked="true"]')).toHaveLength(view === "sourcing" ? 4 : 3);
    await click('[aria-label="선택 해제"]');
    expect(container.querySelectorAll('tbody [aria-checked="true"]')).toHaveLength(0);
  });
  it("combines source/state filters and resets them without losing the project", async () => {
    await render();
    await select("소싱 출처", "Taobao"); await select("수집 상태", "ready");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(text()).toContain("데스크 케이블 정리함");
    await click('[aria-label="필터 초기화"]');
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(location().get("project")).toBe("project");
    expect(location().has("source")).toBe(false);
  });
  it("searches product names and distinguishes no results from actual empty data", async () => {
    await render("sourcing", "&q=파우치");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    const input = container.querySelector('input[aria-label="상품 검색"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "없는상품"); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click('[aria-label="상품 검색 실행"]');
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(text()).toContain("조건에 맞는 예시 상품 없음");
    expect((container.querySelector('[aria-label="현재 목록 전체 선택"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it("opens product information/options/source tabs and closes without losing filters", async () => {
    await render("sourcing", "&source=Taobao");
    await click("tbody tr td:nth-child(3)");
    expect(location().get("item")).toBe("example-product-1");
    expect(container.querySelector('[aria-label="소싱 상품 상세"] dl')?.textContent).toContain("18.5 CNY");
    await tab("옵션"); expect(container.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toContain("화이트 · 대형");
    await tab("원문"); expect(container.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toContain("원문 근거 미연결");
    await click('[aria-label="상품 상세 닫기"]');
    expect(location().get("source")).toBe("Taobao"); expect(location().has("item")).toBe(false);
  });
  it("restores a stored URL selection with an accessible native product button", async () => {
    await render("sourcing", "&item=example-product-2");
    expect(container.querySelector('[aria-label="소싱 상품 상세"] h3')?.textContent).toBe("실리콘 컵 홀더");
    expect(container.querySelector('tbody tr button:not([role="checkbox"])')?.getAttribute("type")).toBe("button");
  });
  it("filters upload accounts and shows validation issues without invented registration history", async () => {
    await render("uploads"); await select("판매 계정", "smartstore");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    await click("tbody tr td:nth-child(4)");
    expect(location().get("item")).toBe("example-upload-3");
    await tab("검증 항목"); expect(container.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toContain("고시 정보 미입력");
    await tab("등록 이력"); expect(container.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toBe("등록 이력 없음");
    expect(native.data).not.toHaveBeenCalled(); expect(native.sync).not.toHaveBeenCalled();
  });
  it("filters validation independently and clears detail", async () => {
    await render("uploads", "&item=example-upload-1"); await select("검증 상태", "complete");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(location().has("item")).toBe(false);
    await select("검증 상태", "incomplete"); expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
  });
  it("switches to the unconnected actual-data state and clears example selection", async () => {
    await render(); await click('tbody [role="checkbox"]');
    const actual = [...container.querySelectorAll("button")].find(node => node.textContent === "실제 데이터")!;
    await act(async () => actual.click());
    expect(text()).toContain("상품 데이터 미연결"); expect(container.querySelector("table")).toBeNull();
    expect(location().get("data")).toBe("live");
    const examples = [...container.querySelectorAll("button")].find(node => node.textContent === "예시 데이터")!;
    await act(async () => examples.click());
    expect(container.querySelectorAll('tbody [aria-checked="true"]')).toHaveLength(0);
  });
  it("reports invalid item URLs without treating them as real products", async () => {
    await render("uploads", "&item=not-a-real-item");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("예시 항목을 찾을 수 없습니다");
    expect(container.querySelector('[aria-label="업로드 초안 상세"] dl')).toBeNull();
  });
  it("resets bulk selection when project or company scope changes", async () => {
    await render(); await click('tbody [role="checkbox"]');
    await render("sourcing", "", "other-project"); expect(container.querySelectorAll('tbody [aria-checked="true"]')).toHaveLength(0);
    await click('tbody [role="checkbox"]');
    await render("sourcing", "", "other-project", "other-company"); expect(container.querySelectorAll('tbody [aria-checked="true"]')).toHaveLength(0);
  });
  it.each(["sourcing", "uploads"] as const)("renders local labelled example thumbnails in %s", async view => {
    await render(view);
    const images = [...container.querySelectorAll<HTMLImageElement>("tbody img")];
    expect(images).toHaveLength(view === "sourcing" ? 4 : 3);
    expect(images.every(image => image.getAttribute("src")?.startsWith("/sourcing-examples/") && image.alt.includes("AI 생성 예시"))).toBe(true);
  });
  it("changes gallery views and enlarges the selected image without opening a remote page", async () => {
    await render("sourcing", "&item=example-product-1");
    await click('[aria-label="이미지 보기: 내부"]');
    expect(container.querySelector('[aria-label="상품 이미지 갤러리"] img')?.getAttribute("src")).toContain("cable-box-open.png");
    await click('[aria-label="상품 이미지 확대"]');
    expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toContain("cable-box-open.png");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("AI 생성 예시");
    await act(async () => (document.querySelector('[aria-label="이미지 확대 닫기"]') as HTMLElement).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(location().get("item")).toBe("example-product-1");
  });
  it("changes and clears an upload representative image with truthful input checks", async () => {
    await render("uploads", "&item=example-upload-1");
    await click('[aria-label="대표 이미지 선택: 내부"]');
    expect(container.querySelector("tbody tr:first-child img")?.getAttribute("src")).toContain("cable-box-open.png");
    await tab("검증 항목");
    expect(container.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toContain("AI 생성 예시 이미지 선택");
    await click('[aria-label="대표 이미지 선택 해제"]');
    expect(container.querySelector("tbody tr:first-child img")).toBeNull();
    expect(container.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toContain("대표 이미지 미선택");
    expect(native.data).not.toHaveBeenCalled();
  });
  it("reports failed assets without collapsing their frame or passing image checks", async () => {
    await render("uploads", "&item=example-upload-1");
    await act(async () => container.querySelector("tbody tr:first-child img")?.dispatchEvent(new Event("error")));
    expect(container.querySelector("tbody tr:first-child img")).toBeNull();
    expect(container.querySelector('[aria-label="상품 이미지 갤러리"]')?.textContent).toContain("이미지 로딩 실패");
    await tab("검증 항목");
    expect(container.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toContain("대표 이미지 미선택 또는 로딩 실패");
  });
  it("keeps each upload choice independent and resets preview state at context changes", async () => {
    await render("uploads", "&item=example-upload-1");
    await click('[aria-label="대표 이미지 선택: 내부"]');
    await click("tbody tr:nth-child(2)");
    expect(container.querySelector('[aria-label="상품 이미지 갤러리"] img')?.getAttribute("src")).toContain("cup-holder.png");
    await click("tbody tr:first-child");
    expect(container.querySelector('[aria-label="상품 이미지 갤러리"] img')?.getAttribute("src")).toContain("cable-box-open.png");
    await render("uploads", "&item=example-upload-1", "other-project");
    expect(container.querySelector("tbody tr:first-child img")?.getAttribute("src")).toContain("cable-box.png");
    await click('[aria-label="대표 이미지 선택: 내부"]');
    await render("sourcing", "&item=example-product-1", "other-project");
    expect(container.querySelector('[aria-label="상품 이미지 갤러리"] img')?.getAttribute("src")).toContain("cable-box.png");
  });
  it.each([["", "company"], ["project", ""]])("requires project and company scope (%s, %s)", async (project, company) => {
    await render("sourcing", "", project, company);
    expect(text()).toContain("프로젝트 선택"); expect(container.querySelector("table")).toBeNull();
  });
});
