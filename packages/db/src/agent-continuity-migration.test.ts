import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { startEmbeddedPostgresTestDatabase, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "./test-embedded-postgres.js";
import { applyPendingMigrations } from "./client.js";

describe("continuity additive migration", () => {
  it("upgrades existing agents and provider sessions without changing their identity or parameters", async () => {
    const database = await startEmbeddedPostgresTestDatabase("paperclip-continuity-upgrade-");
    const sql = postgres(database.connectionString, { max: 1 });
    try {
      // Reconstruct the pre-POC schema in this disposable database only.
      await sql.unsafe(`DROP TABLE agent_mailbox_messages; DROP TABLE agent_handoffs CASCADE;
        ALTER TABLE agent_task_sessions DROP COLUMN handoff_id, DROP COLUMN continuity_policy;
        ALTER TABLE agents DROP COLUMN seat_alias;`);
      const companyId = randomUUID(), agentId = randomUUID(), sessionId = randomUUID();
      await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Existing company','CON')`;
      await sql`INSERT INTO agents (id,company_id,name) VALUES (${agentId},${companyId},'Existing agent')`;
      await sql`INSERT INTO agent_task_sessions (id,company_id,agent_id,adapter_type,task_key,session_display_id,session_params_json)
        VALUES (${sessionId},${companyId},${agentId},'codex_local','existing-task','provider-123','{"sessionId":"provider-123"}')`;
      const migration = await readFile(new URL("./migrations/0300_agent_continuity.sql", import.meta.url), "utf8");
      await sql.unsafe(migration.replaceAll("--> statement-breakpoint", ""));
      expect((await sql`SELECT id,seat_alias FROM agents WHERE id=${agentId}`)[0]).toEqual({ id: agentId, seat_alias: null });
      expect((await sql`SELECT id,continuity_policy,session_display_id,session_params_json FROM agent_task_sessions WHERE id=${sessionId}`)[0]).toEqual({ id: sessionId, continuity_policy: "resume", session_display_id: "provider-123", session_params_json: { sessionId: "provider-123" } });
      await applyPendingMigrations(database.connectionString);
      expect((await sql`SELECT session_display_id FROM agent_task_sessions WHERE id=${sessionId}`)[0].session_display_id).toBe("provider-123");
    } finally { await sql.end(); await database.cleanup(); }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
