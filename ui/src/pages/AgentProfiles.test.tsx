// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfiles } from "./AgentProfiles";
const mock = vi.hoisted(() => ({ companyId: "company", models: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), restore: vi.fn(), remove: vi.fn(), fromAgent: vi.fn(), navigate: vi.fn(), crumbs: vi.fn() }));
vi.mock("../api/agentProfiles", () => ({ agentProfilesApi: mock }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: mock.companyId }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mock.crumbs }) }));
vi.mock("@/lib/router", () => ({ useNavigate: () => mock.navigate }));
vi.mock("../api/adapters", () => ({ adaptersApi: { list: async () => [{ type: "codex_local", label: "Codex", loaded: true, disabled: false, capabilities: { supportsInstructionsBundle: true } }] } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: async () => [{ id: "existing-agent", name: "Existing", status: "idle" }], adapterModels: mock.models } }));
vi.mock("../api/companySkills", () => ({ companySkillsApi: { list: async () => [{ id: "skill", key: "sourcing", name: "상품 가공" }] } }));
const config = { capabilities: "옵션 검토", instructions: "# 상품 검토 지침", adapterType: "codex_local", runnerProvider: "codex", model: "gpt-6.1-sol", thinkingEffort: "", skills: ["sourcing"] };
const profile = { id: "profile", companyId: "company", name: "상품 가공 프로필", description: "옵션과 이미지를 검토합니다.", config, version: 2, linkedCount: 1,
  versions: [{ name: "Original", description: "", config, version: 1, createdAt: "2026-10-10" }, { name: "Current", description: "", config, version: 2, createdAt: "2026-10-10" }],
  bindings: [{ agentId: "agent", name: "가공 담당", status: "running", appliedVersion: 1, pendingVersion: 2, overrides: [], error: null }] };
