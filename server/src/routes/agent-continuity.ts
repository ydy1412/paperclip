import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { saveHandoffSchema, sendAgentMessageSchema } from "@paperclipai/shared";
import { agentService } from "../services/agents.js";
import { agentContinuityService } from "../services/agent-continuity.js";
import { accessService } from "../services/access.js";
import { forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, hasCompanyAccess } from "./authz.js";

export function agentContinuityRoutes(db: Db) {
  const router = Router();
  const svc = agentContinuityService(db);
  const access = accessService(db);
  async function scope(req: Request, write = false) {
    const id = z.string().uuid().parse(req.params.id);
    const agent = await agentService(db).getById(id);
    if (!agent || !hasCompanyAccess(req, agent.companyId)) throw notFound("Agent not found");
    assertCompanyAccess(req, agent.companyId);
    if (req.actor.type === "agent") {
      if (req.actor.agentId !== id) throw forbidden("Agents may only access their own continuity and mailbox");
    } else {
      assertBoard(req);
      if (write) {
        const decision = await access.decide({ actor: req.actor, action: "agents:create", resource: { type: "company", companyId: agent.companyId } });
        if (!decision.allowed) throw forbidden(decision.explanation);
      }
    }
    return { agent, actor: req.actor.type === "agent" ? { type: "agent" as const, id, runId: req.actor.runId } : { type: "user" as const, id: req.actor.userId ?? "local-board" } };
  }
  router.get("/agents/:id/continuity", async (req, res) => {
    const { agent } = await scope(req);
    res.json(await svc.assess(agent.companyId, agent.id));
  });
  router.get("/agents/:id/handoffs", async (req, res) => {
    const { agent } = await scope(req);
    res.json(await svc.handoffs(agent.companyId, agent.id));
  });
  router.post("/agents/:id/handoffs", validate(saveHandoffSchema), async (req, res) => {
    const { agent, actor } = await scope(req, true);
    res.status(201).json(await svc.saveHandoff(agent.companyId, agent.id, req.body, actor));
  });
  router.get("/agents/:id/mailbox", async (req, res) => {
    const { agent } = await scope(req);
    const threadId = req.query.threadId === undefined ? undefined : z.string().uuid().parse(req.query.threadId);
    const unread = z.enum(["true", "false"]).default("false").parse(req.query.unread);
    res.json(await svc.mailbox(agent.companyId, agent.id, unread === "true", threadId));
  });
  router.post("/agents/:id/mailbox", validate(sendAgentMessageSchema), async (req, res) => {
    const { agent, actor } = await scope(req, true);
    res.status(201).json(await svc.send(agent.companyId, agent.id, req.body, actor));
  });
  router.post("/agents/:id/mailbox/:messageId/read", async (req, res) => {
    const { agent, actor } = await scope(req, true);
    res.json(await svc.read(agent.companyId, agent.id, z.string().uuid().parse(req.params.messageId), actor));
  });
  return router;
}
