import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { companies, projects, marketingPublishJobs, createDb, assets, issues, issueAttachments } from "@paperclipai/db";
import type { MarketingPlatform } from "@paperclipai/shared";
import type { MarketingPublicationSnapshot } from "../services/marketing-publication.js";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { marketingService } from "../services/marketing.js";
import { marketingDispatchService } from "../services/marketing-dispatch.js";
import { marketingAsideTransport } from "../services/marketing-aside-transport.js";

const native = vi.hoisted(() => ({ account: vi.fn(), prepare: vi.fn(), resume: vi.fn(), state: vi.fn(), results: vi.fn(), post: vi.fn() }));
vi.mock("../services/marketing-naver-account.js", () => ({ checkMarketingNaverAccount: native.account }));
vi.mock("../services/marketing-aside-session.js", () => ({ prepareMarketingAsideSession: native.prepare, resumeMarketingAsideSession: native.resume, readMarketingAsideSession: native.state, readMarketingAsideAssistantResults: native.results }));
vi.mock("../services/marketing-naver-post.js", async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), readMarketingNaverPost: native.post }));

function publicationTime() {
  const date = new Date(Date.now() + 9 * 3600000);
  return `${date.getUTCFullYear()}. ${date.getUTCMonth() + 1}. ${date.getUTCDate()}. ${date.getUTCHours()}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}
describe("Aside publication composition with native PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("paperclip-marketing-transport-"); db = createDb(database.connectionString); }, 90000);
  afterAll(async () => { await database?.cleanup(); });
  afterEach(async () => { await db.delete(marketingPublishJobs); });
  beforeEach(() => {
    vi.clearAllMocks();
    native.account.mockResolvedValue({ signedIn: true, accountId: "my_blog" });
    native.prepare.mockImplementation(async (_account, persist) => { await persist("owned-native-session"); return "owned-native-session"; });
    native.resume.mockResolvedValue({ terminal: true, interrupted: false, output: "Not success evidence" });
    native.state.mockResolvedValue({ terminal: true });
    native.post.mockResolvedValue({ url: "https://blog.naver.com/my_blog/223456789012", postId: "223456789012", title: "Approved title", body: "Approved body", imageCount: 0, videoCount: 0, embedCount: 0, publishedAtText: publicationTime() });
  });
  async function fixture(platform: MarketingPlatform = "naver_blog") {
    const companyId = randomUUID(); await db.insert(companies).values({ id: companyId, name: "Transport fixtures", issuePrefix: `T${companyId.slice(0, 6).toUpperCase()}`, defaultResponsibleUserId: "operator" });
    const [project] = await db.insert(projects).values({ companyId, name: "Marketing" }).returning();
    const service = marketingService(db);
    const profile = await service.createProfile(companyId, { projectId: project.id, name: "Aside", asideAccountId: "u1", browserProfileName: "Profile 1" });
    const accountId = platform === "naver_blog" ? "my_blog" : "writer";
    const accountUrls = { naver_blog: "https://blog.naver.com/my_blog", linkedin: "https://www.linkedin.com/in/writer", instagram: "https://www.instagram.com/writer", threads: "https://www.threads.com/@writer", x: "https://x.com/writer", youtube: "https://www.youtube.com/@writer", tistory: "https://writer.tistory.com" };
    const channel = await service.createChannel(companyId, { projectId: project.id, profileId: profile.id, name: "Channel", platform, accountId, accountUrl: accountUrls[platform], concept: "Notes", tone: "Plain", audience: "Readers", writingRules: "Sources" });
    const draft = await service.createDraft(companyId, { channelId: channel.id, topic: "Test", content: { title: "Approved title", body: "Approved body", media: [] } });
    const [job] = await service.queueDrafts(companyId, { drafts: [{ id: draft.id, revision: 1 }] }, "operator");
    native.results.mockResolvedValue([JSON.stringify({ jobId: job.id, snapshotHash: job.snapshotHash, postedUrl: "https://blog.naver.com/my_blog/223456789012" })]);
    return { companyId, service, job, dispatcher: marketingDispatchService(db, marketingAsideTransport(db)) };
  }
  it.each([
    ["instagram", "https://www.instagram.com/p/approved123/"],
    ["linkedin", "https://www.linkedin.com/feed/update/urn:li:activity:123456/"],
    ["threads", "https://www.threads.com/@writer/post/approved123"],
    ["x", "https://x.com/writer/status/123456"],
    ["youtube", "https://www.youtube.com/shorts/abcdefghijk"],
    ["tistory", "https://writer.tistory.com/123"],
  ] as const)("delegates %s to the selected Aside profile without a platform editor adapter", async (platform, postedUrl) => {
    const f = await fixture(platform);
    native.results.mockResolvedValue([JSON.stringify({ jobId: f.job.id, snapshotHash: f.job.snapshotHash, status: "published", postedUrl, accountId: "writer", title: "Approved title", body: "Approved body", publishedAt: new Date().toISOString(), media: [] })]);
    expect((await f.dispatcher.dispatch(f.companyId))[0].status).toBe("published");
    expect(native.resume.mock.calls[0][0]).toBe("u1");
    expect(native.resume.mock.calls[0][2]).toContain(platform);
    expect(native.post).not.toHaveBeenCalled();
    expect((await f.service.overview(f.companyId)).jobs[0].evidence?.source).toBe("native_aside_report");
  });
  it.each([{ accountId: "someone_else" }, { body: "Different body" }, { publishedAt: "2023-01-01T00:00:00.000Z" }, { media: [{ attachmentId: randomUUID(), sha256: "a".repeat(64) }] }])("keeps mismatched Aside reports uncertain: %j", async override => {
    const f = await fixture("instagram");
    native.results.mockResolvedValue([JSON.stringify({ jobId: f.job.id, snapshotHash: f.job.snapshotHash, status: "published", postedUrl: "https://www.instagram.com/p/approved123/", accountId: "writer", title: "Approved title", body: "Approved body", publishedAt: new Date().toISOString(), media: [], ...override })]);
    expect((await f.dispatcher.dispatch(f.companyId))[0].status).toBe("uncertain");
    await expect(f.dispatcher.retry(f.companyId, f.job.id)).rejects.toThrow();
  });
  it("records a native login failure only when Aside reports no publication started", async () => {
    const f = await fixture("linkedin");
    native.results.mockResolvedValue([JSON.stringify({ jobId: f.job.id, snapshotHash: f.job.snapshotHash, status: "auth_required", publicationStarted: false, message: "Login required" })]);
    expect((await f.dispatcher.dispatch(f.companyId))[0].status).toBe("auth_required");
    expect((await f.service.overview(f.companyId)).jobs[0].evidence?.definitelyNotPosted).toBe(true);
    expect((await f.service.overview(f.companyId)).profiles[0].blockedReason).toBeNull();
  });
  it("hands verified original image/video files to Aside without dropping attachments", async () => {
    const f = await fixture("instagram");
    const directory = await mkdtemp(path.join(os.tmpdir(), "paperclip-aside-media-"));
    try {
      const storage = createStorageService(createLocalDiskStorageProvider(directory));
      const service = marketingService(db, storage);
      const [issue] = await db.insert(issues).values({ companyId: f.companyId, projectId: f.job.projectId, title: "Approved files" }).returning();
      const content = { title: "Approved title", body: "Approved body", media: [] as Array<{ attachmentId: string; alt: string }> };
      for (const [contentType, name] of [["image/png", "approved.png"], ["video/mp4", "approved.mp4"]]) {
        const file = await storage.putFile({ companyId: f.companyId, namespace: "issues", originalFilename: name, contentType, body: Buffer.from(name) });
        const [asset] = await db.insert(assets).values({ companyId: f.companyId, ...file }).returning();
        const [attachment] = await db.insert(issueAttachments).values({ companyId: f.companyId, issueId: issue.id, assetId: asset.id }).returning();
        content.media.push({ attachmentId: attachment.id, alt: "Approved visual" });
      }
      await service.updateDraft(f.companyId, f.job.draftId, { revision: 1, content });
      const [job] = await service.queueDrafts(f.companyId, { drafts: [{ id: f.job.draftId, revision: 2 }] }, "operator");
      const snapshot = job.snapshot as unknown as MarketingPublicationSnapshot;
      native.results.mockResolvedValue([JSON.stringify({ jobId: job.id, snapshotHash: job.snapshotHash, status: "published", postedUrl: "https://www.instagram.com/p/approved123/", accountId: "writer", title: content.title, body: content.body, publishedAt: new Date().toISOString(), media: snapshot.media.map(({ attachmentId, sha256 }) => ({ attachmentId, sha256 })) })]);
      const dispatcher = marketingDispatchService(db, marketingAsideTransport(db, directory));
      expect((await dispatcher.dispatch(f.companyId))[0].status).toBe("published");
      const prompt = native.resume.mock.calls[0][2];
      expect(prompt).toContain(directory); expect(prompt).toContain("image/png"); expect(prompt).toContain("video/mp4");
      for (const item of snapshot.media) expect(prompt).toContain(item.sha256);
      await service.updateDraft(f.companyId, f.job.draftId, { revision: 2, content: { ...content, title: "Next approved title" } });
      const [next] = await service.queueDrafts(f.companyId, { drafts: [{ id: f.job.draftId, revision: 3 }] }, "operator");
      const [changedAsset] = await db.select().from(assets).where(eq(assets.id, snapshot.media[0].assetId));
      const provider = createLocalDiskStorageProvider(directory);
      await provider.putObject({ objectKey: changedAsset.objectKey, contentType: changedAsset.contentType, contentLength: 7, body: Buffer.from("changed") });
      expect((await dispatcher.dispatch(f.companyId, f.job.projectId, [next.id]))[0].status).toBe("failed");
      expect(native.resume).toHaveBeenCalledTimes(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("persists the session before execution and verifies native article evidence", async () => {
    const f = await fixture();
    native.resume.mockImplementation(async (_account, sessionId, prompt) => {
      const [stored] = await db.select().from(marketingPublishJobs).where(eq(marketingPublishJobs.id, f.job.id));
      expect(stored.externalSessionId).toBe(sessionId); expect(stored.status).toBe("publishing");
      expect(prompt).toContain("Approved body"); expect(prompt).toContain(f.job.snapshotHash);
      return { terminal: true, interrupted: false, output: "Posted successfully" };
    });
    expect(await f.dispatcher.dispatch(f.companyId)).toEqual([{ jobId: f.job.id, status: "published" }]);
    const [stored] = (await f.service.overview(f.companyId)).jobs;
    expect(stored.evidence).toMatchObject({ source: "native_aside_and_naver_article", textMatched: true });
    expect(native.post).toHaveBeenCalledTimes(1);
  });
  it("never opens a posting session for a mismatched account", async () => {
    const f = await fixture(); native.account.mockResolvedValue({ signedIn: true, accountId: "another_blog" });
    expect((await f.dispatcher.dispatch(f.companyId))[0].status).toBe("auth_required");
    expect(native.prepare).not.toHaveBeenCalled(); expect(native.resume).not.toHaveBeenCalled();
  });
  it.each([{ publishedAtText: "2023. 9. 19. 17:29" }, { body: "Different body" }, { title: "Different title" }])("keeps old or edited posts uncertain, not successful: %j", async change => {
    const f = await fixture(); native.post.mockResolvedValue({ ...(await native.post()), ...change });
    expect((await f.dispatcher.dispatch(f.companyId))[0].status).toBe("uncertain");
    await expect(f.dispatcher.retry(f.companyId, f.job.id)).rejects.toThrow();
  });
  it("does not accept CLI claims when the stored session result is missing", async () => {
    const f = await fixture(); native.results.mockResolvedValue(["Posted successfully"]);
    expect((await f.dispatcher.dispatch(f.companyId))[0].status).toBe("uncertain");
    expect(native.post).not.toHaveBeenCalled();
  });
  it("reconciles a lost observation from the same session without posting again", async () => {
    const f = await fixture(); native.resume.mockResolvedValue({ terminal: false, interrupted: true, output: "" });
    expect((await f.dispatcher.dispatch(f.companyId))[0].status).toBe("uncertain");
    expect((await f.dispatcher.reconcile(f.companyId, f.job.id)).status).toBe("published");
    expect(native.resume).toHaveBeenCalledTimes(1); expect(native.prepare).toHaveBeenCalledTimes(1);
    expect(native.results).toHaveBeenCalledWith("u1", "owned-native-session");
  });
});
