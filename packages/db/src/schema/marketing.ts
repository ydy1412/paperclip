import { pgTable, uuid, text, boolean, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { MarketingContent, MarketingJobStatus, MarketingPlatform } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { issues } from "./issues.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { sql } from "drizzle-orm";
import type { MarketingConnectionStatus, MarketingConnectionCheckStatus } from "@paperclipai/shared";

export const marketingProfiles = pgTable("marketing_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  asideAccountId: text("aside_account_id").notNull(),
  browserProfileName: text("browser_profile_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  blockedReason: text("blocked_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  projectIdx: index("marketing_profiles_company_project_idx").on(table.companyId, table.projectId),
  bindingUq: uniqueIndex("marketing_profiles_binding_uq").on(table.companyId, table.projectId, table.asideAccountId),
}));

export const marketingChannels = pgTable("marketing_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  profileId: uuid("profile_id").notNull().references(() => marketingProfiles.id),
  platform: text("platform").$type<MarketingPlatform>().notNull(),
  name: text("name").notNull(),
  accountId: text("account_id").notNull(),
  accountUrl: text("account_url").notNull(),
  concept: text("concept").notNull(),
  tone: text("tone").notNull().default(""),
  audience: text("audience").notNull().default(""),
  writingRules: text("writing_rules").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  connectionStatus: text("connection_status").$type<MarketingConnectionStatus>().notNull().default("unknown"),
  connectionCheckedAt: timestamp("connection_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  projectIdx: index("marketing_channels_company_project_idx").on(table.companyId, table.projectId),
  accountUq: uniqueIndex("marketing_channels_account_uq").on(table.companyId, table.projectId, table.platform, table.accountId),
}));

export const marketingDrafts = pgTable("marketing_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  channelId: uuid("channel_id").notNull().references(() => marketingChannels.id),
  topic: text("topic").notNull(),
  content: jsonb("content").$type<MarketingContent>().notNull(),
  revision: integer("revision").notNull().default(1),
  contentHash: text("content_hash").notNull(),
  generationIssueId: uuid("generation_issue_id").references(() => issues.id, { onDelete: "set null" }),
  generationRunId: uuid("generation_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  channelIdx: index("marketing_drafts_company_channel_idx").on(table.companyId, table.channelId),
  runUq: uniqueIndex("marketing_drafts_company_channel_run_uq").on(table.companyId, table.channelId, table.generationRunId).where(sql`${table.generationRunId} IS NOT NULL`),
}));

export const marketingPublishJobs = pgTable("marketing_publish_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  profileId: uuid("profile_id").notNull().references(() => marketingProfiles.id),
  channelId: uuid("channel_id").notNull().references(() => marketingChannels.id),
  draftId: uuid("draft_id").notNull().references(() => marketingDrafts.id),
  revision: integer("revision").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  status: text("status").$type<MarketingJobStatus>().notNull().default("queued"),
  position: integer("position").notNull().default(0),
  approvedBy: text("approved_by").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  externalSessionId: text("external_session_id"),
  postedUrl: text("posted_url"),
  lastError: text("last_error"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  queueIdx: index("marketing_jobs_company_status_idx").on(table.companyId, table.status, table.createdAt),
  revisionUq: uniqueIndex("marketing_jobs_draft_revision_uq").on(table.companyId, table.draftId, table.revision),
}));

export const marketingConnectionMonitors = pgTable("marketing_connection_monitors", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  enabled: boolean("enabled").notNull().default(false),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketingConnectionChecks = pgTable("marketing_connection_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  channelId: uuid("channel_id").notNull().references(() => marketingChannels.id),
  threadId: uuid("thread_id").notNull(),
  target: jsonb("target").$type<{ platform: string; accountId: string; accountUrl: string; profileId: string; asideAccountId: string; browserProfileName: string }>().notNull(),
  source: text("source").$type<"manual" | "automatic">().notNull(),
  status: text("status").$type<MarketingConnectionCheckStatus>().notNull().default("queued"),
  asideSessionId: text("aside_session_id"),
  preparationIntentAt: timestamp("preparation_intent_at", { withTimezone: true }),
  requestIntentAt: timestamp("request_intent_at", { withTimezone: true }),
  observation: jsonb("observation").$type<Record<string, unknown>>(),
  rawDecision: jsonb("raw_decision").$type<{ choice: MarketingConnectionStatus; probability: number }>(),
  appliedStatus: text("applied_status").$type<MarketingConnectionStatus>(),
  reason: text("reason"),
  leaseOwner: uuid("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  nextPollAt: timestamp("next_poll_at", { withTimezone: true }).notNull().defaultNow(),
  pollFailures: integer("poll_failures").notNull().default(0),
  resultReceivedAt: timestamp("result_received_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  activeChannelUq: uniqueIndex("marketing_connection_active_channel_uq").on(table.channelId).where(sql`${table.status} NOT IN ('completed', 'needs_attention', 'cancelled')`),
  dueIdx: index("marketing_connection_due_idx").on(table.nextPollAt, table.status),
  projectIdx: index("marketing_connection_project_idx").on(table.companyId, table.projectId, table.createdAt),
}));