describe("agent profile cards and linked editing", () => {
  let root: Root, cache: QueryClient, container: HTMLDivElement;
  beforeEach(() => { window.localStorage.clear(); vi.clearAllMocks(); mock.companyId = "company"; mock.models.mockResolvedValue([{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol", reasoningEfforts: ["low", "high", "ultra"] }, { id: "gpt-6-sol", label: "GPT-6-Sol", reasoningEfforts: ["low", "high"] }]); mock.list.mockResolvedValue([profile]); mock.get.mockResolvedValue(profile); mock.create.mockResolvedValue({ ...profile, id: "copy" }); mock.update.mockResolvedValue({ ...profile, version: 3 }); mock.restore.mockResolvedValue({ ...profile, version: 3 });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container); cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
  afterEach(() => { act(() => root.unmount()); cache.clear(); container.remove(); });
  async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); }); }
  async function render() { await act(async () => root.render(<QueryClientProvider client={cache}><AgentProfiles /></QueryClientProvider>)); await settle(); }
  async function click(text: string) { const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === text || b.textContent?.startsWith(text)); expect(button).toBeDefined(); await act(async () => button!.click()); await settle(); }
  async function fill(label: string, value: string) { const field = Array.from(document.querySelectorAll("label")).find(l => l.textContent === label)!.querySelector("input")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
  async function remount() { await act(async () => root.unmount()); root = createRoot(container); await render(); }
  async function radio(label: string) { const field = Array.from(container.querySelectorAll("label")).find(l => l.textContent === label)!.querySelector<HTMLInputElement>('input[type="radio"]')!; await act(async () => field.click()); await settle(); }
  it("shows short-role cards and selects full instructions/linked versions in the right panel", async () => { await render(); expect(container.textContent).toContain(profile.description); expect(container.textContent).not.toContain(config.instructions); await click(profile.name); const panel = container.querySelector('aside[aria-label="프로필 상세"]')!; expect(panel.textContent).toContain(config.instructions); expect(panel.textContent).toContain("가공 담당 · 적용 버전 1 · 버전 2 반영 대기"); });
  it("saves edits against a version and propagates only when the user selects the checkbox", async () => { await render(); await click(profile.name); await click("수정"); await fill("핵심 역할 설명", "새 역할 설명"); const checkbox = Array.from(container.querySelectorAll("label")).find(l => l.textContent?.includes("연결된 에이전트 1개에도 반영"))!.querySelector("input")!; await act(async () => checkbox.click()); await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle(); expect(mock.update).toHaveBeenCalledWith("company", "profile", expect.objectContaining({ expectedVersion: 2, applyToLinked: true, description: "새 역할 설명" })); });
  it("passes only profile identity and agent identity choices to the existing creation flow", async () => { await render(); await click(profile.name); await click("이 프로필로 에이전트 만들기"); await fill("에이전트 이름", "New processing agent"); await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); const url = mock.navigate.mock.calls[0][0] as string; expect(url).toContain("profileId=profile"); expect(url).toContain("profileVersion=2"); expect(url).not.toContain("instructions"); });
  it("surfaces stale-save conflicts without closing the editor", async () => { mock.update.mockRejectedValue(new Error("프로필이 변경되었습니다. 새로 조회해 주세요.")); await render(); await click(profile.name); await click("수정"); await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle(); expect(container.querySelector("form")).not.toBeNull(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("프로필이 변경"); });
  it("restores an unfinished new profile after leaving for another menu and returning", async () => {
    await render(); await click("프로필 추가");
    await fill("프로필 이름", "소싱 가공 담당");
    await fill("핵심 역할 설명", "옵션과 이미지를 가공합니다.");
    await remount();
    const name = Array.from(container.querySelectorAll("label")).find(l => l.textContent === "프로필 이름")?.querySelector("input");
    expect(name?.value).toBe("소싱 가공 담당");
    expect(container.textContent).toContain("임시 저장된 내용을 복원했습니다.");
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("omits role/title fields and saves the selected discovered model radio", async () => {
    await render(); await click("프로필 추가"); await fill("프로필 이름", "새 프로필");
    const labels = Array.from(container.querySelectorAll("label")).map(l => l.textContent);
    expect(labels).not.toContain("역할"); expect(labels).not.toContain("직책");
    expect(container.querySelector("datalist")).toBeNull();
    await radio("GPT-6-Sol");
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(mock.create).toHaveBeenCalledWith("company", expect.objectContaining({ config: expect.objectContaining({ model: "gpt-6-sol" }) }));
    expect(mock.create.mock.calls[0][1].config).not.toHaveProperty("role");
    expect(mock.create.mock.calls[0][1].config).not.toHaveProperty("title");
    await remount(); expect(container.querySelector("form")).toBeNull();
  });
  it("keeps the edit identity, skills, base version and propagation choice across navigation", async () => {
    await render(); await click(profile.name); await click("수정");
    await fill("핵심 역할 설명", "임시 편집");
    const checkbox = Array.from(container.querySelectorAll("label")).find(l => l.textContent?.includes("연결된 에이전트 1개에도 반영"))!.querySelector("input")!;
    await act(async () => checkbox.click()); await click("임시 저장");
    expect(mock.update).not.toHaveBeenCalled(); await remount();
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle(); expect(mock.update).toHaveBeenCalledWith("company", "profile", expect.objectContaining({ expectedVersion: 2, applyToLinked: true, description: "임시 편집", config: expect.objectContaining({ skills: ["sourcing"] }) }));
  });
  it("keeps a failed save draft and clears it only on explicit cancellation", async () => {
    mock.update.mockRejectedValue(new Error("저장 실패"));
    await render(); await click(profile.name); await click("수정"); await fill("핵심 역할 설명", "보존할 편집");
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle(); await remount();
    expect(container.querySelector("form")).not.toBeNull();
    const description = Array.from(container.querySelectorAll("label")).find(l => l.textContent === "핵심 역할 설명")!.querySelector("input")!;
    expect(description.value).toBe("보존할 편집");
    await click("취소"); await remount(); expect(container.querySelector("form")).toBeNull();
  });
  it("isolates unfinished profiles by company and preserves drafts with no name yet", async () => {
    await render(); await click("프로필 추가"); await fill("핵심 역할 설명", "첫 회사 초안");
    mock.companyId = "other-company"; await render(); expect(container.querySelector("form")).toBeNull();
    await click("프로필 추가"); await fill("프로필 이름", "다른 회사 초안");
    mock.companyId = "company"; await render();
    const description = Array.from(container.querySelectorAll("label")).find(l => l.textContent === "핵심 역할 설명")!.querySelector("input")!;
    expect(description.value).toBe("첫 회사 초안");
    expect(Array.from(container.querySelectorAll("input")).some(i => i.value === "다른 회사 초안")).toBe(false);
  });
  it("refreshes radio options and retains manual model IDs when catalog loading fails", async () => {
    await render(); await click("프로필 추가");
    mock.models.mockResolvedValue([{ id: "new-model", label: "New model" }]);
    await click("모델 새로고침"); expect(container.textContent).toContain("New model");
    await radio("모델 ID 직접 입력"); await fill("모델 ID", "custom-model");
    mock.models.mockRejectedValue(new Error("catalog unavailable"));
    await click("모델 새로고침");
    expect(container.textContent).toContain("모델 목록을 불러오지 못했습니다");
    await remount();
    const model = Array.from(container.querySelectorAll("label")).find(l => l.textContent === "모델 ID")!.querySelector("input")!;
    expect(model.value).toBe("custom-model");
  });
  it("surfaces unavailable draft storage instead of claiming it saved", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    try { await render(); await click("프로필 추가"); await click("임시 저장"); expect(container.textContent).toContain("임시 저장을 할 수 없습니다"); }
    finally { vi.restoreAllMocks(); }
  });
  it("saves the discovered effort and restores it with the unfinished profile", async () => {
    await render(); await click("프로필 추가"); await fill("프로필 이름", "추론 프로필"); await radio("GPT-6.1-Sol"); await radio("ultra");
    await remount();
    expect(container.querySelector<HTMLInputElement>('input[name="profile-effort"][value="ultra"]')?.checked).toBe(true);
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(mock.create).toHaveBeenCalledWith("company", expect.objectContaining({ config: expect.objectContaining({ thinkingEffort: "ultra" }) }));
  });
  it("clears an incompatible effort only when selecting another model", async () => {
    await render(); await click("프로필 추가"); await radio("GPT-6.1-Sol"); await radio("ultra"); await radio("GPT-6-Sol");
    expect(container.querySelector('input[name="profile-effort"][value="ultra"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="profile-effort"][value=""]')?.checked).toBe(true);
    await radio("high"); mock.models.mockRejectedValue(new Error("unavailable")); await click("모델 새로고침"); await remount();
    expect(container.querySelector<HTMLInputElement>('input[name="profile-effort"][value="high"]')?.checked).toBe(true);
  });
});
