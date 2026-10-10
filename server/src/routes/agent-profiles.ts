import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createAgentProfileSchema, updateAgentProfileSchema, restoreAgentProfileSchema, deleteAgentProfileSchema } from "@paperclipai/shared";
import { badRequest, unauthorized } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { agentProfileService } from "../services/agent-profiles.js";

export function agentProfileRoutes(db: Db) {
  const router = Router(), service = agentProfileService(db), base = "/companies/:companyId/agent-profiles";
  router.use(base, (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.companyId).success) throw badRequest("회사를 선택해 주세요.");
    assertCompanyAccess(req, req.params.companyId as string); assertBoard(req);
    if (!req.actor.userId) throw unauthorized("로그인이 필요합니다.");
    res.setHeader("Cache-Control", "no-store"); next();
  });
  router.param("profileId", (_req, _res, next, id) => { if (!z.string().uuid().safeParse(id).success) throw badRequest("프로필 ID를 확인해 주세요."); next(); });
  router.get(base, async (req, res) => res.json(await service.list(req.params.companyId as string)));
  router.get(`${base}/:profileId`, async (req, res) => res.json(await service.get(req.params.companyId as string, req.params.profileId as string)));
  router.post(base, validate(createAgentProfileSchema), async (req, res) => res.status(201).json(await service.create(req.params.companyId as string, req.body, req.actor.userId!)));
  router.post(`${base}/from-agent`, validate(z.object({ agentId: z.string().uuid() }).strict()), async (req, res) => res.status(201).json(await service.fromAgent(req.params.companyId as string, req.body.agentId, req.actor)));
  router.patch(`${base}/:profileId`, validate(updateAgentProfileSchema), async (req, res) => res.json(await service.update(req.params.companyId as string, req.params.profileId as string, req.body, req.actor.userId!)));
  router.post(`${base}/:profileId/restore`, validate(restoreAgentProfileSchema), async (req, res) => res.json(await service.restore(req.params.companyId as string, req.params.profileId as string, req.body, req.actor.userId!)));
  router.delete(`${base}/:profileId`, validate(deleteAgentProfileSchema), async (req, res) => { await service.remove(req.params.companyId as string, req.params.profileId as string, req.body.expectedVersion, req.actor.userId!); res.status(204).end(); });
  return router;
}
