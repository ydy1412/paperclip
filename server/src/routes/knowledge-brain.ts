import multer from "multer";
import { logActivity } from "../services/activity-log.js";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { badRequest, HttpError } from "../errors.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { BRAIN_WRITE_TOOLS, decodeBrainFile, knowledgeBrainService } from "../services/knowledge-brain.js";
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
  async function mutate(req: import("express").Request, tool: string, args: Record<string, unknown>) {
    if (!z.string().uuid().safeParse(req.params.connectionId).success || !BRAIN_WRITE_TOOLS.has(tool)) throw badRequest("허용되지 않은 자료 수정입니다.");
    const result = await service.call(req.params.companyId as string, req.params.connectionId as string, req.actor.userId ?? "", tool, args, undefined, true);
    await logActivity(db, { companyId: req.params.companyId as string, actorType: "user", actorId: req.actor.userId ?? "board",
      action: "knowledge." + tool.replace(/^knowledge_/, ""), entityType: "tool_connection", entityId: req.params.connectionId as string,
      details: { operationId: args.operationId } });
    return result;
  }
  router.post(`${base}/:connectionId/write`, validate(z.object({ tool: z.string().max(100), arguments: z.record(z.string(), z.unknown()) }).strict()), async (req, res) => {
    if (req.body.tool === "knowledge_upload") throw badRequest("파일 업로드를 사용해 주세요.");
    res.json(await mutate(req, req.body.tool, req.body.arguments));
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 2, fieldSize: 300 } });
  router.post(`${base}/:connectionId/upload`, (req, res, next) => upload.single("file")(req, res, error => {
    if (error) return next(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? new HttpError(413, "파일은 25MiB까지 업로드할 수 있습니다.") : badRequest("업로드할 파일을 확인해 주세요."));
    next();
  }), async (req, res) => {
    if (!req.file) throw badRequest("업로드할 파일을 선택해 주세요.");
    res.json(await mutate(req, "knowledge_upload", { parentId: req.body.parentId, operationId: req.body.operationId,
      name: Buffer.from(req.file.originalname, "latin1").toString("utf8"), base64: req.file.buffer.toString("base64") }));
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
