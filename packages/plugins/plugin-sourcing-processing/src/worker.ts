import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { catalogTools } from "@paperclipai/plugin-auto-sourcing/catalog-tools";
import { registerCatalogTools } from "@paperclipai/plugin-auto-sourcing/register-catalog-tools";
import manifest from "./manifest.js";

const plugin = definePlugin({
  async setup(ctx) {
    registerCatalogTools(ctx, manifest, [["list-sourcing-workspace", "workspace"], ["start-managed-processing", "source"], ...catalogTools, ["recommend-coupang-category", "category-recommend"], ["get-coupang-category-metadata", "category-metadata"]]);
  },
  async onHealth() { return { status: "ok", message: "Product-only native catalog handlers registered; live service is checked per scoped invocation." }; },
});
export default plugin;
runWorker(plugin, import.meta.url);
