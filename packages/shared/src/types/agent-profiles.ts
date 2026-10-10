import type { AgentProfileConfig } from "../validators/agent-profiles.js";
export interface AgentProfile { id: string; companyId: string; name: string; description: string; version: number; config: AgentProfileConfig; linkedCount: number; }
export interface AgentProfileVersion { version: number; name: string; description: string; config: AgentProfileConfig; createdAt: string; }
export interface AgentProfileBinding { agentId: string; name: string; status: string; appliedVersion: number; pendingVersion: number | null; overrides: string[]; error: string | null; }
export interface AgentProfileDetail extends AgentProfile { versions: AgentProfileVersion[]; bindings: AgentProfileBinding[]; }
