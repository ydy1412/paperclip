import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues, projects, projectWorkspaces } from "@paperclipai/db";
import type { WorkerHostCallContext } from "@paperclipai/plugin-sdk";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { marketingPluginService } from "../services/marketing-plugin.js";
import { marketingService } from "../services/marketing.js";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";

describe("Marketing plugin native host", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let directory: string;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-marketing-plugin-");
    db = createDb(database.connectionString);
    directory = await mkdtemp(path.join(tmpdir(), "paperclip-marketing-plugin-files-"));
  }, 90000);
  afterAll(async () => { await database?.cleanup(); await rm(directory, { recursive: true, force: true }); });

  it("can replay the additive migration after the operating host overlay", async () => {
    const migration = await readFile(new URL("../../../packages/db/src/migrations/0299_marketing_plugin_draft_run.sql", import.meta.url), "utf8");
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const statement of migration.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
    }
  });

  async function fixture(conversation = false) {
    const companyId = randomUUID();
    const prefix = `P${companyId.slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({ id: companyId, name: "Plugin test", issuePrefix: prefix, defaultResponsibleUserId: "operator" });
    const [agent] = await db.insert(agents).values({ companyId, name: "Writer", role: "general", adapterType: "codex_local" }).returning();
    const [project] = await db.insert(projects).values({ companyId, name: "Marketing project" }).returning();
    const workspace = await mkdtemp(path.join(directory, "workspace-"));
    const [projectWorkspace] = await db.insert(projectWorkspaces).values({ companyId, projectId: project.id, name: "Local", cwd: workspace, isPrimary: true }).returning();
    const [issue] = await db.insert(issues).values({ companyId, title: "Write a useful blog post", status: "in_progress", assigneeAgentId: agent.id,
      ...(conversation ? { conversationAgentId: agent.id, conversationUserId: "operator", conversationState: "active" as const }
        : { projectId: project.id, projectWorkspaceId: projectWorkspace.id }) }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, status: "running", contextSnapshot: { issueId: issue.id } }).returning();
    const context: WorkerHostCallContext = { invocationScope: { companyId, agentRun: { agentId: agent.id, runId: run.id, projectId: issue.projectId ?? "" } } };
    const storage = createStorageService(createLocalDiskStorageProvider(path.join(directory, "storage")));
    const service = marketingService(db, storage);
    const profile = await service.createProfile(companyId, { projectId: project.id, name: "Work", asideAccountId: "u1", browserProfileName: "Work profile" });
    const channel = await service.createChannel(companyId, { projectId: project.id, profileId: profile.id, platform: "naver_blog", name: "Blog", accountId: "my_blog", accountUrl: "https://blog.naver.com/my_blog", concept: "Useful knowledge", tone: "Calm", audience: "Developers", writingRules: "Keep sources" });
    const host = marketingPluginService(db, "paperclipai.plugin-marketing-drafts", storage);
    const input = { companyId, projectId: project.id, channelId: channel.id, topic: "Topic", content: { title: "Title", body: "Original useful copy", media: [] } };
    return { companyId, prefix, agent, project, issue, run, context, service, host, input, workspace, channel, storage };
  }

  it("returns editorial rules without credentials or browser controls", async () => {
    const f = await fixture();
    const result = await f.host.getContext({ companyId: f.companyId }, f.context);
    expect(result).toMatchObject({ projectId: f.project.id, requiresProjectSelection: false });
    expect(result.targets[0]).toMatchObject({ channelId: f.channel.id, writingRules: "Keep sources" });
    expect(JSON.stringify(result)).not.toContain("asideAccountId");
    expect(JSON.stringify(result)).not.toContain("browserProfileName");
  });

  it("deduplicates submissions, attributes the writer, and never queues publication", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.host.submitDraft(f.input, f.context), f.host.submitDraft(f.input, f.context)]);
    expect(a.id).toBe(b.id);
    expect(a.href).toContain(`/${f.prefix}/marketing`);
    await expect(f.host.submitDraft({ ...f.input, content: { ...f.input.content, body: "Changed" } }, f.context)).rejects.toThrow("이미 제출");
    const overview = await f.service.overview(f.companyId);
    expect(overview.drafts).toHaveLength(1);
    expect(overview.drafts[0]).toMatchObject({ generationRunId: f.run.id, author: { agentId: f.agent.id, name: "Writer" } });
    expect(overview.jobs).toHaveLength(0);
  });

  it("rejects missing, forged, stopped and read-only run authority", async () => {
    const f = await fixture();
    await expect(f.host.submitDraft(f.input)).rejects.toThrow("플러그인 호출");
    await expect(f.host.submitDraft(f.input, { ...f.context, invalidInvocationScope: true })).rejects.toThrow();
    await expect(f.host.submitDraft({ ...f.input, companyId: randomUUID() }, f.context)).rejects.toThrow();
    await expect(f.host.submitDraft(f.input, { invocationScope: { companyId: f.companyId, agentRun: { agentId: randomUUID(), runId: f.run.id, projectId: f.project.id } } })).rejects.toThrow();
    await db.update(issues).set({ workMode: "ask" }).where(eq(issues.id, f.issue.id));
    await expect(f.host.submitDraft(f.input, f.context)).rejects.toThrow("계획 모드");
    expect((await f.host.getContext({ companyId: f.companyId }, f.context)).targets).toHaveLength(1);
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, f.run.id));
    await expect(f.host.getContext({ companyId: f.companyId }, f.context)).rejects.toThrow("진행 중");
  });

  it("locks assigned tasks to their project and denies foreign or disabled channels", async () => {
    const f = await fixture(), foreign = await fixture();
    await expect(f.host.getContext({ companyId: f.companyId, projectId: foreign.project.id }, f.context)).rejects.toThrow("다른 프로젝트");
    await expect(f.host.submitDraft({ ...f.input, channelId: foreign.channel.id }, f.context)).rejects.toThrow();
    await f.service.updateChannel(f.companyId, f.channel.id, { enabled: false });
    await expect(f.host.submitDraft(f.input, f.context)).rejects.toThrow("사용 중인 채널");
  });

  it("allows explicit project selection in a conversation and a new draft in a later turn", async () => {
    const f = await fixture(true);
    const available = await f.host.getContext({ companyId: f.companyId }, f.context);
    expect(available.requiresProjectSelection).toBe(true);
    expect(available.projectId).toBeNull();
    const first = await f.host.submitDraft(f.input, f.context);
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, f.run.id));
    const [next] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.agent.id, status: "running", contextSnapshot: { issueId: f.issue.id } }).returning();
    const second = await f.host.submitDraft({ ...f.input, content: { ...f.input.content, body: "New topic request" } }, { invocationScope: { companyId: f.companyId, agentRun: { agentId: f.agent.id, runId: next.id, projectId: "" } } });
    expect(second.id).not.toBe(first.id);
    const foreign = await fixture();
    await expect(f.host.getContext({ companyId: f.companyId, projectId: foreign.project.id }, f.context)).rejects.toThrow();
  });

  it("uploads real image and video files with bounded workspace access", async () => {
    const f = await fixture();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
    await writeFile(path.join(f.workspace, "image.png"), png);
    await writeFile(path.join(f.workspace, "video.mp4"), Buffer.from("native video test fixture"));
    const image = await f.host.uploadMedia({ companyId: f.companyId, path: "image.png", contentType: "image/png" }, f.context);
    const repeat = await f.host.uploadMedia({ companyId: f.companyId, path: "image.png", contentType: "image/png" }, f.context);
    const video = await f.host.uploadMedia({ companyId: f.companyId, path: "video.mp4", contentType: "video/mp4" }, f.context);
    expect(image.attachmentId).toBe(repeat.attachmentId);
    expect(video.contentType).toBe("video/mp4");
    const result = await f.host.submitDraft({ ...f.input, content: { ...f.input.content, media: [{ attachmentId: image.attachmentId, alt: "Pixel" }, { attachmentId: video.attachmentId, alt: "Fixture" }] } }, f.context);
    expect((await f.service.overview(f.companyId)).drafts.find(draft => draft.id === result.id)?.content.media).toHaveLength(2);
    await expect(f.host.uploadMedia({ companyId: f.companyId, path: "../outside.png", contentType: "image/png" }, f.context)).rejects.toThrow();
    await expect(f.host.uploadMedia({ companyId: f.companyId, path: "image.png", contentType: "video/mp4" }, f.context)).rejects.toThrow("형식");
    const outside = path.join(directory, "outside.png");
    await writeFile(outside, png); await symlink(outside, path.join(f.workspace, "link.png"));
    await expect(f.host.uploadMedia({ companyId: f.companyId, path: "link.png", contentType: "image/png" }, f.context)).rejects.toThrow();
    await writeFile(path.join(f.workspace, "large.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(f.host.uploadMedia({ companyId: f.companyId, path: "large.png", contentType: "image/png" }, f.context)).rejects.toThrow("10 MiB");
    expect(await readFile(path.join(f.workspace, "image.png"))).toEqual(png);
  });

  it("rejects a superseded conversation generation", async () => {
    const f = await fixture(true);
    await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, f.issue.id));
    await expect(f.host.getContext({ companyId: f.companyId }, f.context)).rejects.toThrow("권한");
    await expect(f.host.submitDraft(f.input, f.context)).rejects.toThrow("권한");
    expect((await f.service.overview(f.companyId)).drafts).toHaveLength(0);
  });
});
