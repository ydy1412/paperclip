import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { sourcingCatalogScopeSchema } from "@paperclipai/shared";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { pluginRegistryService } from "../services/plugin-registry.js";
import { autoSourcingPluginService } from "../services/auto-sourcing-plugin.js";
import { badRequest } from "../errors.js";
import { logActivity } from "../services/activity-log.js";

export function sourcingCatalogRoutes(db: Db, options: { processingPort?: number } = {}) {
  const router = Router(); const base = "/companies/:companyId/sourcing/projects/:projectId/catalog";
  router.post(base, async (req, res) => {
    const scope = sourcingCatalogScopeSchema.parse(req.params);
    assertCompanyAccess(req, scope.companyId); assertBoard(req); res.setHeader("Cache-Control", "no-store");
    const plugin = (await pluginRegistryService(db).list()).find(p => p.pluginKey === "paperclipai.plugin-auto-sourcing" && p.status === "ready");
    if (!plugin) throw badRequest("Auto Sourcing 연결을 확인해 주세요.");
    const service = autoSourcingPluginService(db, plugin.id, options); const context = { invocationScope: { companyId: scope.companyId } };
    const input = { ...req.body, ...scope }; // Route scope is authoritative.
    const result = ["business", "store", "attach"].includes(input.operation) ? await service.operatorSettings(input, context)
      : ["settings", "list", "stages", "sources", "get", "jobs", "import-status", "workspace", "price-preview", "category-recommend", "category-metadata", "image-inspect", "image-content", "image-provider-status", "image-jobs", "image-job-settings"].includes(input.operation) ? await service.catalogRead(input, context) : await service.catalogWrite(input, context);
    if (["business", "store", "attach"].includes(input.operation)) {
      const actor = getActorInfo(req);
      await logActivity(db, { companyId: scope.companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId,
        action: `sourcing.settings_${input.operation}`, entityType: "project", entityId: scope.projectId, details: { operation: input.operation } });
    }
    res.json(result);
  });
  router.get("/companies/:companyId/sourcing/projects/:projectId/images/:productId/:assetId.png", async (req, res) => {
    const scope = sourcingCatalogScopeSchema.parse(req.params);
    assertCompanyAccess(req, scope.companyId); assertBoard(req);
    const plugin = (await pluginRegistryService(db).list()).find(p => ["paperclipai.plugin-auto-sourcing", "paperclipai.plugin-sourcing-processing"].includes(p.pluginKey) && p.status === "ready");
    if (!plugin) throw badRequest("Auto Sourcing 연결을 확인해 주세요.");
    const result = await autoSourcingPluginService(db, plugin.id, options).catalogRead({ ...scope, operation: "image-content", productId: req.params.productId, assetId: req.params.assetId }, { invocationScope: { companyId: scope.companyId } }) as { base64: string; contentType: string };
    res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(result.contentType).send(Buffer.from(result.base64, "base64"));
  }); return router;
}
