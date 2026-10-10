import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { processingTools } from "./processing-tools.js";
import type { AutoSourcingProcessingRequest } from "@paperclipai/plugin-sdk";
import manifest from "./manifest.js";
import { catalogTools } from "./catalog-tools.js";

const plugin = definePlugin({
  async setup(ctx) {
    for (const [name, operation] of catalogTools)
      ctx.tools.register(name, manifest.tools!.find(tool => tool.name === name)!, async (params, run) => {
        const input = { ...params as Record<string, unknown>, companyId: run.companyId, projectId: String(params.projectId ?? ""), operation };
        const data = operation === "save" ? await ctx.autoSourcing.catalogWrite(input) : await ctx.autoSourcing.catalogRead(input);
        return { content: JSON.stringify(data), data: data as Record<string, unknown> };
      });
    const processing = (params: Record<string, unknown>, companyId: string, operation: string) => {
      const { renderEnvironment: _renderEnvironment, ...fields } = params;
      const input = { ...fields, companyId, operation } as AutoSourcingProcessingRequest;
      return operation === "create" || operation === "save" ? ctx.autoSourcing.processingWrite(input) : ctx.autoSourcing.processingRead(input);
    };
    for (const [name, operation] of processingTools)
      ctx.tools.register(name, manifest.tools!.find(tool => tool.name === name)!, async (params, run) => {
        const data = await processing(params as Record<string, unknown>, run.companyId, operation);
        return { content: JSON.stringify(data), data: data as Record<string, unknown> };
      });
    ctx.data.register("processing", params => {
      if (!["source", "list", "get", "validate"].includes(String(params.operation))) throw new Error("Invalid processing read");
      return processing(params, String(params.companyId ?? ""), String(params.operation));
    });
    ctx.actions.register("processing-draft", (params, context) => {
      if (context.actor.type !== "user" || !context.companyId) throw new Error("An authenticated board action is required");
      if (!["create", "save"].includes(String(params.operation))) throw new Error("Invalid processing write");
      return processing(params, context.companyId, String(params.operation));
    });
    const read = (params: Record<string, unknown>, companyId: string, operation: "accounts" | "orders" | "detail" | "sync-state" | "carriers") =>
      ctx.autoSourcing.request({ companyId, projectId: String(params.projectId ?? ""), operation,
        ...(typeof params.accountId === "string" ? { accountId: params.accountId } : {}),
        ...(typeof params.shipmentId === "string" ? { shipmentId: params.shipmentId } : {}),
        ...(typeof params.state === "string" && params.state ? { state: params.state } : {}),
        ...(typeof params.q === "string" ? { q: params.q } : {}),
        ...(typeof params.page === "number" ? { page: params.page } : {}),
        ...(typeof params.from === "string" ? { from: params.from } : {}),
        ...(typeof params.to === "string" ? { to: params.to } : {}),
      });
    for (const operation of ["accounts", "orders", "detail", "sync-state", "carriers"] as const)
      ctx.data.register(operation, params => read(params, String(params.companyId ?? ""), operation));
    for (const [name, operation] of [["list-order-accounts", "accounts"], ["list-orders", "orders"], ["get-order", "detail"]] as const)
      ctx.tools.register(name, manifest.tools!.find(tool => tool.name === name)!, async (params, run) => {
        const data = await read(params as Record<string, unknown>, run.companyId, operation);
        return { content: JSON.stringify(data), data: data as Record<string, unknown> };
      });
    ctx.actions.register("shipping-order", async (params, context) => {
      if (context.actor.type !== "user" || !context.companyId) throw new Error("An authenticated board action is required");
      const operation = (["preview", "dispatch", "status", "prepare-preview", "prepare", "prepare-status"] as const).find(value => value === params.operation);
      if (!operation) throw new Error("Invalid shipping operation");
      return ctx.autoSourcing.shipping({ companyId: context.companyId,
        projectId: String(params.projectId ?? ""), accountId: String(params.accountId ?? ""),
        shipmentId: String(params.shipmentId ?? ""), operation,
        ...(typeof params.carrierCode === "string" ? { carrierCode: params.carrierCode } : {}),
        ...(typeof params.invoiceNumber === "string" ? { invoiceNumber: params.invoiceNumber } : {}),
        ...(typeof params.confirmation === "string" ? { confirmation: params.confirmation } : {}),
      });
    });
    ctx.actions.register("sync-orders", async (params, context) => {
      if (context.actor.type !== "user" || !context.companyId) throw new Error("An authenticated board action is required");
      return ctx.autoSourcing.sync({ companyId: context.companyId, projectId: String(params.projectId ?? ""),
        accountId: String(params.accountId ?? ""), from: String(params.from ?? ""), to: String(params.to ?? "") });
    });
  },
  async onHealth() { return { status: "ok", message: "Auto Sourcing order handlers registered; live service status is checked per scoped request." }; },
});
export default plugin;
runWorker(plugin, import.meta.url);
