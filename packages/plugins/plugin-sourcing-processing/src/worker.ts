import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { AutoSourcingProcessingRequest } from "@paperclipai/plugin-sdk";
import { catalogTools } from "@paperclipai/plugin-auto-sourcing/catalog-tools";
import { registerCatalogTools } from "@paperclipai/plugin-auto-sourcing/register-catalog-tools";
import manifest from "./manifest.js";

const plugin = definePlugin({
  async setup(ctx) {
    registerCatalogTools(ctx, manifest, [["list-sourcing-workspace", "workspace"], ["start-managed-processing", "source"], ...catalogTools, ["recommend-coupang-category", "category-recommend"], ["get-coupang-category-metadata", "category-metadata"], ["inspect-product-image", "image-inspect"], ["process-product-image", "image-process"], ["get-product-image", "image-content"], ["get-image-provider-status", "image-provider-status"]]);
    ctx.tools.register("get-processing-source", manifest.tools!.find(tool => tool.name === "get-processing-source")!, async (params, run) => {
      const data = await ctx.autoSourcing.processingRead({ ...params as Record<string, unknown>, companyId: run.companyId, operation: "source" } as AutoSourcingProcessingRequest);
      return { content: JSON.stringify(data), data: data as Record<string, unknown> };
    });
  },
  async onHealth() { return { status: "ok", message: "Product-only native catalog handlers registered; live service is checked per scoped invocation." }; },
});
export default plugin;
runWorker(plugin, import.meta.url);
