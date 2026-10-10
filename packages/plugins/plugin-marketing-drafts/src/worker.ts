import { definePlugin, runWorker, type PluginMarketingClient } from "@paperclipai/plugin-sdk";
import { draftTools } from "./manifest.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.tools.register(draftTools[0].name, draftTools[0], async (params, run) => {
      const input = params as { projectId?: string };
      const data = await ctx.marketing.getContext({ ...input, companyId: run.companyId });
      return { content: data.requiresProjectSelection ? "Select the requested project and channel before writing; ask if ambiguous." : "Write for the requested channel rules and submit the completed draft for operator review.", data };
    });
    ctx.tools.register(draftTools[1].name, draftTools[1], async (params, run) => {
      const input = params as Omit<Parameters<PluginMarketingClient["uploadMedia"]>[0], "companyId">;
      const data = await ctx.marketing.uploadMedia({ ...input, companyId: run.companyId });
      return { content: "Media uploaded. Use this actual attachment ID in the draft.", data };
    });
    ctx.tools.register(draftTools[2].name, draftTools[2], async (params, run) => {
      const input = params as Omit<Parameters<PluginMarketingClient["submitDraft"]>[0], "companyId">;
      const data = await ctx.marketing.submitDraft({ ...input, companyId: run.companyId });
      return { content: "Draft registered in Marketing for human review. Nothing was approved or published.", data };
    });
  },
  async onHealth() { return { status: "ok", message: "Marketing draft tools are ready; external publication is not provided." }; },
});

export default plugin;
runWorker(plugin, import.meta.url);
