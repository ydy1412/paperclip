import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { companies, projects, issues, assets, issueAttachments, marketingPublishJobs, createDb, activityLog, documents, issueDocuments, agents } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { marketingService } from "../services/marketing.js";
import { marketingRoutes } from "../routes/marketing.js";
import type { MarketingPublicationTransport } from "../services/marketing-dispatch.js";
import { errorHandler } from "../middleware/error-handler.js";

describe("marketing native PostgreSQL and API", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-marketing-");
    db = createDb(database.connectionString);
  }, 90000);
  afterAll(async () => { await database?.cleanup(); });

  async function fixture() {
    const id = randomUUID();
    await db.insert(companies).values({ id, name: "Marketing acceptance", issuePrefix: `M${id.slice(0, 6).toUpperCase()}`, defaultResponsibleUserId: "operator" });
    const [project] = await db.insert(projects).values({ companyId: id, name: "Marketing" }).returning();
    const service = marketingService(db);
    const profile = await service.createProfile(id, { projectId: project.id, name: "Work", asideAccountId: "u1", browserProfileName: "Profile 1" });
    const channel = await service.createChannel(id, { projectId: project.id, profileId: profile.id, platform: "naver_blog", name: "Blog", accountId: "my_blog", accountUrl: "https://blog.naver.com/my_blog", concept: "개발 기록", tone: "차분함", audience: "개발자", writingRules: "근거 링크 포함" });
    const draft = await service.createDraft(id, { channelId: channel.id, topic: "배포 경험", content: { title: "배포", body: "승인 전 초안", media: [] } });
    return { id, project, profile, channel, draft, service };
  }
  it("keeps the default operating route draft-only with no publication transport", async () => {
    const f = await fixture();
    const state = await request(app(f.id)).get(`/api/companies/${f.id}/marketing`);
    expect(state.body.publicationEnabled).toBe(false);
    const result = await request(app(f.id)).post(`/api/companies/${f.id}/marketing/dispatch`).send({ projectId: f.project.id });
    expect(result.status).toBe(409);
    expect((await f.service.overview(f.id)).jobs).toHaveLength(0);
  });
  function app(companyId: string, actorType = "board", transport?: MarketingPublicationTransport, agentId?: string) {
    const instance = express();
    instance.use(express.json());
    instance.use((req, _res, next) => {
      req.actor = { type: actorType, source: "session", userId: "operator", companyId, companyIds: [companyId], agentId } as typeof req.actor;
      next();
    });
    instance.use("/api", marketingRoutes(db, transport)); instance.use(errorHandler);
    return instance;
  }
  it("lets the assigned marketer read rules and submit media drafts, never approve or dispatch", async () => {
    const f = await fixture();
    const [agent] = await db.insert(agents).values({ companyId: f.id, name: "Marketer", role: "general", adapterType: "codex_local" }).returning();
    const [issue] = await db.insert(issues).values({ companyId: f.id, projectId: f.project.id, assigneeAgentId: agent.id, title: "Write channel drafts", status: "in_progress" }).returning();
    const [asset] = await db.insert(assets).values({ companyId: f.id, provider: "local_disk", objectKey: `${f.id}/fixture`, contentType: "video/mp4", byteSize: 10, sha256: "a".repeat(64) }).returning();
    const [attachment] = await db.insert(issueAttachments).values({ companyId: f.id, issueId: issue.id, assetId: asset.id }).returning();
    const endpoint = `/api/companies/${f.id}/marketing/draft-tools`;
    const client = app(f.id, "agent", undefined, agent.id);
    const context = await request(client).get(endpoint).query({ issueId: issue.id });
    expect(context.status).toBe(200); expect(context.body.channels[0]).toMatchObject({ id: f.channel.id, concept: "개발 기록" });
    expect(context.body.channels[0].profileId).toBeUndefined(); expect(context.body.media[0].attachmentId).toBe(attachment.id);
    const body = { issueId: issue.id, channelId: f.channel.id, topic: "소재", content: { title: "제목", body: "본문", media: [{ attachmentId: attachment.id, alt: "제품 시연 영상" }] } };
    const submitted = await request(client).post(endpoint).send(body);
    expect(submitted.status).toBe(200); expect(submitted.body.content).toEqual(body.content);
    const repeated = await request(client).post(endpoint).send(body);
    expect(repeated.body.id).toBe(submitted.body.id);
    expect((await request(client).post(endpoint).send({ ...body, content: { ...body.content, body: "임의 덮어쓰기" } })).status).toBe(409);
    const overview = await f.service.overview(f.id);
    expect(overview.drafts.find(row => row.id === submitted.body.id)?.generationIssueId).toBe(issue.id);
    expect(overview.jobs).toHaveLength(0);
    expect((await request(client).post(`/api/companies/${f.id}/marketing/queue`).send({ drafts: [{ id: submitted.body.id, revision: 1 }] })).status).toBe(403);
    expect((await request(client).post(`/api/companies/${f.id}/marketing/dispatch`).send({ projectId: f.project.id })).status).toBe(403);
    const unassigned = app(f.id, "agent", undefined, randomUUID());
    expect((await request(unassigned).get(endpoint).query({ issueId: issue.id })).status).toBe(404);
    expect((await request(unassigned).post(endpoint).send(body)).status).toBe(404);
    expect((await request(app(randomUUID(), "agent", undefined, agent.id)).get(endpoint).query({ issueId: issue.id })).status).toBe(403);
  });
  it("attributes drafts to the earliest submission, not current assignment or later editors", async () => {
    const f = await fixture();
    const [writer, editor] = await db.insert(agents).values([
      { companyId: f.id, name: "Original writer", role: "general", adapterType: "codex_local" },
      { companyId: f.id, name: "Later editor", role: "engineer", adapterType: "codex_local" },
    ]).returning();
    const [issue] = await db.insert(issues).values({ companyId: f.id, projectId: f.project.id, assigneeAgentId: writer.id, title: "Draft", status: "in_progress" }).returning();
    const endpoint = `/api/companies/${f.id}/marketing/draft-tools`;
    const body = { issueId: issue.id, channelId: f.channel.id, topic: "Author test", content: { title: "Draft", body: "Body", media: [] } };
    const submitted = await request(app(f.id, "agent", undefined, writer.id)).post(endpoint).send(body);
    expect(submitted.status).toBe(200);
    await db.update(issues).set({ assigneeAgentId: editor.id }).where(eq(issues.id, issue.id));
    expect((await request(app(f.id, "agent", undefined, editor.id)).post(endpoint).send(body)).status).toBe(200);
    await f.service.updateDraft(f.id, submitted.body.id, { revision: 1, topic: "Edited", content: { ...body.content, title: "Edited" } });
    const overview = await request(app(f.id)).get(`/api/companies/${f.id}/marketing`);
    expect(overview.body.drafts.find((row: { id: string }) => row.id === submitted.body.id).author).toEqual({ agentId: writer.id, name: writer.name });
    expect(overview.body.drafts.find((row: { id: string }) => row.id === f.draft.id).author).toBeNull();
    const manual = await request(app(f.id)).post(`/api/companies/${f.id}/marketing/drafts`).send({ channelId: f.channel.id, topic: "Manual", content: body.content });
    expect(manual.status).toBe(201);
    expect((await f.service.overview(f.id)).drafts.find(row => row.id === manual.body.id)?.author).toEqual({ agentId: null, name: "운영자" });
    const other = await fixture();
    await db.insert(activityLog).values({ companyId: other.id, actorType: "agent", actorId: writer.id, agentId: writer.id, action: "marketing.agent_draft_submitted", entityType: "marketing", entityId: f.draft.id });
    expect((await f.service.overview(f.id)).drafts.find(row => row.id === f.draft.id)?.author).toBeNull();
    expect((await f.service.overview(other.id)).drafts.some(row => row.id === submitted.body.id)).toBe(false);
  });
  it("executes only board-authorized project queues through the publication boundary", async () => {
    const f = await fixture(); await f.service.queueDrafts(f.id, { drafts: [{ id: f.draft.id, revision: 1 }] }, "operator");
    const publish = vi.fn<MarketingPublicationTransport["publish"]>(async () => ({ status: "failed", terminal: true, definitelyNotPosted: true, message: "Fixture preflight failure", evidence: { fixture: true } }));
    const transport = { publish, reconcile: vi.fn() };
    const denied = await request(app(f.id, "agent", transport)).post(`/api/companies/${f.id}/marketing/dispatch`).send({ projectId: f.project.id });
    expect(denied.status).toBe(403); expect(publish).not.toHaveBeenCalled();
    const response = await request(app(f.id, "board", transport)).post(`/api/companies/${f.id}/marketing/dispatch`).send({ projectId: f.project.id });
    expect(response.status).toBe(200); expect(response.body[0].status).toBe("failed"); expect(publish).toHaveBeenCalledTimes(1);
    const retry = await request(app(f.id, "board", transport)).post(`/api/companies/${f.id}/marketing/jobs/${response.body[0].jobId}/retry`).send({});
    expect(retry.status).toBe(200); expect(retry.body.status).toBe("queued");
  });
  it("rejects malformed item IDs before querying native UUID columns", async () => {
    const f = await fixture();
    const result = await request(app(f.id)).post(`/api/companies/${f.id}/marketing/jobs/not-a-uuid/reconcile`).send({});
    expect(result.status).toBe(400);
  });
  async function generationDocument(f: Awaited<ReturnType<typeof fixture>>, body: string, status = "done") {
    const [issue] = await db.insert(issues).values({ companyId: f.id, projectId: f.project.id, title: "Marketing generation", status }).returning();
    const [document] = await db.insert(documents).values({ companyId: f.id, latestBody: body }).returning();
    await db.insert(issueDocuments).values({ companyId: f.id, issueId: issue.id, documentId: document.id, key: "marketing-drafts" });
    return issue;
  }
  it("imports native generated content idempotently without overwriting edits or publishing", async () => {
    const f = await fixture();
    const issue = await generationDocument(f, JSON.stringify({ topic: "배포", drafts: [{ channelId: f.channel.id, content: { title: "작성 결과", body: "채널별 제작 결과", media: [] } }] }));
    const response = await request(app(f.id)).post(`/api/companies/${f.id}/marketing/import-generated`).send({ issueId: issue.id });
    expect(response.status).toBe(200); const imported = response.body[0];
    expect(imported.generationIssueId).toBe(issue.id); expect(imported.content.body).toBe("채널별 제작 결과");
    await f.service.updateDraft(f.id, imported.id, { revision: 1, topic: "배포", content: { title: "검토 완료", body: "사용자가 수정한 본문", media: [] } });
    const [again] = await f.service.importGeneratedDrafts(f.id, issue.id);
    expect(again.id).toBe(imported.id); expect(again.revision).toBe(2); expect(again.content.body).toBe("사용자가 수정한 본문");
    expect((await f.service.overview(f.id)).jobs).toHaveLength(0);
  });
  it("rejects incomplete, invalid and foreign generated documents atomically", async () => {
    const f = await fixture(), other = await fixture();
    const pending = await generationDocument(f, "{}", "in_progress");
    await expect(f.service.importGeneratedDrafts(f.id, pending.id)).rejects.toThrow("완료");
    const invalid = await generationDocument(f, "```json\n{}\n```");
    await expect(f.service.importGeneratedDrafts(f.id, invalid.id)).rejects.toThrow("JSON");
    const foreign = await generationDocument(f, JSON.stringify({ topic: "topic", drafts: [{ channelId: f.channel.id, content: { title: "", body: "first", media: [] } }, { channelId: other.channel.id, content: { title: "", body: "foreign", media: [] } }] }));
    await expect(f.service.importGeneratedDrafts(f.id, foreign.id)).rejects.toThrow();
    expect((await f.service.overview(f.id)).drafts).toHaveLength(1);
    const denied = await request(app(f.id, "agent")).post(`/api/companies/${f.id}/marketing/import-generated`).send({ issueId: foreign.id });
    expect(denied.status).toBe(403);
  });
  it("builds channel-specific native task instructions with no posting authority", async () => {
    const f = await fixture();
    const [agent] = await db.insert(agents).values({ companyId: f.id, name: "Writer", role: "engineer", adapterType: "codex_local" }).returning();
    const plan = await f.service.generationInstructions(f.id, { topic: "같은 소재", channelIds: [f.channel.id], agentId: agent.id });
    expect(plan.projectId).toBe(f.project.id); expect(plan.assigneeAgentId).toBe(agent.id);
    expect(plan.description).toContain(f.channel.concept); expect(plan.description).toContain(f.channel.tone);
    expect(plan.description).toContain("marketing-drafts"); expect(plan.description).toContain("No publication is authorized");
    expect((await f.service.overview(f.id)).jobs).toHaveLength(0);
  });
  it("persists the project/profile/channel hierarchy and exact approval snapshot", async () => {
    const f = await fixture();
    const [job] = await f.service.queueDrafts(f.id, { drafts: [{ id: f.draft.id, revision: 1 }] }, "operator");
    expect(job.status).toBe("queued"); expect(job.approvedBy).toBe("operator");
    expect(job.snapshot.content).toEqual(f.draft.content);
    expect(job.snapshot.profile).toMatchObject({ id: f.profile.id, asideAccountId: "u1" });
    const overview = await f.service.overview(f.id);
    expect(overview.channels[0].concept).toBe("개발 기록");
    expect(overview.profiles[0].projectId).toBe(f.project.id);
  });
  it("deduplicates concurrent publication requests in native transactions", async () => {
    const f = await fixture(); const input = { drafts: [{ id: f.draft.id, revision: 1 }] };
    const [a, b] = await Promise.all([f.service.queueDrafts(f.id, input, "operator"), f.service.queueDrafts(f.id, input, "operator")]);
    expect(a[0].id).toBe(b[0].id);
    expect((await f.service.overview(f.id)).jobs).toHaveLength(1);
  });
  it("cancels unstarted approval on edit without changing its immutable snapshot", async () => {
    const f = await fixture(); await f.service.queueDrafts(f.id, { drafts: [{ id: f.draft.id, revision: 1 }] }, "operator");
    const updated = await f.service.updateDraft(f.id, f.draft.id, { revision: 1, topic: "배포 경험", content: { title: "배포", body: "수정한 초안", media: [] } });
    expect(updated.revision).toBe(2);
    const [old] = (await f.service.overview(f.id)).jobs;
    expect(old.status).toBe("cancelled"); expect(old.snapshot.content).toEqual(f.draft.content);
    await expect(f.service.queueDrafts(f.id, { drafts: [{ id: f.draft.id, revision: 1 }] }, "operator")).rejects.toThrow("다시 확인");
    const [next] = await f.service.queueDrafts(f.id, { drafts: [{ id: f.draft.id, revision: 2 }] }, "operator");
    expect(next.id).not.toBe(old.id); expect(next.snapshot.content).toEqual(updated.content);
  });
  it("rolls back the entire batch when any selected revision is stale", async () => {
    const f = await fixture();
    const second = await f.service.createDraft(f.id, { channelId: f.channel.id, topic: "두 번째", content: { title: "", body: "Second", media: [] } });
    await expect(f.service.queueDrafts(f.id, { drafts: [{ id: f.draft.id, revision: 1 }, { id: second.id, revision: 7 }] }, "operator")).rejects.toThrow();
    expect((await f.service.overview(f.id)).jobs).toHaveLength(0);
  });
  it.each(["publishing", "uncertain"] as const)("does not overwrite or cancel %s work", async status => {
    const f = await fixture(); const [job] = await f.service.queueDrafts(f.id, { drafts: [{ id: f.draft.id, revision: 1 }] }, "operator");
    await db.update(marketingPublishJobs).set({ status }).where(eq(marketingPublishJobs.id, job.id));
    await expect(f.service.updateDraft(f.id, f.draft.id, { revision: 1, topic: "edit", content: { title: "", body: "Changed", media: [] } })).rejects.toThrow();
    await expect(f.service.updateProfile(f.id, f.profile.id, { asideAccountId: "u0" })).rejects.toThrow();
    await expect(f.service.cancelJob(f.id, job.id)).rejects.toThrow();
  });
  it("invalidates waiting publication when channel concept or profile changes", async () => {
    const f = await fixture(); await f.service.queueDrafts(f.id, { drafts: [{ id: f.draft.id, revision: 1 }] }, "operator");
    await f.service.updateChannel(f.id, f.channel.id, { concept: "제품 소개" });
    expect((await f.service.overview(f.id)).jobs[0].status).toBe("cancelled");
  });
  it("rejects disabled bindings and cross-company/project resources", async () => {
    const a = await fixture(), b = await fixture();
    await expect(a.service.createProfile(a.id, { projectId: b.project.id, name: "Foreign", asideAccountId: "u0", browserProfileName: "Profile 0" })).rejects.toThrow();
    await expect(a.service.createDraft(a.id, { channelId: b.channel.id, topic: "Foreign", content: { title: "", body: "body", media: [] } })).rejects.toThrow();
    await expect(a.service.queueDrafts(a.id, { drafts: [{ id: b.draft.id, revision: 1 }] }, "operator")).rejects.toThrow();
    await a.service.updateProfile(a.id, a.profile.id, { enabled: false });
    await expect(a.service.queueDrafts(a.id, { drafts: [{ id: a.draft.id, revision: 1 }] }, "operator")).rejects.toThrow("비활성화");
  });
  it("pins only authorized native image/video asset metadata", async () => {
    const f = await fixture();
    const directory = await mkdtemp(path.join(tmpdir(), "paperclip-marketing-media-"));
    try {
    const provider = createLocalDiskStorageProvider(directory);
    const storage = createStorageService(provider);
    const service = marketingService(db, storage);
    const file = await storage.putFile({ companyId: f.id, namespace: "issues", originalFilename: "fixture.png", contentType: "image/png", body: Buffer.from("media fixture") });
    const [issue] = await db.insert(issues).values({ companyId: f.id, projectId: f.project.id, title: "Media" }).returning();
    const [asset] = await db.insert(assets).values({ companyId: f.id, ...file }).returning();
    const [attachment] = await db.insert(issueAttachments).values({ companyId: f.id, issueId: issue.id, assetId: asset.id }).returning();
    const draft = await f.service.createDraft(f.id, { channelId: f.channel.id, topic: "Media", content: { title: "", body: "", media: [{ attachmentId: attachment.id, alt: "Diagram" }] } });
    await expect(service.queueDrafts(f.id, { drafts: [{ id: draft.id, revision: 1 }] }, "operator", { platforms: ["naver_blog"], media: false })).rejects.toThrow("이미지·영상");
    expect((await service.overview(f.id)).jobs).toHaveLength(0);
    const [job] = await service.queueDrafts(f.id, { drafts: [{ id: draft.id, revision: 1 }] }, "operator");
    expect(job.snapshot.media).toEqual([{ attachmentId: attachment.id, assetId: asset.id, contentType: "image/png", sha256: file.sha256, byteSize: file.byteSize, alt: "Diagram" }]);
    const changed = await service.createDraft(f.id, { channelId: f.channel.id, topic: "Changed media", content: draft.content });
    await provider.putObject({ objectKey: file.objectKey, contentType: file.contentType, contentLength: file.byteSize, body: Buffer.from("other fixture") });
    await expect(service.queueDrafts(f.id, { drafts: [{ id: changed.id, revision: 1 }] }, "operator")).rejects.toThrow("변경");
    expect((await service.overview(f.id)).jobs.some(row => row.draftId === changed.id)).toBe(false);
    await expect(f.service.createDraft(f.id, { channelId: f.channel.id, topic: "Invalid", content: { title: "", body: "text", media: [{ attachmentId: randomUUID(), alt: "" }] } })).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("API denies agents/unrelated companies and logs board approval without content", async () => {
    const f = await fixture(); const input = { drafts: [{ id: f.draft.id, revision: 1 }] };
    const path = `/api/companies/${f.id}/marketing/queue`;
    expect((await request(app(f.id, "agent")).post(path).send(input)).status).toBe(403);
    expect((await request(app(randomUUID())).post(path).send(input)).status).toBe(403);
    expect((await request(app(f.id)).post(path).send(input)).status).toBe(409);
    const transport = { capabilities: { platforms: ["naver_blog"], media: false }, publish: vi.fn(), reconcile: vi.fn() };
    const unsupported = { ...transport, capabilities: { platforms: [], media: false } };
    expect((await request(app(f.id, "board", unsupported)).post(path).send(input)).status).toBe(409);
    expect((await f.service.overview(f.id)).jobs).toHaveLength(0);
    const result = await request(app(f.id, "board", transport)).post(path).send(input);
    expect(result.status).toBe(201); expect(result.body[0].approvedBy).toBe("operator");
    const logs = await db.select().from(activityLog).where(eq(activityLog.companyId, f.id));
    expect(logs).toHaveLength(1); expect(logs[0].action).toBe("marketing.publication_approved");
    expect(logs[0].details).not.toHaveProperty("content");
  });
  it("API rejects unvalidated input before mutating", async () => {
    const f = await fixture();
    const res = await request(app(f.id)).post(`/api/companies/${f.id}/marketing/queue`).send({ drafts: [{ id: f.draft.id, revision: 1 }, { id: f.draft.id, revision: 1 }] });
    expect(res.status).toBe(400); expect((await f.service.overview(f.id)).jobs).toHaveLength(0);
  });
  it("validates selected dispatch IDs and keeps the 50-draft approval limit", async () => {
    const f = await fixture(); const transport = { publish: vi.fn(), reconcile: vi.fn() };
    const client = app(f.id, "board", transport), path = `/api/companies/${f.id}/marketing/dispatch`;
    expect((await request(client).post(path).send({ projectId: f.project.id, jobIds: [] })).status).toBe(400);
    expect((await request(client).post(path).send({ projectId: f.project.id, jobIds: ["invalid"] })).status).toBe(400);
    const valid = await request(client).post(path).send({ projectId: f.project.id, jobIds: Array.from({ length: 50 }, () => randomUUID()) });
    // Other cases can leave unresolved jobs: validation must not bypass that lock.
    expect([200, 409]).toContain(valid.status);
    expect(transport.publish).not.toHaveBeenCalled();
  });
});
