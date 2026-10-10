// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Marketing } from "./Marketing";
import { ApiError } from "../api/client";

const mock = vi.hoisted(() => ({ company: "co", connectionChecks: vi.fn(), requestConnectionChecks: vi.fn(), setConnectionMonitor: vi.fn(), overview: vi.fn(), media: vi.fn(), queue: vi.fn(), createDraft: vi.fn(), updateDraft: vi.fn(), projects: vi.fn(), cancel: vi.fn(), checkAccount: vi.fn(), generationInstructions: vi.fn(), importGenerated: vi.fn(), dispatch: vi.fn(), reconcile: vi.fn(), retry: vi.fn(), resumeProfile: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: mock.company }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("../api/marketing", () => ({ marketingApi: mock }));
vi.mock("../api/projects", () => ({ projectsApi: { list: mock.projects } }));
const profile = { id: "profile", companyId: "co", projectId: "project", name: "업무 프로필", asideAccountId: "u1", browserProfileName: "Profile 1", enabled: true };
const channel = { id: "channel", companyId: "co", projectId: "project", profileId: "profile", name: "개발 블로그", platform: "naver_blog", accountId: "my_blog", accountUrl: "https://blog.naver.com/my_blog", concept: "개발 기록", tone: "차분함", audience: "개발자", writingRules: "근거 링크 포함", enabled: true };
const draft = { id: "draft", companyId: "co", projectId: "project", channelId: "channel", topic: "배포 경험", content: { title: "첫 배포", body: "승인 전 본문", media: [] }, revision: 3 };
const second = { ...draft, id: "second", revision: 5, content: { ...draft.content, title: "두 번째 글", body: "두 번째 본문" } };
const job = { id: "job", projectId: "project", profileId: "profile", channelId: "channel", draftId: "draft", revision: 3, status: "queued", updatedAt: "2026-10-07T00:00:00Z" };
const overview = { profiles: [profile], channels: [channel], drafts: [draft], jobs: [] as typeof job[], publicationEnabled: true, publicationCapabilities: { platforms: ["naver_blog", "linkedin", "instagram"], media: true } };
let root: Root, container: HTMLDivElement, cache: QueryClient;
async function waitFor(assertion: () => void) { for (let i = 0; i < 100; i++) { try { assertion(); return; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } } assertion(); }
function render(path = "/marketing?project=project&profile=profile&channel=channel&draft=draft") {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  root = createRoot(container); flushSync(() => root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={cache}><Marketing /></QueryClientProvider></MemoryRouter>));
}
function click(text: string) { const button = [...document.querySelectorAll("button")].find(button => button.textContent === text || button.getAttribute("aria-label") === text); expect(button).toBeDefined(); flushSync(() => button!.click()); }
function check(title: string) { const field = container.querySelector(`[aria-label="발행 선택: ${title}"]`) as HTMLInputElement; expect(field).not.toBeNull(); flushSync(() => field.click()); }
function update(value: unknown) { flushSync(() => cache.setQueryData(["marketing", "co"], value)); }
function publishButton() { return [...container.querySelectorAll("button")].find(button => button.textContent === "발행")!; }
beforeEach(() => {
  vi.resetAllMocks(); mock.company = "co"; container = document.createElement("div"); document.body.appendChild(container);
  mock.overview.mockResolvedValue(overview); mock.projects.mockResolvedValue([{ id: "project", name: "콘텐츠 프로젝트" }]); mock.media.mockResolvedValue([]);
  mock.connectionChecks.mockResolvedValue({ jobs: [], monitor: { enabled: false }, connections: [{ channelId: "channel", status: "unknown" }] });
  mock.requestConnectionChecks.mockResolvedValue({ jobs: [{ id: "check", channelId: "channel", status: "queued" }] });
  mock.setConnectionMonitor.mockResolvedValue({ enabled: true }); mock.queue.mockResolvedValue([]); mock.dispatch.mockResolvedValue([]);
});
afterEach(() => { if (root) flushSync(() => root.unmount()); cache?.clear(); container.remove(); vi.restoreAllMocks(); });

describe("Marketing submitted-post workspace", () => {
  it("shows list and read-only details with exactly one publish action, no authoring toolbar", async () => {
    render(); await waitFor(() => expect(container.querySelector('[aria-label="선택한 글 상세"]')?.textContent).toContain("승인 전 본문"));
    expect(container.querySelector('[aria-label="등록된 글 목록"]')).not.toBeNull();
    expect([...container.querySelectorAll("button")].filter(button => button.textContent === "발행")).toHaveLength(1);
    expect(publishButton().disabled).toBe(true);
    for (const text of ["초안", "새 초안", "초안 제작", "저장", "선택 발행", "발행 대기열"]) expect([...container.querySelectorAll("button")].some(button => button.textContent === text)).toBe(false);
    expect(container.querySelector("textarea")).toBeNull(); expect(mock.createDraft).not.toHaveBeenCalled(); expect(mock.updateDraft).not.toHaveBeenCalled();
  });
  it("switches details without losing checked posts", async () => {
    mock.overview.mockResolvedValue({ ...overview, drafts: [draft, second] });
    render(); await waitFor(() => expect(container.querySelector('[aria-label="발행 선택: 첫 배포"]')).not.toBeNull());
    check("첫 배포"); click("글 상세: 두 번째 글");
    await waitFor(() => expect(container.querySelector('[aria-label="선택한 글 상세"]')?.textContent).toContain("두 번째 본문"));
    expect((container.querySelector('[aria-label="발행 선택: 첫 배포"]') as HTMLInputElement).checked).toBe(true);
    expect(container.textContent).toContain("1개 선택"); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("selects all eligible visible posts and tracks partial selection", async () => {
    mock.overview.mockResolvedValue({ ...overview, drafts: [draft, second, { ...draft, id: "published", content: { ...draft.content, title: "발행된 글" } }], jobs: [{ ...job, draftId: "published", status: "published" }] });
    render(); await waitFor(() => expect(container.textContent).toContain("발행된 글"));
    const all = container.querySelector('[aria-label="발행 가능한 글 전체 선택"]') as HTMLInputElement;
    check("첫 배포"); expect(all.indeterminate).toBe(true);
    flushSync(() => all.click()); expect(container.textContent).toContain("2개 선택");
    expect((container.querySelector('[aria-label="발행 선택: 발행된 글"]') as HTMLInputElement).checked).toBe(false);
    flushSync(() => all.click()); expect(container.textContent).toContain("0개 선택"); expect(publishButton().disabled).toBe(true);
  });
  it("captures exact checked revisions and dispatches only returned jobs after approval", async () => {
    mock.overview.mockResolvedValue({ ...overview, drafts: [draft, second] }); mock.queue.mockResolvedValue([{ ...job, id: "approved-job" }, { ...job, id: "approved-second", draftId: "second", revision: 5 }]);
    render(); await waitFor(() => expect(container.textContent).toContain("두 번째 글"));
    check("첫 배포"); check("두 번째 글"); click("발행"); expect(mock.queue).not.toHaveBeenCalled(); expect(mock.dispatch).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("승인 전 본문"); expect(dialog.textContent).toContain("두 번째 본문"); expect(dialog.textContent).toContain("my_blog");
    click("승인하고 Aside에 발행 요청");
    await waitFor(() => expect(mock.dispatch).toHaveBeenCalledWith("co", "project", ["approved-job", "approved-second"]));
    expect(mock.queue).toHaveBeenCalledWith("co", { drafts: [{ id: "draft", revision: 3 }, { id: "second", revision: 5 }] });
  });
  it("does not publish when the confirmation is cancelled", async () => {
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포"));
    check("첫 배포"); click("발행"); click("취소"); expect(mock.queue).not.toHaveBeenCalled(); expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it.each(["revision", "body", "account", "profile", "disabled", "job"])("invalidates confirmation when %s changes without replacing reviewed content", async kind => {
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포")); check("첫 배포"); click("발행");
    const changed = { ...overview, drafts: [{ ...draft, revision: kind === "revision" ? 4 : 3, content: kind === "body" ? { ...draft.content, body: "변경된 본문" } : draft.content }], channels: [{ ...channel, accountId: kind === "account" ? "other" : channel.accountId, enabled: kind !== "disabled" }], profiles: [{ ...profile, browserProfileName: kind === "profile" ? "Profile 2" : profile.browserProfileName }], jobs: kind === "job" ? [job] : [] };
    update(changed); await waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain("다시 확인하십시오"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("승인 전 본문");
    expect([...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "승인하고 Aside에 발행 요청")?.hasAttribute("disabled")).toBe(true);
    expect(mock.queue).not.toHaveBeenCalled();
  });
  it("retains selections and reviewed content after a queue rejection", async () => {
    mock.queue.mockRejectedValue(new Error("버전 충돌")); render(); await waitFor(() => expect(container.textContent).toContain("첫 배포")); check("첫 배포"); click("발행"); click("승인하고 Aside에 발행 요청");
    await waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain("버전 충돌"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("승인 전 본문"); expect(mock.dispatch).not.toHaveBeenCalled(); expect(container.textContent).toContain("1개 선택");
  });
  it("keeps a queued record on dispatch failure and never automatically repeats it", async () => {
    mock.queue.mockResolvedValue([job]); mock.dispatch.mockRejectedValue(new Error("응답 유실"));
    mock.overview.mockResolvedValueOnce(overview).mockResolvedValue({ ...overview, jobs: [job] });
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포")); check("첫 배포"); click("발행"); click("승인하고 Aside에 발행 요청");
    await waitFor(() => expect(container.textContent).toContain("다시 발행하지 마십시오"));
    expect(mock.dispatch).toHaveBeenCalledTimes(1); expect(mock.queue).toHaveBeenCalledTimes(1); expect(publishButton().disabled).toBe(true);
    expect(container.querySelector('[aria-label="채널별 Aside 발행 상태"]')?.textContent).toContain("발행 대기");
  });
  it.each(["queued", "publishing", "published", "uncertain", "failed", "auth_required", "cancelled"])("does not admit an existing %s version again", async status => {
    mock.overview.mockResolvedValue({ ...overview, jobs: [{ ...job, status }] }); render(); await waitFor(() => expect(container.textContent).toContain("첫 배포"));
    expect((container.querySelector('[aria-label="발행 선택: 첫 배포"]') as HTMLInputElement).disabled).toBe(true); expect(publishButton().disabled).toBe(true); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("keeps older uncertain revisions locked but permits a new revision after a completed post", async () => {
    mock.overview.mockResolvedValue({ ...overview, jobs: [{ ...job, revision: 2, status: "uncertain" }] }); render(); await waitFor(() => expect(container.textContent).toContain("게시 여부 확인 필요"));
    expect((container.querySelector('[aria-label="발행 선택: 첫 배포"]') as HTMLInputElement).disabled).toBe(true);
    update({ ...overview, jobs: [{ ...job, revision: 2, status: "published" }] });
    await waitFor(() => expect((container.querySelector('[aria-label="발행 선택: 첫 배포"]') as HTMLInputElement).disabled).toBe(false));
  });
  it.each(["media", "platform", "disabled", "blocked", "instance"])("blocks unsupported publication for %s", async reason => {
    mock.overview.mockResolvedValue({ ...overview, publicationEnabled: reason !== "instance", publicationCapabilities: { platforms: reason === "platform" ? [] : ["naver_blog"], media: false }, drafts: reason === "media" ? [{ ...draft, content: { ...draft.content, media: [{ attachmentId: "img", alt: "" }] } }] : [draft], channels: [{ ...channel, enabled: reason !== "disabled" }], profiles: [{ ...profile, blockedReason: reason === "blocked" ? "expired" : null }] });
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포"));
    expect((container.querySelector('[aria-label="발행 선택: 첫 배포"]') as HTMLInputElement).disabled).toBe(true); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("shows native image/video content and actual author provenance in list and detail", async () => {
    mock.overview.mockResolvedValue({ ...overview, drafts: [{ ...draft, author: { agentId: "writer", name: "marketer staff_1" }, content: { ...draft.content, media: [{ attachmentId: "image", alt: "설계도" }, { attachmentId: "video", alt: "" }] } }] });
    mock.media.mockResolvedValue([{ attachmentId: "image", title: "image.png", contentType: "image/png", href: "/api/attachments/image/content" }, { attachmentId: "video", title: "demo.mp4", contentType: "video/mp4", href: "/api/attachments/video/content" }]);
    render(); await waitFor(() => expect(container.querySelector('img[alt="설계도"]')).not.toBeNull());
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/api/attachments/video/content");
    expect(container.querySelectorAll('[aria-label="초안 작성자"]')).toHaveLength(2);
    for (const tag of container.querySelectorAll('[aria-label="초안 작성자"]')) { expect(tag.textContent).toBe("작성: marketer staff_1"); expect(tag.getAttribute("data-author-kind")).toBe("agent"); }
  });
  it.each([[null, "unknown", "작성자 미확인"], [{ agentId: null, name: "운영자" }, "operator", "작성: 운영자"]])("does not invent an agent author for %s", async (author, kind, label) => {
    mock.overview.mockResolvedValue({ ...overview, drafts: [{ ...draft, author }] }); render(); await waitFor(() => expect(container.querySelectorAll('[aria-label="초안 작성자"]')).toHaveLength(2));
    for (const tag of container.querySelectorAll('[aria-label="초안 작성자"]')) { expect(tag.textContent).toBe(label); expect(tag.getAttribute("data-author-kind")).toBe(kind); }
  });
  it("preserves checked posts and details on polling and explicit refresh errors", async () => {
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포")); check("첫 배포");
    mock.overview.mockRejectedValue(new Error("일시 조회 실패")); click("마케팅 다시 조회");
    await waitFor(() => expect(container.textContent).toContain("일시 조회 실패"));
    expect(container.querySelector('[aria-label="선택한 글 상세"]')?.textContent).toContain("승인 전 본문");
    expect((container.querySelector('[aria-label="발행 선택: 첫 배포"]') as HTMLInputElement).checked).toBe(true); expect(publishButton().disabled).toBe(true); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("clears checks when profile/channel scope changes but not when detail changes", async () => {
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포")); check("첫 배포"); click("업무 프로필");
    await waitFor(() => expect(container.textContent).toContain("0개 선택")); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("prevents approval if selected posts become unavailable", async () => {
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포")); check("첫 배포"); update({ ...overview, jobs: [job] });
    await waitFor(() => expect(publishButton().disabled).toBe(true)); expect(container.textContent).toContain("선택을 다시 확인"); expect(mock.queue).not.toHaveBeenCalled();
    check("첫 배포"); expect(container.textContent).toContain("0개 선택"); expect(container.textContent).not.toContain("선택을 다시 확인");
  });
  it("does not silently truncate a batch beyond the existing 50-post API limit", async () => {
    mock.overview.mockResolvedValue({ ...overview, drafts: Array.from({ length: 51 }, (_, i) => ({ ...draft, id: `post-${i}` })) }); render();
    await waitFor(() => expect(container.querySelectorAll('[aria-label="발행 선택: 첫 배포"]')).toHaveLength(51));
    flushSync(() => (container.querySelector('[aria-label="발행 가능한 글 전체 선택"]') as HTMLInputElement).click());
    expect(container.textContent).toContain("51개 선택"); expect(container.textContent).toContain("50개까지"); expect(publishButton().disabled).toBe(true);
  });
  it("shows loading, empty and initial error states without publication", async () => {
    mock.overview.mockResolvedValue({ ...overview, drafts: [] }); render(); await waitFor(() => expect(container.textContent).toContain("등록된 글 없음"));
    expect(container.textContent).toContain("선택된 글 없음"); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("does not expose details on an initial authorization failure", async () => {
    mock.overview.mockRejectedValue(new Error("접근 권한 없음")); render(); await waitFor(() => expect(container.textContent).toContain("접근 권한 없음"));
    expect(container.querySelector('[aria-label="선택한 글 상세"]')).toBeNull(); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("hides cached content and open approval after a confirmed access denial", async () => {
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포")); check("첫 배포"); click("발행");
    mock.overview.mockRejectedValue(new ApiError("권한이 해제되었습니다", 403, {})); await cache.refetchQueries({ queryKey: ["marketing", "co"] });
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(container.querySelector('[aria-label="선택한 글 상세"]')).toBeNull(); expect(container.textContent).not.toContain("승인 전 본문"); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("reconciles an uncertain job read-only without retry or cancellation", async () => {
    mock.overview.mockResolvedValue({ ...overview, jobs: [{ ...job, status: "uncertain", lastError: "확인 필요" }] }); mock.reconcile.mockResolvedValue({ status: "uncertain" }); render();
    await waitFor(() => expect(container.textContent).toContain("게시 여부 확인 필요")); click("게시 여부 확인");
    await waitFor(() => expect(mock.reconcile).toHaveBeenCalledWith("co", "job")); expect(mock.dispatch).not.toHaveBeenCalled(); expect(mock.retry).not.toHaveBeenCalled(); expect(mock.cancel).not.toHaveBeenCalled();
  });
  it("requests only the selected queued job after a separate recovery confirmation", async () => {
    mock.overview.mockResolvedValue({ ...overview, jobs: [job] }); render(); await waitFor(() => expect(container.textContent).toContain("대기 작업 요청"));
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true); click("대기 작업 요청"); expect(mock.dispatch).not.toHaveBeenCalled(); click("대기 작업 요청");
    await waitFor(() => expect(mock.dispatch).toHaveBeenCalledWith("co", "project", ["job"])); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("only offers retry with terminal definitely-not-posted evidence", async () => {
    mock.overview.mockResolvedValue({ ...overview, jobs: [{ ...job, status: "failed" }] }); render(); await waitFor(() => expect(container.textContent).toContain("발행 실패"));
    expect(container.textContent).not.toContain("재시도 대기"); update({ ...overview, jobs: [{ ...job, status: "failed", evidence: { terminal: true, definitelyNotPosted: true } }] });
    await waitFor(() => expect(container.textContent).toContain("재시도 대기")); expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it("keeps blocked-profile recovery inside post history without a permanent account-check button", async () => {
    mock.overview.mockResolvedValue({ ...overview, profiles: [{ ...profile, blockedReason: "login expired" }], jobs: [{ ...job, status: "auth_required" }] });
    mock.resumeProfile.mockResolvedValue(profile); render(); await waitFor(() => expect(container.textContent).toContain("발행 차단 해제")); click("발행 차단 해제");
    await waitFor(() => expect(mock.resumeProfile).toHaveBeenCalledWith("co", "profile", "channel")); expect(mock.queue).not.toHaveBeenCalled(); expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it.each([["queued", "busy", "발행 대기"], ["publishing", "busy", "발행 중"], ["published", "success", "발행 완료"], ["failed", "error", "발행 실패"], ["auth_required", "error", "로그인 필요"], ["uncertain", "error", "게시 여부 확인 필요"]])("keeps channel publication dot for %s", async (status, tone, label) => {
    mock.overview.mockResolvedValue({ ...overview, jobs: [{ ...job, status }] }); render(); await waitFor(() => expect(container.querySelector('[data-publication-state]')).not.toBeNull());
    const dot = container.querySelector('[data-publication-state]')!; expect(dot.getAttribute("data-publication-state")).toBe(tone); expect(dot.getAttribute("aria-label")).toBe(`발행 상태: ${label}`); expect(dot.closest("button")?.textContent).toBe("개발 블로그");
  });
  it("does not invent publication status for untouched channels or cancelled jobs", async () => {
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포")); expect(container.querySelector('[aria-label="채널별 Aside 발행 상태"]')).toBeNull(); expect(container.querySelector('[data-publication-state]')).toBeNull();
    update({ ...overview, jobs: [{ ...job, status: "cancelled" }] }); expect(container.querySelector('[data-publication-state]')).toBeNull();
  });
  it.each(["naver_blog", "linkedin", "instagram"])("keeps %s connection/settings left, with no Naver-only check", async platform => {
    mock.overview.mockResolvedValue({ ...overview, channels: [{ ...channel, platform }] }); render(); await waitFor(() => expect((container.querySelector('[aria-label="개발 블로그 연결 확인"]') as HTMLButtonElement)?.disabled).toBe(false));
    const sidebar = container.querySelector('aside[aria-label="마케팅 프로젝트와 채널"]')!, connection = sidebar.querySelector('[aria-label="SNS 연결 확인"]')!;
    expect(sidebar.querySelector('[aria-label="프로필과 채널 관리"]')!.compareDocumentPosition(connection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); expect(sidebar.querySelector('[aria-label="채널 설정 수정"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="마케팅 운영실"] [aria-label="SNS 연결 확인"]')).toBeNull(); expect(container.textContent).not.toContain("네이버 계정 확인");
    click("개발 블로그 연결 확인"); await waitFor(() => expect(mock.requestConnectionChecks).toHaveBeenCalledWith("co", "project", ["channel"])); expect(mock.checkAccount).not.toHaveBeenCalled(); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("preserves checked posts and details while connection results arrive", async () => {
    render(); await waitFor(() => expect(container.textContent).toContain("첫 배포")); check("첫 배포"); click("전체 확인");
    await waitFor(() => expect(mock.requestConnectionChecks).toHaveBeenCalled());
    flushSync(() => cache.setQueryData(["marketing-connection-checks", "co", "project"], { jobs: [{ id: "check", channelId: "channel", status: "result_received", resultReceivedAt: "2026-10-07T00:00:00Z", asideSessionId: "session-123" }], monitor: { enabled: false }, connections: [{ channelId: "channel", status: "auth_required" }] }));
    await waitFor(() => expect(container.textContent).toContain("판정 대기")); expect(container.querySelector('[data-connection-state="success"]')).not.toBeNull(); expect(container.textContent).toContain("계정: 로그인 필요");
    expect(container.querySelector('[aria-label="선택한 글 상세"]')?.textContent).toContain("승인 전 본문"); expect(container.textContent).toContain("1개 선택"); expect(mock.queue).not.toHaveBeenCalled();
  });
  it("checks only enabled channels in the visible profile and retains connection state on errors", async () => {
    mock.overview.mockResolvedValue({ ...overview, profiles: [profile, { ...profile, id: "other" }], channels: [channel, { ...channel, id: "disabled", name: "중지 채널", enabled: false }, { ...channel, id: "other", profileId: "other", name: "다른 채널" }] });
    mock.connectionChecks.mockResolvedValue({ jobs: [], monitor: { enabled: false }, connections: [{ channelId: "channel", status: "connected", checkedAt: "2026-10-07T00:00:00Z" }] });
    render(); await waitFor(() => expect(container.textContent).toContain("계정: 연결 정상")); const panel = container.querySelector('[aria-label="SNS 연결 확인"]')!;
    expect(panel.textContent).not.toContain("중지 채널"); expect(panel.textContent).not.toContain("다른 채널"); click("전체 확인"); await waitFor(() => expect(mock.requestConnectionChecks).toHaveBeenCalledWith("co", "project", ["channel"]));
    mock.connectionChecks.mockRejectedValue(new Error("연결 조회 실패")); await cache.refetchQueries({ queryKey: ["marketing-connection-checks", "co", "project"] });
    await waitFor(() => expect(panel.textContent).toContain("연결 조회 실패")); expect(panel.textContent).toContain("계정: 연결 정상"); expect(panel.textContent).toContain("마지막 확인");
  });
  it("keeps automatic monitoring off by default and surfaces toggle errors", async () => {
    mock.setConnectionMonitor.mockRejectedValue(new Error("설정 저장 실패")); render(); await waitFor(() => expect((container.querySelector('[aria-label="자동 연결 확인"]') as HTMLButtonElement)?.disabled).toBe(false));
    expect(container.querySelector('[aria-label="자동 연결 확인"]')?.getAttribute("aria-checked")).toBe("false"); click("자동 연결 확인"); await waitFor(() => expect(container.textContent).toContain("설정 저장 실패"));
    expect(mock.setConnectionMonitor).toHaveBeenCalledWith("co", "project", true);
  });
  it.each([["LinkedIn", "linkedin"], ["Instagram", "instagram"]])("preserves %s channel configuration without inventing an account", async (name, platform) => {
    render(); await waitFor(() => expect(container.textContent).toContain("개발 블로그")); const trigger = [...container.querySelectorAll("button")].find(button => button.textContent === "채널")!;
    flushSync(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(row => row.textContent === name)!; flushSync(() => (item as HTMLElement).click());
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull()); expect((document.querySelector('[aria-label="SNS 플랫폼"]') as HTMLSelectElement).value).toBe(platform); expect((document.querySelector('[aria-label="SNS 계정 주소"]') as HTMLInputElement).value).toBe(""); expect(mock.queue).not.toHaveBeenCalled();
  });
});
