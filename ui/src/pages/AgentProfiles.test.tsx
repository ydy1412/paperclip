// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfiles } from "./AgentProfiles";
const mock = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), restore: vi.fn(), remove: vi.fn(), fromAgent: vi.fn(), navigate: vi.fn(), crumbs: vi.fn() }));
vi.mock("../api/agentProfiles", () => ({ agentProfilesApi: mock }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mock.crumbs }) }));
vi.mock("@/lib/router", () => ({ useNavigate: () => mock.navigate }));
vi.mock("../api/adapters", () => ({ adaptersApi: { list: async () => [{ type: "codex_local", label: "Codex", loaded: true, disabled: false, capabilities: { supportsInstructionsBundle: true } }] } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: async () => [{ id: "existing-agent", name: "Existing", status: "idle" }], adapterModels: async () => [{ id: "gpt-6.1-sol", label: "GPT" }] } }));
vi.mock("../api/companySkills", () => ({ companySkillsApi: { list: async () => [{ id: "skill", key: "sourcing", name: "상품 가공" }] } }));
const config = { role: "general", title: "상품 담당", capabilities: "옵션 검토", instructions: "# 상품 검토 지침", adapterType: "codex_local", runnerProvider: "codex", model: "gpt-6.1-sol", skills: ["sourcing"] };
const profile = { id: "profile", companyId: "company", name: "상품 가공 프로필", description: "옵션과 이미지를 검토합니다.", config, version: 2, linkedCount: 1,
  versions: [{ name: "Original", description: "", config, version: 1, createdAt: "2026-10-10" }, { name: "Current", description: "", config, version: 2, createdAt: "2026-10-10" }],
  bindings: [{ agentId: "agent", name: "가공 담당", status: "running", appliedVersion: 1, pendingVersion: 2, overrides: [], error: null }] };
describe("agent profile cards and linked editing", () => {
  let root: Root, cache: QueryClient, container: HTMLDivElement;
  beforeEach(() => { vi.clearAllMocks(); mock.list.mockResolvedValue([profile]); mock.get.mockResolvedValue(profile); mock.create.mockResolvedValue({ ...profile, id: "copy" }); mock.update.mockResolvedValue({ ...profile, version: 3 }); mock.restore.mockResolvedValue({ ...profile, version: 3 });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container); cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
  afterEach(() => { act(() => root.unmount()); cache.clear(); container.remove(); });
  async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); }); }
  async function render() { await act(async () => root.render(<QueryClientProvider client={cache}><AgentProfiles /></QueryClientProvider>)); await settle(); }
  async function click(text: string) { const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === text || b.textContent?.startsWith(text)); expect(button).toBeDefined(); await act(async () => button!.click()); await settle(); }
  async function fill(label: string, value: string) { const field = Array.from(document.querySelectorAll("label")).find(l => l.textContent === label)!.querySelector("input")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
  it("shows short-role cards and selects full instructions/linked versions in the right panel", async () => { await render(); expect(container.textContent).toContain(profile.description); expect(container.textContent).not.toContain(config.instructions); await click(profile.name); const panel = container.querySelector('aside[aria-label="프로필 상세"]')!; expect(panel.textContent).toContain(config.instructions); expect(panel.textContent).toContain("가공 담당 · 적용 버전 1 · 버전 2 반영 대기"); });
  it("saves edits against a version and propagates only when the user selects the checkbox", async () => { await render(); await click(profile.name); await click("수정"); await fill("핵심 역할 설명", "새 역할 설명"); const checkbox = Array.from(container.querySelectorAll("label")).find(l => l.textContent?.includes("연결된 에이전트 1개에도 반영"))!.querySelector("input")!; await act(async () => checkbox.click()); await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle(); expect(mock.update).toHaveBeenCalledWith("company", "profile", expect.objectContaining({ expectedVersion: 2, applyToLinked: true, description: "새 역할 설명" })); });
  it("passes only profile identity and agent identity choices to the existing creation flow", async () => { await render(); await click(profile.name); await click("이 프로필로 에이전트 만들기"); await fill("에이전트 이름", "New processing agent"); await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); const url = mock.navigate.mock.calls[0][0] as string; expect(url).toContain("profileId=profile"); expect(url).toContain("profileVersion=2"); expect(url).not.toContain("instructions"); });
  it("surfaces stale-save conflicts without closing the editor", async () => { mock.update.mockRejectedValue(new Error("프로필이 변경되었습니다. 새로 조회해 주세요.")); await render(); await click(profile.name); await click("수정"); await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle(); expect(container.querySelector("form")).not.toBeNull(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("프로필이 변경"); });
});
