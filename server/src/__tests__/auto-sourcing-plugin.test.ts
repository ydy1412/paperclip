import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues, pluginConfig, plugins, projects } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { autoSourcingPluginService } from "../services/auto-sourcing-plugin.js";
import manifest from "../../../packages/plugins/plugin-auto-sourcing/src/manifest.js";

describe("Auto Sourcing native host authority", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("paperclip-orders-plugin-"); db = createDb(database.connectionString); }, 90000);
  afterAll(async () => { await database?.cleanup(); });
  async function fixture() {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Orders test", issuePrefix: `P${companyId.slice(0, 6).toUpperCase()}`, defaultResponsibleUserId: "operator" });
    const [project] = await db.insert(projects).values({ companyId, name: "Orders" }).returning();
    const [agent] = await db.insert(agents).values({ companyId, name: "Reader", role: "general", adapterType: "codex_local" }).returning();
    const [issue] = await db.insert(issues).values({ companyId, projectId: project.id, title: "Read stored orders", status: "in_progress", assigneeAgentId: agent.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, status: "running", contextSnapshot: { issueId: issue.id } }).returning();
    const [plugin] = await db.insert(plugins).values({ pluginKey: `orders.${companyId}`, packageName: "@paperclipai/plugin-auto-sourcing", version: "0.1.0", manifestJson: manifest, status: "ready" }).returning();
    await db.insert(pluginConfig).values({ pluginId: plugin.id, companyId, configJson: { serviceToken: { type: "secret_ref", secretId: randomUUID() }, projects: { [project.id]: ["allowed-seller"] } } });
    const host = autoSourcingPluginService(db, plugin.id);
    const input = { companyId, projectId: project.id, operation: "orders" as const, accountId: "not-bound" };
    const board = { invocationScope: { companyId } };
    const context = { invocationScope: { companyId, agentRun: { agentId: agent.id, runId: run.id, projectId: project.id } } };
    return { companyId, project, agent, issue, run, plugin, host, input, board, context };
  }
  it("rejects missing/forged invocation, foreign project, unbound account and archived project before HTTP", async () => {
    const f = await fixture(), foreign = await fixture();
    await expect(f.host.request(f.input)).rejects.toThrow("회사 범위");
    await expect(f.host.request(f.input, { ...f.board, invalidInvocationScope: true })).rejects.toThrow("회사 범위");
    await expect(f.host.request({ ...f.input, companyId: foreign.companyId }, f.board)).rejects.toThrow("회사 범위");
    await expect(f.host.request({ ...f.input, projectId: foreign.project.id }, f.board)).rejects.toThrow("같은 회사");
    await expect(f.host.request(f.input, f.board)).rejects.toThrow("연결된 판매 계정");
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, f.project.id));
    await expect(f.host.request(f.input, f.board)).rejects.toThrow("같은 회사");
  });
  it("rejects stopped, paused and mismatched agent authority and excludes agent sync", async () => {
    const f = await fixture();
    await expect(f.host.request(f.input, f.context)).rejects.toThrow("연결된 판매 계정");
    await expect(f.host.sync({ companyId: f.companyId, projectId: f.project.id, accountId: "allowed-seller", from: "2026-10-01", to: "2026-10-08" }, f.context)).rejects.toThrow("운영 화면");
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.agent.id));
    await expect(f.host.request(f.input, f.context)).rejects.toThrow("에이전트 작업");
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.agent.id));
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, f.run.id));
    await expect(f.host.request(f.input, f.context)).rejects.toThrow("에이전트 작업");
  });
  it("accepts only fixed operations, identifier shapes, valid states and bounded pages", async () => {
    const f = await fixture();
    for (const invalid of [{ operation: "cancel" }, { shipmentId: "../../secret" }, { page: 0 }, { page: 1.2 }, { state: "fake" }, { q: "x".repeat(101) },
      { from: "2026-02-30", to: "2026-03-01" }, { from: "2026-10-08" }, { to: "2026-10-08" }, { from: "2026-10-09", to: "2026-10-08" }])
      await expect(f.host.request({ ...f.input, ...invalid } as never, f.board)).rejects.toThrow();
  });
  it("requires current company/project/account authority for DB carrier reads before HTTP", async () => {
    const f = await fixture(), foreign = await fixture();
    const input = { ...f.input, operation: "carriers" as const, accountId: "allowed-seller" };
    await expect(f.host.request(input)).rejects.toThrow("회사 범위");
    await expect(f.host.request({ ...input, projectId: foreign.project.id }, f.board)).rejects.toThrow("같은 회사");
    await expect(f.host.request({ ...input, accountId: "not-bound" }, f.board)).rejects.toThrow("연결된 판매 계정");
    await expect(f.host.request({ ...input, accountId: undefined }, f.board)).rejects.toThrow("판매 계정");
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.agent.id));
    await expect(f.host.request(input, f.context)).rejects.toThrow("에이전트 작업");
  });
  it("does not grant an unscoped or different-project agent access to bound orders", async () => {
    const f = await fixture();
    const input = { ...f.input, accountId: "allowed-seller" };
    await db.update(issues).set({ projectId: null }).where(eq(issues.id, f.issue.id));
    await expect(f.host.request(input, { invocationScope: { companyId: f.companyId,
      agentRun: { agentId: f.agent.id, runId: f.run.id } } })).rejects.toThrow("에이전트 작업");
    const [other] = await db.insert(projects).values({ companyId: f.companyId, name: "Different project" }).returning();
    await db.update(issues).set({ projectId: other.id }).where(eq(issues.id, f.issue.id));
    await expect(f.host.request(input, f.context)).rejects.toThrow("에이전트 작업");
  });
  it("rejects shipping by agents, missing scope, foreign projects, unbound accounts and malformed actions before HTTP", async () => {
    const f = await fixture(), foreign = await fixture();
    const input = { companyId: f.companyId, projectId: f.project.id, accountId: "allowed-seller", shipmentId: "123456789012345678", operation: "preview" as const, carrierCode: "CJGLS", invoiceNumber: "001234567890" };
    await expect(f.host.shipping(input, f.context)).rejects.toThrow("운영 화면");
    await expect(f.host.shipping(input)).rejects.toThrow("회사 범위");
    await expect(f.host.shipping({ ...input, projectId: foreign.project.id }, f.board)).rejects.toThrow("같은 회사");
    await expect(f.host.shipping({ ...input, accountId: "not-bound" }, f.board)).rejects.toThrow("연결된 판매 계정");
    for (const invalid of [{ operation: "dispatch" }, { shipmentId: "../../secret" }, { carrierCode: "../DIRECT" }, { invoiceNumber: "00123-456" }, { operation: "dispatch", confirmation: "bad" }, { operation: "status" }])
      await expect(f.host.shipping({ ...input, ...invalid } as never, f.board)).rejects.toThrow();
  });
  it("keeps preparation operator scoped and rejects invoice/confirmation extras or unsupported operations before HTTP", async () => {
    const f = await fixture(), foreign = await fixture();
    const input = { companyId: f.companyId, projectId: f.project.id, accountId: "allowed-seller", shipmentId: "123456789012345678", operation: "prepare-preview" as const };
    await expect(f.host.shipping(input, f.context)).rejects.toThrow("운영 화면");
    await expect(f.host.shipping(input)).rejects.toThrow("회사 범위");
    await expect(f.host.shipping({ ...input, projectId: foreign.project.id }, f.board)).rejects.toThrow("같은 회사");
    await expect(f.host.shipping({ ...input, accountId: "not-bound" }, f.board)).rejects.toThrow("연결된 판매 계정");
    for (const invalid of [{ invoiceNumber: "001234567890" }, { carrierCode: "CJGLS" }, { confirmation: "a".repeat(32) }, { operation: "prepare" },
      { operation: "prepare", confirmation: "bad" }, { operation: "cancel" }, { shipmentId: "../secret" }])
      await expect(f.host.shipping({ ...input, ...invalid } as never, f.board)).rejects.toThrow();
  });

});
