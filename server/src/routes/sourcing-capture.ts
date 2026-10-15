import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { sourcingCaptureService } from "../services/sourcing-capture.js";
import { logActivity } from "../services/activity-log.js";
import { forbidden } from "../errors.js";

const scopeSchema = z.object({ companyId: z.string().uuid(), projectId: z.string().uuid() });
export function sourcingCaptureRoutes(db: Db, options: { processingPort?: number; allowLocalBoard?: boolean } = {}) {
  const service = sourcingCaptureService(db, options), ingress = Router(), management = Router();
  // This ingress never accepts a board cookie, agent key, URL token or caller-supplied scope.
  ingress.post("/api/sourcing-capture", async (req, res) => {
    res.set("Cache-Control", "no-store"); res.set("X-Content-Type-Options", "nosniff");
    res.json(await service.capture(req.header("authorization"), req.body));
  });
  const base = "/companies/:companyId/sourcing/projects/:projectId/capture-connections";
  management.use(base, (req, res, next) => { assertBoard(req); assertCompanyAccess(req, scopeSchema.parse(req.params).companyId); res.set("Cache-Control", "no-store"); next(); });
  const user = (req: Express.Request) => {
    if (req.actor.userId) return req.actor.userId;
    if (req.actor.source === "local_implicit") return "local-board";
    throw forbidden("로그인한 운영자로 연결해 주세요.");
  };
  management.get(base, async (req, res) => {
    const { companyId, projectId } = scopeSchema.parse(req.params);
    res.json({ connections: await service.list(companyId, projectId, user(req)), serverUrl: process.env.PAPERCLIP_SOURCING_CAPTURE_URL ?? "" });
  });
  management.post(base, async (req, res) => {
    const { companyId, projectId } = scopeSchema.parse(req.params);
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(req.body);
    const result = await service.create(companyId, projectId, user(req), req.actor.source === "local_implicit", name);
    const actor = getActorInfo(req);
    await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "sourcing.capture_connection_created", entityType: "project", entityId: projectId, details: { connectionId: result.id } });
    res.status(201).json(result);
  });
  management.delete(`${base}/:id`, async (req, res) => {
    const { companyId, projectId } = scopeSchema.parse(req.params);
    const id = z.string().uuid().parse(req.params.id);
    await service.revoke(companyId, projectId, user(req), id);
    const actor = getActorInfo(req);
    await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "sourcing.capture_connection_revoked", entityType: "project", entityId: projectId, details: { connectionId: id } });
    res.status(204).end();
  });
  return { ingress, management };
}
