import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  createMarketingProfileSchema, updateMarketingProfileSchema,
  createMarketingChannelSchema, updateMarketingChannelSchema,
  createMarketingDraftSchema, updateMarketingDraftSchema, queueMarketingDraftsSchema,
  generateMarketingDraftsSchema, importMarketingDraftsSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { marketingService } from "../services/marketing.js";
import { logActivity } from "../services/activity-log.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, forbidden, conflict } from "../errors.js";
import { marketingAsideProfiles, assertMarketingAsideBinding } from "../services/marketing-aside-profiles.js";
import { checkMarketingNaverAccount } from "../services/marketing-naver-account.js";
import { marketingDispatchService, type MarketingPublicationTransport } from "../services/marketing-dispatch.js";
import type { StorageService } from "../storage/index.js";
import { marketingConnectionQueue } from "../services/marketing-connection-queue.js";

export function marketingRoutes(db: Db, transport?: MarketingPublicationTransport, storage?: StorageService) {
  const router = Router();
  const service = marketingService(db, storage);
  const dispatcher = transport ? marketingDispatchService(db, transport) : null;
  const connections = marketingConnectionQueue(db);
  router.param("id", (req, _res, next, value) => {
    if (!z.string().uuid().safeParse(value).success) throw badRequest("유효한 항목 ID가 필요합니다.");
    next();
  });
  router.use("/companies/:companyId/marketing", (req, _res, next) => {
    if (!z.string().uuid().safeParse(req.params.companyId).success) throw badRequest("유효한 회사 ID가 필요합니다.");
    assertCompanyAccess(req, req.params.companyId as string);
    const agentDraftTool = req.actor.type === "agent" && req.path === "/draft-tools" && ["GET", "POST"].includes(req.method);
    if (!agentDraftTool) assertBoard(req);
    next();
  });
  async function audit(req: Parameters<typeof getActorInfo>[0], action: string, id: string, details: Record<string, unknown> = {}) {
    const actor = getActorInfo(req);
    await logActivity(db, { companyId: req.params.companyId as string, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId, action, entityType: "marketing", entityId: id, details });
  }
  router.get("/companies/:companyId/marketing/draft-tools", async (req, res) => {
    if (req.actor.type !== "agent" || !req.actor.agentId) throw forbidden("에이전트 인증이 필요합니다.");
    const issueId = z.string().uuid().safeParse(req.query.issueId);
    if (!issueId.success) throw badRequest("작업 ID가 필요합니다.");
    const context = await service.draftToolContext(req.params.companyId as string, issueId.data, req.actor.agentId);
    res.json({ ...context, media: await service.mediaChoices(req.params.companyId as string, context.projectId) });
  });
  router.post("/companies/:companyId/marketing/draft-tools", validate(createMarketingDraftSchema.extend({ issueId: z.string().uuid() })), async (req, res) => {
    if (req.actor.type !== "agent" || !req.actor.agentId) throw forbidden("에이전트 인증이 필요합니다.");
    const { issueId, ...input } = req.body;
    const row = await service.createDraft(req.params.companyId as string, input, { issueId, agentId: req.actor.agentId });
    await audit(req, "marketing.agent_draft_submitted", row.id, { issueId, channelId: row.channelId });
    res.json(row);
  });
  router.get("/companies/:companyId/marketing", async (req, res) => {
    res.json({ ...await service.overview(req.params.companyId as string), publicationEnabled: !!dispatcher, publicationCapabilities: transport?.capabilities });
  });
  router.post("/companies/:companyId/marketing/connection-checks", validate(z.object({ projectId: z.string().uuid(), channelIds: z.array(z.string().uuid()).min(1).max(100).optional() }).strict()), async (req, res) => {
    const rows = await connections.enqueue(req.params.companyId as string, req.body.projectId, req.body.channelIds);
    await audit(req, "marketing.connection_checks_requested", req.body.projectId, { jobIds: rows.map(row => row.id) });
    res.status(202).json({ jobs: rows.map(row => ({ id: row.id, channelId: row.channelId, status: row.status })) });
  });
  router.get("/companies/:companyId/marketing/connection-checks", async (req, res) => {
    const projectId = z.string().uuid().safeParse(req.query.projectId);
    if (!projectId.success) throw badRequest("프로젝트를 선택하십시오.");
    res.json(await connections.overview(req.params.companyId as string, projectId.data));
  });
  router.patch("/companies/:companyId/marketing/projects/:id/connection-monitor", validate(z.object({ enabled: z.boolean() }).strict()), async (req, res) => {
    const row = await connections.setMonitor(req.params.companyId as string, req.params.id as string, req.body.enabled);
    await audit(req, "marketing.connection_monitor_updated", row.projectId, { enabled: row.enabled });
    res.json({ companyId: row.companyId, projectId: row.projectId, enabled: row.enabled, nextCheckAt: row.nextCheckAt });
  });
  router.post("/companies/:companyId/marketing/generation-instructions", validate(generateMarketingDraftsSchema), async (req, res) => {
    res.json(await service.generationInstructions(req.params.companyId as string, req.body));
  });
  router.post("/companies/:companyId/marketing/import-generated", validate(importMarketingDraftsSchema), async (req, res) => {
    const rows = await service.importGeneratedDrafts(req.params.companyId as string, req.body.issueId);
    await audit(req, "marketing.generated_drafts_imported", req.body.issueId, { draftIds: rows.map(row => row.id) });
    res.json(rows);
  });
  router.get("/companies/:companyId/marketing/media", async (req, res) => {
    const projectId = z.string().uuid().safeParse(req.query.projectId);
    if (!projectId.success) throw badRequest("프로젝트를 선택하십시오.");
    res.json(await service.mediaChoices(req.params.companyId as string, projectId.data));
  });
  router.get("/companies/:companyId/marketing/browser-profiles", async (_req, res) => {
    res.json(await marketingAsideProfiles());
  });
  router.post("/companies/:companyId/marketing/channels/:id/check-account", async (req, res) => {
    const overview = await service.overview(req.params.companyId as string);
    const channel = overview.channels.find(channel => channel.id === req.params.id);
    const profile = channel && overview.profiles.find(profile => profile.id === channel.profileId);
    if (!channel || !profile) throw badRequest("채널 또는 연결 프로필을 찾을 수 없습니다.");
    if (channel.platform !== "naver_blog") throw badRequest("이 채널의 계정 확인 연결은 아직 완료되지 않았습니다.");
    const checked = await checkMarketingNaverAccount(profile);
    res.json({ ...checked, matches: checked.signedIn && checked.accountId === channel.accountId });
  });
  router.post("/companies/:companyId/marketing/profiles", validate(createMarketingProfileSchema), async (req, res) => {
    assertMarketingAsideBinding(await marketingAsideProfiles(), req.body);
    const row = await service.createProfile(req.params.companyId as string, req.body);
    await audit(req, "marketing.profile_created", row.id);
    res.status(201).json(row);
  });
  router.patch("/companies/:companyId/marketing/profiles/:id", validate(updateMarketingProfileSchema), async (req, res) => {
    if (req.body.asideAccountId || req.body.browserProfileName) {
      const current = (await service.overview(req.params.companyId as string)).profiles.find(profile => profile.id === req.params.id);
      if (!current) throw badRequest("프로필을 찾을 수 없습니다.");
      assertMarketingAsideBinding(await marketingAsideProfiles(), { asideAccountId: req.body.asideAccountId || current.asideAccountId, browserProfileName: req.body.browserProfileName || current.browserProfileName });
    }
    const row = await service.updateProfile(req.params.companyId as string, req.params.id as string, req.body);
    await audit(req, "marketing.profile_updated", row.id);
    res.json(row);
  });
  router.post("/companies/:companyId/marketing/channels", validate(createMarketingChannelSchema), async (req, res) => {
    const row = await service.createChannel(req.params.companyId as string, req.body);
    await audit(req, "marketing.channel_created", row.id);
    res.status(201).json(row);
  });
  router.patch("/companies/:companyId/marketing/channels/:id", validate(updateMarketingChannelSchema), async (req, res) => {
    const row = await service.updateChannel(req.params.companyId as string, req.params.id as string, req.body);
    await audit(req, "marketing.channel_updated", row.id);
    res.json(row);
  });
  router.post("/companies/:companyId/marketing/drafts", validate(createMarketingDraftSchema), async (req, res) => {
    const row = await service.createDraft(req.params.companyId as string, req.body);
    await audit(req, "marketing.draft_created", row.id);
    res.status(201).json(row);
  });
  router.patch("/companies/:companyId/marketing/drafts/:id", validate(updateMarketingDraftSchema), async (req, res) => {
    const row = await service.updateDraft(req.params.companyId as string, req.params.id as string, req.body);
    await audit(req, "marketing.draft_updated", row.id, { revision: row.revision });
    res.json(row);
  });
  router.post("/companies/:companyId/marketing/queue", validate(queueMarketingDraftsSchema), async (req, res) => {
    const actor = getActorInfo(req);
    if (!dispatcher) throw conflict("발행 연결이 활성화되지 않았습니다.");
    const rows = await service.queueDrafts(req.params.companyId as string, req.body, actor.actorId, transport?.capabilities);
    for (const row of rows) await audit(req, "marketing.publication_approved", row.id, { draftId: row.draftId, revision: row.revision, snapshotHash: row.snapshotHash });
    res.status(201).json(rows);
  });
  router.post("/companies/:companyId/marketing/jobs/:id/cancel", async (req, res) => {
    const row = await service.cancelJob(req.params.companyId as string, req.params.id as string);
    await audit(req, "marketing.publication_cancelled", row.id);
    res.json(row);
  });
  router.post("/companies/:companyId/marketing/dispatch", validate(z.object({ projectId: z.string().uuid(), jobIds: z.array(z.string().uuid()).min(1).max(50).optional() }).strict()), async (req, res) => {
    if (!dispatcher) throw conflict("현재 마케팅은 초안 작성·검토 전용입니다.");
    const results = await dispatcher.dispatch(req.params.companyId as string, req.body.projectId, req.body.jobIds);
    await audit(req, "marketing.dispatch_completed", req.params.companyId as string, { results });
    res.json(results);
  });
  router.post("/companies/:companyId/marketing/profiles/:id/resume", validate(z.object({ channelId: z.string().uuid() }).strict()), async (req, res) => {
    const overview = await service.overview(req.params.companyId as string);
    const profile = overview.profiles.find(row => row.id === req.params.id);
    const channel = overview.channels.find(row => row.id === req.body.channelId && row.profileId === profile?.id);
    if (!profile || !channel || channel.platform !== "naver_blog") throw badRequest("연결된 네이버 채널을 선택하십시오.");
    const checked = await checkMarketingNaverAccount(profile);
    if (!checked.signedIn || checked.accountId !== channel.accountId) throw badRequest("대상 네이버 계정으로 로그인된 상태가 아닙니다.");
    const result = await service.resumeProfile(req.params.companyId as string, profile.id, channel.id, checked.accountId, profile);
    await audit(req, "marketing.profile_resumed", profile.id);
    res.json(result);
  });
  router.post("/companies/:companyId/marketing/jobs/:id/reconcile", validate(z.object({}).strict()), async (req, res) => {
    if (!dispatcher) throw conflict("현재 마케팅은 초안 작성·검토 전용입니다.");
    const result = await dispatcher.reconcile(req.params.companyId as string, req.params.id as string);
    await audit(req, "marketing.publication_reconciled", req.params.id as string, { status: result.status });
    res.json(result);
  });
  router.post("/companies/:companyId/marketing/jobs/:id/retry", validate(z.object({}).strict()), async (req, res) => {
    if (!dispatcher) throw conflict("현재 마케팅은 초안 작성·검토 전용입니다.");
    const result = await dispatcher.retry(req.params.companyId as string, req.params.id as string);
    await audit(req, "marketing.publication_retry_queued", req.params.id as string);
    res.json(result);
  });
  return router;
}
