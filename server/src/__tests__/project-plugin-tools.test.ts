import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { projectToolRoutes } from "../routes/project-tools.js";

const context = vi.hoisted(() => ({ run: { companyId: "company", agentId: "agent", id: "run" }, issue: { id: "issue", workMode: "standard", projectId: null } }));
vi.mock("../services/project-tool-context.js", () => ({ projectToolContext: vi.fn(async () => context) }));

describe("project MCP plugin delivery", () => {
  const gateway = {
    listPluginToolsForAgent: vi.fn(async () => [{ name: "marketing:submit", displayName: "Marketing Drafts", description: "Submit a marketing draft", pluginId: "plugin", parametersSchema: { type: "object" } }]),
    executePluginTool: vi.fn(async () => ({ content: "registered", data: { id: "draft" } })),
  };
  function app() {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "agent", source: "agent_jwt", companyId: "company", companyIds: ["company"], agentId: "agent", runId: "run" }; next(); });
    app.use(projectToolRoutes({} as Db, gateway as never));
    return app;
  }
  const rpc = (name: string, args: unknown = {}) => request(app()).post("/mcp/project-tools").send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  beforeEach(() => { vi.clearAllMocks(); context.issue.workMode = "standard"; });

  it("advertises generic plugin tools over the existing MCP endpoint", async () => {
    const result = await request(app()).post("/mcp/project-tools").send({ id: 1, method: "tools/list" });
    expect(result.body.result.tools.map((tool: { name: string }) => tool.name)).toContain("paperclip_search_plugin_tools");
    const found = await rpc("paperclip_search_plugin_tools", { query: "marketing" });
    expect(found.body.result.structuredContent.tools[0].name).toBe("marketing:submit");
    expect((await rpc("paperclip_search_plugin_tools", { query: "absent" })).body.result.structuredContent.tools).toEqual([]);
  });

  it("uses authenticated identity even in an unscoped conversation", async () => {
    const result = await rpc("paperclip_call_plugin_tool", { name: "marketing:submit", arguments: { companyId: "forged", runId: "forged" } });
    expect(result.body.result.content[0].text).toContain("draft");
    expect(gateway.executePluginTool).toHaveBeenCalledWith(expect.objectContaining({
      runContext: { companyId: "company", agentId: "agent", runId: "run", projectId: "" },
    }));
  });

  it("hides calls in Ask mode and preserves gateway failures", async () => {
    context.issue.workMode = "ask";
    expect((await rpc("paperclip_call_plugin_tool", { name: "marketing:submit", arguments: {} })).body.result.isError).toBe(true);
    expect(gateway.executePluginTool).not.toHaveBeenCalled();
    context.issue.workMode = "standard";
    gateway.executePluginTool.mockRejectedValueOnce(new Error("permission revoked"));
    const denied = await rpc("paperclip_call_plugin_tool", { name: "marketing:submit", arguments: {} });
    expect(denied.body.result).toMatchObject({ isError: true });
    expect(denied.body.result.content[0].text).toBe("permission revoked");
  });
});
