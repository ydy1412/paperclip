import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { agents, companies, createDb, heartbeatRuns, issues, pluginConfig, plugins, projects } from "@paperclipai/db";
import { createHostClientHandlers, type HostServices } from "@paperclipai/plugin-sdk";
import { startEmbeddedPostgresTestDatabase } from "./embedded-postgres.js";
import { autoSourcingPluginService } from "../../services/auto-sourcing-plugin.js";
import { createPluginWorkerHandle } from "../../services/plugin-worker-manager.js";
import { secretService } from "../../services/secrets.js";
import manifest from "../../../../packages/plugins/plugin-auto-sourcing/src/manifest.js";

export async function startProcessingFixture(mode = "synthetic") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const scratch = mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "processing-host-"));
  const previousKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(scratch, "fixture-master.key");
  const sourcingRoot = process.env.AUTO_SOURCING_PROJECT_ROOT ?? path.resolve(root, "../auto-sourcing");
  const child = spawn("dotnet", [path.resolve(sourcingRoot, "tests/AutoSourcing.Tests/bin/Debug/net8.0/AutoSourcing.Tests.dll"), "processing-server", mode],
    { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PAPERCLIP_RUN_SCRATCH_DIR: scratch } });
  const database = await startEmbeddedPostgresTestDatabase("processing-host-");
  const db = createDb(database.connectionString);
  let worker: ReturnType<typeof createPluginWorkerHandle> | undefined;
  async function close() {
    await worker?.stop();
    const stopped = new Promise<void>(resolve => child.once("exit", () => resolve()));
    if (child.exitCode === null) { child.stdin.end("\n"); await stopped; }
    await database.cleanup();
    if (previousKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE; else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKey;
    rmSync(scratch, { recursive: true, force: true });
  }
  try {
    const info = await new Promise<{ url: string; companyId: string; projectId: string; accountId: string; productId: string }>((resolve, reject) => {
      const lines = createInterface({ input: child.stdout });
      const timer = setTimeout(() => reject(new Error("Processing API fixture did not start")), 30000);
      lines.on("line", line => { if (line.startsWith('{"url"')) { clearTimeout(timer); lines.close(); resolve(JSON.parse(line)); } });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Processing API fixture exited ${code}`)); });
    });
    const { companyId, projectId, accountId, productId } = info;
    await db.insert(companies).values({ id: companyId, name: "Synthetic processing company", issuePrefix: "PROC", defaultResponsibleUserId: "fixture-operator" });
    await db.insert(projects).values({ id: projectId, companyId, name: "Synthetic processing" });
    const [agent] = await db.insert(agents).values({ companyId, name: "Processing fixture", role: "general", adapterType: "codex_local" }).returning();
    const [issue] = await db.insert(issues).values({ companyId, projectId, title: "Synthetic processing", status: "in_progress", assigneeAgentId: agent.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, status: "running", contextSnapshot: { issueId: issue.id } }).returning();
    const [plugin] = await db.insert(plugins).values({ pluginKey: manifest.id, packageName: "@paperclipai/plugin-auto-sourcing", version: manifest.version, manifestJson: manifest, status: "ready" }).returning();
    const vault = secretService(db);
    const secret = await vault.create(companyId, { name: `fixture-${randomUUID()}`, provider: "local_encrypted", value: "s".repeat(40) });
    await vault.syncSecretRefsForTarget(companyId, { targetType: "plugin", targetId: plugin.id }, [{ secretId: secret.id, configPath: "serviceToken" }], { replaceAll: true });
    const config = { serviceToken: { type: "secret_ref", secretId: secret.id }, projects: { [projectId]: [accountId] }, sourceProducts: { [projectId]: [`taobao:${productId}`] } };
    await db.insert(pluginConfig).values({ pluginId: plugin.id, companyId, configJson: config });
    const service = autoSourcingPluginService(db, plugin.id, { processingPort: Number(new URL(info.url).port) });
    const handlers = createHostClientHandlers({ pluginId: plugin.id, capabilities: manifest.capabilities, services: { autoSourcing: service } as HostServices });
    worker = createPluginWorkerHandle(plugin.id, { entrypointPath: path.join(root, "packages/plugins/plugin-auto-sourcing/dist/worker.js"), manifest, config,
      instanceInfo: { instanceId: "isolated-processing", hostVersion: "1.0.0" }, apiVersion: 1, hostHandlers: handlers });
    await worker.start();
    const runContext = { companyId, projectId, agentId: agent.id, runId: run.id };
    const tool = (toolName: string, input: Record<string, unknown> = {}) => worker!.call("executeTool", { toolName, parameters: { projectId, ...(toolName.includes("processing") ? { accountId } : {}), ...input }, runContext });
    const action = (input: Record<string, unknown>) => worker!.call("performAction", { key: "processing-draft", params: { projectId, accountId, ...input },
      actorContext: { type: "user", userId: "fixture-operator", agentId: null, runId: null, companyId }, renderEnvironment: null });
    const data = (input: Record<string, unknown>, key = "processing") => worker!.call("getData", { key, params: { projectId, accountId, ...input }, companyId });
    return { ...info, db, service, handlers, worker, run, agent, issue, plugin, config, tool, action, data, close };
  } catch (error) { await close(); throw error; }
}
