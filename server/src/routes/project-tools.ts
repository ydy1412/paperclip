import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { projectToolContext } from "../services/project-tool-context.js";
import { callProjectTool, projectToolDefinitions } from "../services/project-tools.js";
import { assertCompanyAccess } from "./authz.js";
import { forbidden } from "../errors.js";
import type { createToolGatewayService } from "../services/tool-gateway.js";

type PluginGateway = Pick<ReturnType<typeof createToolGatewayService>, "listPluginToolsForAgent" | "executePluginTool">;
const pluginDefinitions = [
  { name: "paperclip_search_plugin_tools", description: "Find tools from installed Paperclip plugins, including Marketing Drafts. Search by purpose or browse with an empty query; use the returned exact tool name and parametersSchema with paperclip_call_plugin_tool.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false } },
  { name: "paperclip_call_plugin_tool", description: "Call an installed Paperclip plugin tool discovered with paperclip_search_plugin_tools. The current authenticated task/chat and run determine identity and permissions. Draft submission never approves or publishes a post.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, arguments: { type: "object", additionalProperties: true } }, required: ["name", "arguments"], additionalProperties: false } },
];

/** Mounted after actor middleware; connection-scoped tokens cannot authenticate here. */
export function projectToolRoutes(db: Db, pluginGateway?: PluginGateway) {
  const router = Router();
  router.post("/mcp/project-tools", async (req, res) => {
    const context = await projectToolContext(db, req.actor);
    assertCompanyAccess(req, context.run.companyId);
    const { id = null, method, params } = req.body;
    const send = (result: unknown) => res.json({ jsonrpc: "2.0", id, result });
    if (method === "initialize") return send({ protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "paperclip-project-tools", version: "1" } });
    if (method === "notifications/initialized") return res.status(202).end();
    const definitions = [...projectToolDefinitions(context.issue.workMode, true),
      ...(pluginGateway && context.issue.workMode === "standard" ? pluginDefinitions : [])];
    if (method === "tools/list") return send({ tools: definitions });
    if (method !== "tools/call") return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    try {
      if (!definitions.some(tool => tool.name === params?.name)) throw forbidden("Tool is unavailable in this mode");
      if (params.name === "paperclip_search_plugin_tools" && pluginGateway) {
        const query = params.arguments?.query ?? "";
        if (typeof query !== "string" || query.length > 200) throw forbidden("Invalid plugin search");
        const tools = await pluginGateway.listPluginToolsForAgent({ companyId: context.run.companyId, agentId: context.run.agentId });
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const matches = tools.filter(tool => terms.every(term => `${tool.name} ${tool.displayName} ${tool.description}`.toLowerCase().includes(term)));
        return send({ content: [{ type: "text", text: JSON.stringify({ tools: matches }) }], structuredContent: { tools: matches } });
      }
      if (params.name === "paperclip_call_plugin_tool" && pluginGateway) {
        if (typeof params.arguments?.name !== "string" || !params.arguments.arguments || typeof params.arguments.arguments !== "object" || Array.isArray(params.arguments.arguments)) throw forbidden("Invalid plugin tool arguments");
        const result = await pluginGateway.executePluginTool({ actor: { type: "agent", companyId: context.run.companyId, agentId: context.run.agentId, runId: context.run.id }, tool: params.arguments.name, parameters: params.arguments.arguments,
          runContext: { companyId: context.run.companyId, agentId: context.run.agentId, runId: context.run.id, projectId: context.issue.projectId ?? "" } });
        return send({ content: [{ type: "text", text: JSON.stringify(result) }] });
      }
      const apiUrl = process.env.PAPERCLIP_API_URL;
      if (!apiUrl) throw new Error("Paperclip API origin is unavailable");
      const result = await callProjectTool({
        name: params.name, arguments: params.arguments ?? {}, apiUrl,
        token: req.header("authorization")!.replace(/^Bearer\s+/i, ""),
        companyId: context.run.companyId, issueId: context.issue.id, agentId: context.run.agentId,
        conversation: Boolean(context.issue.conversationAgentId),
      });
      return send({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    } catch (error) {
      return send({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Project tool failed" }] });
    }
  });
  return router;
}
