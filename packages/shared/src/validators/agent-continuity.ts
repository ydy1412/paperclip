import { z } from "zod";

export const seatAliasSchema = z.string().trim().toLowerCase().max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$/);
const text = z.string().trim().min(1).max(1500);
const list = z.array(text).max(20);
export const handoffContentSchema = z.object({
  goal: text,
  changedFiles: z.array(z.string().trim().min(1).max(300)).max(40),
  completed: list,
  inProgress: list,
  acceptanceCriteria: list.min(1),
  tests: z.array(z.object({ command: text, result: z.enum(["passed", "failed", "not_run"]), details: z.string().max(1500) })).max(20),
  decisions: list,
  unresolved: list,
  blockers: list,
  nextActions: list.min(1),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 12_000, "Handoff exceeds 12 KB");
export const sessionPolicySchema = z.enum(["resume", "fresh_with_handoff", "checkpoint_only"]);
export const saveHandoffSchema = z.object({
  issueId: z.string().uuid(),
  expectedSessionId: z.string().nullable(),
  policy: sessionPolicySchema,
  content: handoffContentSchema,
}).strict();
export const sendAgentMessageSchema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1).max(25),
  threadId: z.string().uuid().optional(),
  relatedIssueId: z.string().uuid().nullable().optional(),
  body: z.string().trim().min(1).max(8000),
}).strict();
