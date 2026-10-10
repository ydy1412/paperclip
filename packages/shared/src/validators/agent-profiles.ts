import { z } from "zod";
import { AGENT_ROLES } from "../constants.js";
export const agentProfileConfigSchema = z.object({
  role: z.enum(AGENT_ROLES).default("general"), title: z.string().trim().max(200).default(""),
  capabilities: z.string().max(4000).default(""), instructions: z.string().max(200000).default(""),
  adapterType: z.string().trim().min(1).max(100), runnerProvider: z.enum(["codex", "claude", "grok", "opencode"]).default("codex"), model: z.string().trim().max(200).default(""),
  skills: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
}).strict();
export const createAgentProfileSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(300).default(""), config: agentProfileConfigSchema }).strict();
export const updateAgentProfileSchema = createAgentProfileSchema.extend({ expectedVersion: z.number().int().positive(), applyToLinked: z.boolean().default(false) }).strict();
export const restoreAgentProfileSchema = z.object({ expectedVersion: z.number().int().positive(), version: z.number().int().positive(), applyToLinked: z.boolean().default(false) }).strict();
export const deleteAgentProfileSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export type AgentProfileConfig = z.infer<typeof agentProfileConfigSchema>;
export type CreateAgentProfile = z.infer<typeof createAgentProfileSchema>;
export type UpdateAgentProfile = z.infer<typeof updateAgentProfileSchema>;
