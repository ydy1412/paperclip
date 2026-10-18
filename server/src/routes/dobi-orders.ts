import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { dobiOrdersService, type DobiOrdersOptions } from "../services/dobi-orders.js";
import { logActivity } from "../services/activity-log.js";
import { badRequest, forbidden } from "../errors.js";

export const DOBI_ORDERS_PATH = "/companies/:companyId/sourcing/projects/:projectId/order-management";
const scopeSchema = z.object({ companyId: z.string().uuid(), projectId: z.string().uuid() });
const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;

export function dobiOrderRoutes(db: Db, options: DobiOrdersOptions = {}) {
  const service = dobiOrdersService(db, options);
  const router = Router(), bridge = Router();
  async function dispatch(req: Request, res: Response) {
    const { companyId, projectId } = scopeSchema.parse(req.params);
    const base = `/api/companies/${companyId}/sourcing/projects/${projectId}/order-management`;
    const workspace = await service.workspace(companyId, projectId, `${req.protocol}://${req.get("host")}${base}`);
    const scopedRequest = Object.create(req) as Request & { dobiOwnerId: string };
    scopedRequest.url = `/api${req.url === "/" ? "" : req.url}`;
    scopedRequest.dobiOwnerId = req.actor.userId ?? "local-operator";
    if (req.path.startsWith("/bridge/") && req.path !== "/bridge/pair-code" && req.method === "POST") {
      const operation = req.path.split("/")[2];
      res.once("finish", () => {
        if (res.statusCode >= 400) return;
        void logActivity(db, { companyId, actorType: "user", actorId: scopedRequest.dobiOwnerId,
          action: "dobi_orders.bridge_changed", entityType: "project", entityId: projectId,
          details: { method: req.method, operation } }).catch(() => {});
      });
    }
    await workspace.handler(scopedRequest, res);
  }
  // A short-lived capability is granted by an authenticated board pairing code.
  // This router runs before the browser-session CSRF guard, only for this bridge.
  bridge.use(DOBI_ORDERS_PATH, async (req, res, next) => {
    if (!req.path.startsWith("/bridge/") || req.path === "/bridge/pair-code") { next(); return; }
    const origin = req.get("origin");
    if (origin && !extensionOrigin.test(origin)) throw forbidden("브라우저 도우미의 요청만 허용합니다.");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Dobi-Bridge");
    }
    scopeSchema.parse(req.params);
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    if (!["GET", "POST"].includes(req.method)) throw badRequest("지원하지 않는 요청입니다.");
    await dispatch(req, res);
  });
  router.use(DOBI_ORDERS_PATH, async (req, res) => {
    const { companyId, projectId } = scopeSchema.parse(req.params);
    assertBoard(req); assertCompanyAccess(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) {
      const actor = getActorInfo(req);
      res.once("finish", () => {
        if (res.statusCode >= 400) return;
        void logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId,
          action: "dobi_orders.changed", entityType: "project", entityId: projectId,
          details: { method: req.method, operation: req.path.split("/")[1] } }).catch(() => {});
      });
    }
    await dispatch(req, res);
  });
  return { router, bridge, close: service.close };
}
