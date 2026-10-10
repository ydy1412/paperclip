import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createSourcingForwarderSchema, updateSourcingForwarderSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { badRequest } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { sourcingForwarderService } from "../services/sourcing-forwarders.js";
import type { ForwarderBrowserOpen } from "../services/sourcing-forwarder-browser.js";

export function sourcingForwarderRoutes(db: Db, openBrowser: ForwarderBrowserOpen) {
  const router = Router();
  const service = sourcingForwarderService(db, openBrowser);
  const base = "/companies/:companyId/sourcing/projects/:projectId/forwarders";
  router.use(base, (req, res, next) => {
    if (![req.params.companyId, req.params.projectId].every(id => z.string().uuid().safeParse(id).success)) throw badRequest("회사와 프로젝트를 선택해 주세요.");
    assertCompanyAccess(req, req.params.companyId as string);
    assertBoard(req);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.param("id", (_req, _res, next, id) => { if (!z.string().uuid().safeParse(id).success) throw badRequest("배송대행지 ID가 올바르지 않습니다."); next(); });
  async function audit(req: Parameters<typeof getActorInfo>[0], action: string, id: string, details: Record<string, unknown> = {}) {
    const actor = getActorInfo(req);
    await logActivity(db, { companyId: req.params.companyId as string, actorType: actor.actorType, actorId: actor.actorId,
      agentId: actor.agentId, runId: actor.runId, action, entityType: "sourcing_forwarder", entityId: id, details: { projectId: req.params.projectId, ...details } });
  }
  router.get(base, async (req, res) => { res.json(await service.list(req.params.companyId as string, req.params.projectId as string)); });
  router.get(`${base}/providers`, async (req, res) => { res.json(await service.providers(req.params.companyId as string, req.params.projectId as string)); });
  router.post(base, validate(createSourcingForwarderSchema), async (req, res) => {
    const row = await service.create(req.params.companyId as string, req.params.projectId as string, req.body, req.actor.userId);
    await audit(req, "sourcing.forwarder_created", row.id);
    res.status(201).json(row);
  });
  router.patch(`${base}/:id`, validate(updateSourcingForwarderSchema), async (req, res) => {
    const row = await service.update(req.params.companyId as string, req.params.projectId as string, req.params.id as string, req.body, req.actor.userId);
    await audit(req, "sourcing.forwarder_updated", row.id);
    res.json(row);
  });
  router.delete(`${base}/:id`, async (req, res) => {
    await service.remove(req.params.companyId as string, req.params.projectId as string, req.params.id as string);
    await audit(req, "sourcing.forwarder_deleted", req.params.id as string);
    res.status(204).end();
  });
  router.post(`${base}/:id/open`, validate(z.object({}).strict()), async (req, res) => {
    const result = await service.open(req.params.companyId as string, req.params.projectId as string, req.params.id as string);
    await audit(req, "sourcing.forwarder_opened", req.params.id as string, { status: result.status, browser: result.browser });
    res.json(result);
  });
  return router;
}
