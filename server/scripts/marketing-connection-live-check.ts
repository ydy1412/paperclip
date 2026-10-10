import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDb, companies, projects, marketingConnectionChecks, closeRegisteredClients, startEmbeddedPostgresTestDatabase } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { marketingService } from "../src/services/marketing.js";
import { marketingConnectionQueue } from "../src/services/marketing-connection-queue.js";
import { startMarketingConnectionWorker } from "../src/services/marketing-connection-workflow.js";

const configSchema = z.object({ profile: z.object({ asideAccountId: z.string().regex(/^u\d+$/), browserProfileName: z.string() }),
  channel: z.object({ platform: z.literal("naver_blog"), accountId: z.string(), accountUrl: z.string().url() }), pythonPath: z.string(), checkpointPath: z.string() }).passthrough();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const root = fileURLToPath(new URL("../../", import.meta.url));

async function worker(configPath: string) {
  const input = JSON.parse(await readFile(configPath, "utf8"));
  const db = createDb(input.connectionString);
  process.env.PAPERCLIP_MARKETING_LAYA_PYTHON = input.pythonPath;
  process.env.PAPERCLIP_MARKETING_LAYA_SCRIPT = path.join(root, "scripts/marketing-laya-inference.py");
  process.env.PAPERCLIP_MARKETING_LAYA_CHECKPOINT = input.checkpointPath;
  const running = await startMarketingConnectionWorker(db, { connectionString: input.connectionString });
  const keepAlive = setInterval(() => {}, 60000);
  const stop = async () => { clearInterval(keepAlive); await running.shutdown(); await closeRegisteredClients(input.connectionString); process.exit(0); };
  process.once("SIGTERM", () => { void stop(); });
  console.log("Isolated connection worker ready");
}

async function main(configPath: string, outputDirectory: string) {
  const quickRestart = process.argv.includes("--quick-restart");
  const out = path.resolve(outputDirectory);
  if (!out.startsWith(path.join(root, "tmp/marketing-dev/"))) throw new Error("Private marketing test output required");
  await mkdir(out, { mode: 0o700 });
  const input = configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  const database = await startEmbeddedPostgresTestDatabase("paperclip-live-connection-");
  const db = createDb(database.connectionString), queue = marketingConnectionQueue(db);
  const companyId = randomUUID();
  await db.insert(companies).values({ id: companyId, name: "Isolated readonly verification", issuePrefix: "LIVE", defaultResponsibleUserId: "test-operator" });
  const [project] = await db.insert(projects).values({ companyId, name: "Read-only checks" }).returning();
  const service = marketingService(db);
  const profile = await service.createProfile(companyId, { projectId: project.id, name: "Explicit live binding", ...input.profile });
  const channel = await service.createChannel(companyId, { projectId: project.id, profileId: profile.id, name: "Naver readonly", ...input.channel, concept: "Read-only verification", tone: "", audience: "", writingRules: "" });
  const [manual] = await queue.enqueue(companyId, project.id, [channel.id]);
  const start = new Date(); if (!quickRestart) await queue.setMonitor(companyId, project.id, true, start);
  const workerConfig = path.join(out, "worker-private.json");
  await writeFile(workerConfig, JSON.stringify({ connectionString: database.connectionString, pythonPath: input.pythonPath, checkpointPath: input.checkpointPath }), { mode: 0o600, flag: "wx" });
  const loader = pathToFileURL(path.resolve(root, "server/node_modules/tsx/dist/loader.mjs")).href;
  const script = fileURLToPath(import.meta.url);
  function launch() { const child = spawn(process.execPath, ["--import", loader, script, "--worker", workerConfig], { cwd: path.join(root, "server"), stdio: ["ignore", "pipe", "pipe"] }); child.stdout?.on("data", chunk => { if (String(chunk).includes("ready")) console.log("Isolated worker ready"); }); child.stderr?.on("data", () => {}); return child; }
  let child = launch(), restarted = false, originalSession: string | null = null;
  const stages = new Set<string>();
  const report: Record<string, unknown> = { startedAt: start.toISOString(), scope: "isolated PostgreSQL + real read-only Naver + native Laya", directWorkerProcess: true, quickRestart, linkedinVerified: false, publishing: false };
  try {
    while (Date.now() - start.getTime() < 13 * 60 * 1000) {
      const state = await queue.overview(companyId, project.id);
      const job = state.jobs.find(row => row.id === manual.id)!; stages.add(job.status);
      if (!restarted && job.asideSessionId && job.status === "waiting") {
        originalSession = job.asideSessionId;
        report.killedWorkerPid = child.pid;
        const exited = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGKILL"); await exited;
        child = launch(); restarted = true;
        report.workerPidAfterRestart = child.pid;
        report.restartedAt = new Date().toISOString();
      }
      if (restarted && job.finishedAt) report.sameSessionAfterRestart = job.asideSessionId === originalSession;
      const automatic = state.jobs.filter(row => row.source === "automatic");
      report.manual = { status: job.status, appliedStatus: job.appliedStatus, rawDecision: job.rawDecision, reason: job.reason, sessionId: job.asideSessionId };
      report.stages = [...stages]; report.automaticCount = automatic.length;
      report.checkedAt = new Date().toISOString();
      await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
      if (quickRestart && restarted && job.finishedAt) break;
      if (automatic.length && automatic.every(row => row.finishedAt)) {
        report.actualIntervalMilliseconds = new Date(automatic[0].createdAt).getTime() - start.getTime();
        await queue.setMonitor(companyId, project.id, false);
        const before = state.jobs.length;
        await sleep(12000);
        report.offPreventedNewJobs = (await queue.overview(companyId, project.id)).jobs.length === before;
        report.automatic = automatic.map(row => ({ status: row.status, appliedStatus: row.appliedStatus, sessionId: row.asideSessionId }));
        break;
      }
      await sleep(2500);
    }
    await queue.setMonitor(companyId, project.id, false);
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ outputDirectory: out, restarted, sameSessionAfterRestart: report.sameSessionAfterRestart, automaticCount: report.automaticCount, actualIntervalMilliseconds: report.actualIntervalMilliseconds, offPreventedNewJobs: report.offPreventedNewJobs, stages: [...stages] }));
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
    const rows = await db.select().from(marketingConnectionChecks).where(eq(marketingConnectionChecks.companyId, companyId));
    // Preserve test records privately before cleaning up the disposable cluster.
    await writeFile(path.join(out, "jobs-private.json"), JSON.stringify(rows), { mode: 0o600, flag: "wx" });
    await database.cleanup();
  }
}
if (process.argv[2] === "--worker") await worker(process.argv[3]);
else await main(process.argv[2], process.argv[3]);
