import { z } from "zod";
export const agentProfileConfigSchema = z.object({
  // Accept old stored versions and old clients, but no longer configure agent identity.
  role: z.string().max(100).optional(), title: z.string().max(200).optional(),
  capabilities: z.string().max(4000).default(""), instructions: z.string().max(200000).default(""),
  adapterType: z.string().trim().min(1).max(100), runnerProvider: z.enum(["codex", "claude", "grok", "opencode"]).default("codex"), model: z.string().trim().max(200).default(""),
  thinkingEffort: z.string().trim().max(100).regex(/^[a-zA-Z0-9_-]*$/).default(""),
  skills: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
}).strict().transform(({ role: _role, title: _title, ...config }) => config);
export const createAgentProfileSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(300).default(""), config: agentProfileConfigSchema }).strict();
export const updateAgentProfileSchema = createAgentProfileSchema.extend({ expectedVersion: z.number().int().positive(), applyToLinked: z.boolean().default(false) }).strict();
export const restoreAgentProfileSchema = z.object({ expectedVersion: z.number().int().positive(), version: z.number().int().positive(), applyToLinked: z.boolean().default(false) }).strict();
export const deleteAgentProfileSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export type AgentProfileConfig = z.infer<typeof agentProfileConfigSchema>;
export type CreateAgentProfile = z.infer<typeof createAgentProfileSchema>;
export type UpdateAgentProfile = z.infer<typeof updateAgentProfileSchema>;

/** Config keys consumed by the existing adapter runtimes. */
export function agentProfileEffortKey(config: { adapterType: string; runnerProvider: string }): string | null {
  switch (config.adapterType) {
    case "codex_local": return "modelReasoningEffort";
    case "claude_local": return "effort";
    case "grok_local": return "reasoningEffort";
    case "pi_local": return "thinking";
    case "kimi_local": return "effort";
    case "opencode_local": return "variant";
    case "paperclip_runner": return config.runnerProvider === "codex" ? "modelReasoningEffort" : null;
    default: return null;
  }
}
