import { pgTable, uuid, text, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { companySecrets } from "./company_secrets.js";
import { sourcingForwarderProviders } from "./sourcing_forwarder_providers.js";

export const sourcingForwarders = pgTable("sourcing_forwarders", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  providerId: uuid("provider_id").references(() => sourcingForwarderProviders.id, { onDelete: "restrict" }),
  homepageUrl: text("homepage_url").notNull(),
  loginUrl: text("login_url").notNull(),
  credentialSecretId: uuid("credential_secret_id").notNull().references(() => companySecrets.id),
  credentialVersion: integer("credential_version").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({ projectIdx: index("sourcing_forwarders_company_project_idx").on(table.companyId, table.projectId) }));
