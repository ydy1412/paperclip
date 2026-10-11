import type { PluginContext, PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

/** Reuse native scope/authorization and storage; workers never contact a seller. */
export function registerCatalogTools(ctx: PluginContext, manifest: PaperclipPluginManifestV1, tools: ReadonlyArray<readonly [string, string]>) {
  for (const [name, operation] of tools) {
    ctx.tools.register(name, manifest.tools!.find(tool => tool.name === name)!, async (params, run) => {
      const fields = params as Record<string, unknown>;
      const input = { ...fields, companyId: run.companyId, projectId: String(fields.projectId ?? ""), operation };
      const data = operation === "save" || operation === "source" ? await ctx.autoSourcing.catalogWrite(input) : await ctx.autoSourcing.catalogRead(input);
      return { content: JSON.stringify(data), data: data as Record<string, unknown> };
    });
  }
}
