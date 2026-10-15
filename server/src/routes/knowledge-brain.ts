import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { badRequest } from "../errors.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { decodeBrainFile, knowledgeBrainService } from "../services/knowledge-brain.js";
import { validate } from "../middleware/validate.js";
import { accessService } from "../services/access.js";
import { forbidden } from "../errors.js";

export function knowledgeBrainRoutes(db: Db) {
  const router = Router(), service = knowledgeBrainService(db), access = accessService(db);
  const base = "/companies/:companyId/knowledge";
  router.use(base, async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.companyId).success) throw badRequest("회사를 선택해 주세요.");
    assertCompanyAccess(req, req.params.companyId as string); assertBoard(req);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin
      && !(await access.canUser(req.params.companyId as string, req.actor.userId, "tools:use"))) throw forbidden("이 회사의 연결을 사용할 권한이 없습니다.");
    res.setHeader("Cache-Control", "no-store"); next();
  });
  router.get(`${base}/vaults`, async (req, res) => res.json(await service.list(req.params.companyId as string, req.actor.userId ?? "")));
  router.post(`${base}/:connectionId/read`, validate(z.object({ tool: z.string().max(100), arguments: z.record(z.string(), z.unknown()) }).strict()), async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.connectionId).success) throw badRequest("보관함을 선택해 주세요.");
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", abort);
    try { res.json(await service.call(req.params.companyId as string, req.params.connectionId as string, req.actor.userId ?? "", req.body.tool, req.body.arguments, controller.signal)); }
    finally { res.off("close", abort); }
  });
  router.get(`${base}/:connectionId/file`, async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.connectionId).success || typeof req.query.id !== "string" || req.query.id.length > 300
      || (req.query.revision !== undefined && typeof req.query.revision !== "string")) throw badRequest("파일을 선택해 주세요.");
    const file = decodeBrainFile(await service.call(req.params.companyId as string, req.params.connectionId as string, req.actor.userId ?? "", "knowledge_file",
      { id: req.query.id, ...(req.query.revision ? { revision: req.query.revision } : {}) }));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Disposition", `${file.inline && req.query.download !== "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.type(file.contentType).send(file.bytes);
  });
  return router;
}
