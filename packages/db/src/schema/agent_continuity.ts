import { pgTable, uuid, text, timestamp, jsonb, index, foreignKey } from "drizzle-orm/pg-core";
import type { StructuredHandoff } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";

export const agentMailboxMessages = pgTable("agent_mailbox_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fromAgentId: uuid("from_agent_id").notNull(),
  toAgentId: uuid("to_agent_id").notNull(),
  threadId: uuid("thread_id").notNull(),
  relatedIssueId: uuid("related_issue_id").references(() => issues.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, table => ({
  senderCompanyFk: foreignKey({ columns: [table.companyId, table.fromAgentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
  recipientCompanyFk: foreignKey({ columns: [table.companyId, table.toAgentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
  inboxIdx: index("agent_mailbox_inbox_idx").on(table.companyId, table.toAgentId, table.readAt, table.createdAt),
  threadIdx: index("agent_mailbox_thread_idx").on(table.companyId, table.threadId, table.createdAt),
}));

export const agentHandoffs = pgTable("agent_handoffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull(),
  issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  packet: jsonb("packet").$type<StructuredHandoff>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  agentCompanyFk: foreignKey({ columns: [table.companyId, table.agentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
  historyIdx: index("agent_handoffs_history_idx").on(table.companyId, table.agentId, table.issueId, table.createdAt),
}));
