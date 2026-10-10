import { pgTable, uuid, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";
export const sourcingForwarderProviders = pgTable("sourcing_forwarder_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(), name: text("name").notNull(), homepageUrl: text("homepage_url").notNull(), loginUrl: text("login_url").notNull(), enabled: boolean("enabled").notNull().default(true), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ keyUq: unique("sourcing_forwarder_providers_key_uq").on(t.key) }));
