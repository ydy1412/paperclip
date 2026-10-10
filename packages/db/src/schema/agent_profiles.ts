import { pgTable, uuid, text, integer, jsonb, timestamp, index, unique } from "drizzle-orm/pg-core";
import type { AgentProfileConfig } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
export const agentProfiles = pgTable("agent_profiles", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), description: text("description").notNull().default(""), version: integer("version").notNull().default(1), config: jsonb("config").$type<AgentProfileConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ companyIdx: index("agent_profiles_company_idx").on(t.companyId), companyIdUq: unique("agent_profiles_company_id_uq").on(t.companyId, t.id) }));
export const agentProfileVersions = pgTable("agent_profile_versions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), profileId: uuid("profile_id").notNull().references(() => agentProfiles.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), name: text("name").notNull(), description: text("description").notNull(), config: jsonb("config").$type<AgentProfileConfig>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ profileVersionUq: unique("agent_profile_versions_profile_version_uq").on(t.profileId, t.version) }));
export const agentProfileBindings = pgTable("agent_profile_bindings", {
  agentId: uuid("agent_id").primaryKey().references(() => agents.id, { onDelete: "cascade" }), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), profileId: uuid("profile_id").notNull().references(() => agentProfiles.id, { onDelete: "cascade" }),
  appliedVersion: integer("applied_version").notNull(), pendingVersion: integer("pending_version"), baseline: jsonb("baseline").$type<AgentProfileConfig>().notNull(), requestedByUserId: text("requested_by_user_id"),
  overrides: jsonb("overrides").$type<string[]>().notNull().default([]), error: text("error"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ profileIdx: index("agent_profile_bindings_profile_idx").on(t.companyId, t.profileId) }));
