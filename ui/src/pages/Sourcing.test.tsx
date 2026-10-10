// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sourcing } from "./Sourcing";
import { SourcingSidebar } from "../components/SourcingSidebar";
import { ApiError } from "../api/client";

const mock = vi.hoisted(() => ({ company: "company", mobile: false, closeSidebar: vi.fn(), projects: vi.fn(), breadcrumbs: vi.fn(), forwarders: vi.fn() }));
vi.mock("../api/sourcing", () => ({ sourcingApi: { plugin: async () => null }, sourcingForwardersApi: { list: mock.forwarders } }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mock.breadcrumbs }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: mock.company, selectedCompany: { issuePrefix: "DOB" } }) }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: mock.mobile, collapsed: true, peeking: false, setSidebarOpen: mock.closeSidebar }) }));
vi.mock("../hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: false }) }));
vi.mock("../api/projects", () => ({ projectsApi: { list: mock.projects } }));

function Location() {
  const location = useLocation();
  return <output data-location>{location.pathname}{location.search}</output>;
}

describe("Shopping mall Settings-style workspace", () => {
  let root: Root;
  let container: HTMLDivElement;
  let cache: QueryClient;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mock.forwarders.mockResolvedValue([]);
    mock.company = "company";
    mock.mobile = false;
    mock.projects.mockResolvedValue([{ id: "project", name: "Auto Sourcing" }, { id: "second", name: "Second project" }]);
    container = document.createElement("div");
    document.body.appendChild(container);
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    cache.clear();
    container.remove();
  });

  async function render(url = "/DOB/sourcing?project=project") {
    await act(async () => root.render(
      <MemoryRouter initialEntries={[url]}><QueryClientProvider client={cache}>
        <SourcingSidebar /><Sourcing /><Location />
      </QueryClientProvider></MemoryRouter>,
    ));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }

  it("renders vertical workflow links in order, with readable labels even beside a collapsed rail", async () => {
    await render();
    const nav = container.querySelector('nav[aria-label="쇼핑몰 관리"]')!;
    const links = [...nav.querySelectorAll("a")];
    expect(links.map(link => link.textContent)).toEqual(["소싱", "상품 업로드", "주문", "쇼핑몰 관리 설정"]);
    expect(links[0].getAttribute("aria-current")).toBe("page");
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(nav.querySelector(".sr-only")).toBeNull();
    expect(container.querySelector('section[aria-label="쇼핑몰 관리"] h1')?.textContent).toBe("소싱");
    expect(container.textContent).toContain("상품 가공 서비스 미연결");
    expect(container.textContent).not.toContain("예시 데이터");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("changes workflow and breadcrumb without losing the selected project", async () => {
    await render();
    await act(async () => (container.querySelector('nav[aria-label="쇼핑몰 관리"] a:nth-child(2)') as HTMLAnchorElement).click());
    expect(container.querySelector("h1")?.textContent).toBe("상품 업로드");
    expect(container.querySelector("[data-location]")?.textContent).toContain("project=project");
    expect(container.querySelector("[data-location]")?.textContent).toContain("view=uploads");
    expect(mock.breadcrumbs).toHaveBeenLastCalledWith([{ label: "쇼핑몰 관리", href: "/sourcing" }, { label: "상품 업로드" }]);
    expect(container.textContent).toContain("등록 상품을 공통 상품별로 관리합니다.");
  });

  it("restores the orders view from its URL and shows no fabricated totals or registration controls", async () => {
    await render("/DOB/sourcing?project=project&view=orders");
    expect(container.querySelector("h1")?.textContent).toBe("주문");
    expect(container.textContent).toContain("주문 데이터 미연결");
    expect(container.textContent).not.toContain("0개");
    expect(container.textContent).not.toContain("등록하기");
    expect(container.querySelector("table")).toBeNull();
  });

  it("uses real company projects and retains the active workflow when selecting one", async () => {
    await render("/DOB/sourcing?project=project&view=orders");
    expect(mock.projects).toHaveBeenCalledWith("company");
    const select = container.querySelector('select[aria-label="프로젝트"]') as HTMLSelectElement;
    expect(select.value).toBe("project");
    await act(async () => { select.value = "second"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelector("[data-location]")?.textContent).toContain("project=second");
    expect(container.querySelector("[data-location]")?.textContent).toContain("view=orders");
  });

  it("falls back to sourcing for an unknown workflow", async () => {
    await render("/DOB/sourcing?view=unrecognized");
    expect(container.querySelector("h1")?.textContent).toBe("소싱");
  });

  it("shows access denial without rendering project names", async () => {
    mock.projects.mockRejectedValue(new ApiError("Forbidden", 403, null));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("프로젝트 조회 권한 없음");
    expect(container.textContent).not.toContain("Second project");
    expect(container.querySelector("table")).toBeNull();
  });

  it("does not request projects without a selected company", async () => {
    mock.company = "";
    await render();
    expect(mock.projects).not.toHaveBeenCalled();
    expect(container.textContent).toContain("회사 미선택");
  });

  it("closes the mobile shell drawer after selecting a workflow", async () => {
    mock.mobile = true;
    await render();
    await act(async () => (container.querySelector('nav[aria-label="쇼핑몰 관리"] a:nth-child(3)') as HTMLAnchorElement).click());
    expect(mock.closeSidebar).toHaveBeenCalledWith(false);
    expect(container.querySelector("h1")?.textContent).toBe("주문");
  });
  it("clears workflow-specific filters/detail but retains project on sidebar navigation", async () => {
    await render("/DOB/sourcing?project=project&view=orders&state=Shipping&account=seller&page=2&q=123&item=shipment&source=Taobao&validation=incomplete&data=live");
    await act(async () => (container.querySelector('nav[aria-label="쇼핑몰 관리"] a:nth-child(2)') as HTMLAnchorElement).click());
    expect(container.querySelector("[data-location]")?.textContent).toBe("/DOB/sourcing?project=project&view=uploads");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });
  it("retains filters and selection when clicking the already active workflow", async () => {
    const url = "/DOB/sourcing?project=project&view=sourcing&source=Taobao&item=example-product-1";
    await render(url);
    await act(async () => (container.querySelector('nav[aria-label="쇼핑몰 관리"] a:first-child') as HTMLAnchorElement).click());
    expect(container.querySelector("[data-location]")?.textContent).toBe(url);
  });
  it("opens settings below orders, clears order filters and renders inline forwarder administration", async () => {
    await render("/DOB/sourcing?project=project&view=orders&state=Preparing&account=seller&page=2&q=123&item=shipment&from=2026-10-01&to=2026-10-09");
    await act(async () => (container.querySelector('nav[aria-label="쇼핑몰 관리"] a:nth-child(4)') as HTMLAnchorElement).click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(container.querySelector("[data-location]")?.textContent).toBe("/DOB/sourcing?project=project&view=settings");
    expect(container.querySelector("h1")?.textContent).toBe("쇼핑몰 관리 설정");
    expect(container.querySelector('section[aria-label="배송대행지 관리"]')).not.toBeNull();
    expect(container.textContent).toContain("배송대행지 추가");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mock.forwarders).toHaveBeenCalledWith("company", "project");
    expect(mock.breadcrumbs).toHaveBeenLastCalledWith([{ label: "쇼핑몰 관리", href: "/sourcing" }, { label: "쇼핑몰 관리 설정" }]);
  });
  it("restores settings from URL and scopes its list to the changed project", async () => {
    await render("/DOB/sourcing?project=project&view=settings");
    expect(mock.forwarders).toHaveBeenCalledWith("company", "project");
    const select = container.querySelector('select[aria-label="프로젝트"]') as HTMLSelectElement;
    await act(async () => { select.value = "second"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mock.forwarders).toHaveBeenLastCalledWith("company", "second");
    expect(container.querySelector("h1")?.textContent).toBe("쇼핑몰 관리 설정");
  });
  it("does not request forwarders for an unavailable project", async () => {
    await render("/DOB/sourcing?project=unknown&view=settings");
    expect(mock.forwarders).not.toHaveBeenCalled();
    expect(container.textContent).toContain("배송대행지를 관리할 프로젝트를 선택해 주세요.");
  });

});
