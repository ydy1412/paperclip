import type { z } from "zod";
import type { handoffContentSchema, saveHandoffSchema, sendAgentMessageSchema } from "../validators/agent-continuity.js";

export type HandoffContent = z.infer<typeof handoffContentSchema>;
export type SaveHandoff = z.infer<typeof saveHandoffSchema>;
export type SendAgentMessage = z.infer<typeof sendAgentMessageSchema>;
export type ContinuityStatus = "resumed" | "fresh" | "fresh_with_handoff" | "awaiting_decision" | "attention_required" | "failed";
export interface StructuredHandoff {
  schema: "paperclip.structured-handoff.v1";
  agentId: string;
  companyId: string;
  issueId: string;
  adapterType: string;
  previousSessionId: string | null;
  createdAt: string;
  workspace: { id: string | null; cwd: string | null; branch: string | null; providerType: string; worktree: string | null };
  content: HandoffContent;
}
export interface AgentMailboxMessage {
  id: string; companyId: string; fromAgentId: string; toAgentId: string;
  threadId: string; relatedIssueId: string | null; body: string;
  createdAt: string; readAt: string | null;
}
export interface AgentHandoff {
  id: string; companyId: string; agentId: string; issueId: string;
  packet: StructuredHandoff; markdown: string; createdAt: string;
}
export interface ContinuityAssessment {
  issueId: string; taskSessionId: string; status: ContinuityStatus;
  reasons: string[]; sessionId: string | null; handoffId: string | null;
  checkedAt: string;
}
