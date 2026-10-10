import { randomUUID } from "node:crypto";
import { Annotation, StateGraph, START, END, interrupt, Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { RunnableConfig } from "@langchain/core/runnables";
import pg from "pg";
import { logger } from "../middleware/logger.js";
import { sql } from "drizzle-orm";
import { withDedicatedDbConnection, marketingConnectionChecks, type Db } from "@paperclipai/db";
import { marketingPlatformSchema } from "@paperclipai/shared";
import { marketingConnectionQueue, type ConnectionCheckRow } from "./marketing-connection-queue.js";
import { marketingConnectionAside, connectionObservationSchema, type ConnectionObservation } from "./marketing-connection-aside.js";
import { classifyMarketingLayaObservation } from "./marketing-laya.js";

type LayaDecision = Awaited<ReturnType<typeof classifyMarketingLayaObservation>>;
export function appliedConnectionVerdict(observation: ConnectionObservation, decision: Pick<LayaDecision, "choice" | "probability" | "status">) {
  const e = observation.evidence;
  if (e.conflicting || e.ownerMatches === false) return "unknown";
  // Verified owner identity outranks auxiliary load failures and model abstention.
  if (e.ownerMatches === true && e.authenticationRequired === false && e.ownerControlsPresent) return "connected";
  if (e.loadingFailed || decision.probability < 0.8 || decision.status === "unknown") return "unknown";
  if (decision.status === "auth_required" && e.authenticationRequired === true && !e.ownerControlsPresent && e.ownerMatches !== true) return "auth_required";
  return "unknown";
}
const graphState = Annotation.Root({ jobId: Annotation<string>({ reducer: (_a, b) => b }) });
type AsideBoundary = typeof marketingConnectionAside;
type Options = { connectionString: string; aside?: AsideBoundary; classify?: (input: { platform: ReturnType<typeof marketingPlatformSchema.parse>; accountId: string; observation: string }) => Promise<LayaDecision> };

export async function createMarketingConnectionWorkflow(db: Db, options: Options) {
  const queue = marketingConnectionQueue(db), aside = options.aside ?? marketingConnectionAside;
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 4 });
  pool.on("error", () => logger.warn("Marketing checkpoint connection unavailable; retrying saved work."));
  const checkpointer = new PostgresSaver(pool, undefined, { schema: "marketing_connection_graph" });
  try { await checkpointer.setup(); } catch (error) { await pool.end(); throw error; }
  const classify = options.classify ?? (input => {
    const pythonPath = process.env.PAPERCLIP_MARKETING_LAYA_PYTHON, scriptPath = process.env.PAPERCLIP_MARKETING_LAYA_SCRIPT, checkpointPath = process.env.PAPERCLIP_MARKETING_LAYA_CHECKPOINT;
    if (!pythonPath || !scriptPath || !checkpointPath) throw new Error("Local Laya is not configured");
    return classifyMarketingLayaObservation(input, { pythonPath, scriptPath, checkpointPath });
  });
  function owner(config: RunnableConfig) { return String(config.configurable?.leaseOwner); }
  async function get(state: typeof graphState.State, config: RunnableConfig) { return queue.get(state.jobId, owner(config)); }
  const graph = new StateGraph(graphState)
    .addNode("prepare", async (state, config) => {
      let job = await get(state, config);
      if (job.asideSessionId) return {};
      if (job.preparationIntentAt) {
        await queue.finish(job.id, owner(config), null, "unknown", "준비 세션 생성 여부가 불명확합니다. 자동 재요청하지 않습니다.");
        return {};
      }
      job = await queue.patch(job.id, owner(config), { preparationIntentAt: new Date(), status: "preparing" });
      try { await aside.prepare(job, async id => { await queue.patch(job.id, owner(config), { asideSessionId: id }); }); }
      catch {
        const saved = await get(state, config);
        if (!saved.asideSessionId) await queue.finish(job.id, owner(config), null, "unknown", "Aside 준비 세션을 확인하지 못했습니다. 자동 재요청하지 않습니다.");
      }
      return {};
    })
    .addNode("request", async (state, config) => {
      const job = await get(state, config);
      if (job.requestIntentAt) return {};
      // Persist before the external side effect. A crash here must not resend.
      const saved = await queue.patch(job.id, owner(config), { requestIntentAt: new Date(), status: "requesting" });
      try { await aside.request(saved); await queue.patch(job.id, owner(config), { status: "waiting" }); }
      catch { await queue.finish(job.id, owner(config), null, "unknown", "Aside 요청 여부를 확인할 수 없습니다. 저장된 세션 확인이 필요합니다."); }
      return {};
    })
    .addNode("wait", async (state, config) => {
      const job = await get(state, config);
      if (job.observation) return {};
      let result: ConnectionObservation | null = null, readFailed = false;
      try { result = await aside.poll(job); }
      catch {
        readFailed = true;
        const failures = job.pollFailures + 1;
        await queue.patch(job.id, owner(config), { pollFailures: failures, reason: "세션 조회를 재시도 중입니다. 기존 연결 상태를 유지합니다.", nextPollAt: new Date(Date.now() + Math.min(30000, 5000 * 2 ** Math.min(failures, 3))) });
      }
      if (result) {
        await queue.patch(job.id, owner(config), { observation: connectionObservationSchema.parse(result), status: "result_received", resultReceivedAt: new Date(), reason: null, nextPollAt: new Date(Date.now() + 5000), pollFailures: 0 });
        // Keep result arrival visible before model inference, without holding a worker.
        return {};
      }
      if (!readFailed) await queue.patch(job.id, owner(config), { status: "waiting", nextPollAt: new Date(Date.now() + 5000), pollFailures: 0 });
      interrupt("waiting_for_final_result");
      return {};
    })
    .addNode("arrival", async () => { interrupt("result_received"); return {}; })
    .addNode("classify", async (state, config) => {
      const job = await get(state, config);
      const observation = connectionObservationSchema.parse(job.observation);
      const classified = await withDedicatedDbConnection(db, async dedicated => {
        const result = await dedicated.execute<{ locked: boolean }>(sql`select pg_try_advisory_lock(hashtextextended('marketing:connection:laya', 0)) as locked`);
        if (!result[0]?.locked) return false;
        try {
          await queue.patch(job.id, owner(config), { status: "classifying" });
          let decision: LayaDecision;
          try { decision = await classify({ platform: observation.platform, accountId: observation.accountId, observation: observation.observation }); }
          catch { await queue.finish(job.id, owner(config), null, "unknown", "Laya 판정을 완료하지 못했습니다. 기존 연결 상태를 유지합니다."); return true; }
          const applied = appliedConnectionVerdict(observation, decision);
          await queue.finish(job.id, owner(config), { choice: decision.choice, probability: decision.probability }, applied,
            applied === "unknown" ? "대상 계정의 로그인 확인을 보류했습니다. 연결 실패가 아니며 기존 연결 상태를 유지합니다." : null);
          return true;
        } finally { await dedicated.execute(sql`select pg_advisory_unlock(hashtextextended('marketing:connection:laya', 0))`); }
      });
      if (!classified) { await queue.patch(job.id, owner(config), { nextPollAt: new Date(Date.now() + 5000) }); interrupt("waiting_for_laya_slot"); }
      return {};
    })
    .addEdge(START, "prepare")
    .addConditionalEdges("prepare", async state => {
      const [job] = await db.select().from(marketingConnectionChecks).where(sql`id = ${state.jobId}`);
      return job?.finishedAt ? END : "request";
    })
    .addConditionalEdges("request", async state => {
      const [job] = await db.select().from(marketingConnectionChecks).where(sql`id = ${state.jobId}`);
      return job?.finishedAt ? END : "wait";
    })
    .addConditionalEdges("wait", async state => {
      const [job] = await db.select().from(marketingConnectionChecks).where(sql`id = ${state.jobId}`);
      return job?.observation ? "arrival" : "wait";
    })
    .addEdge("arrival", "classify")
    .addConditionalEdges("classify", async state => {
      const [job] = await db.select().from(marketingConnectionChecks).where(sql`id = ${state.jobId}`);
      return job?.finishedAt ? END : "classify";
    })
    .compile({ checkpointer });
  async function advance(job: ConnectionCheckRow) {
    if (!job.leaseOwner) throw new Error("Missing queue lease");
    const config = { configurable: { thread_id: job.threadId, leaseOwner: job.leaseOwner }, durability: "sync" as const };
    const heartbeat = setInterval(() => { void queue.patch(job.id, job.leaseOwner!, { leaseUntil: new Date(Date.now() + 60000) }).catch(() => {}); }, 15000);
    heartbeat.unref();
    try {
      await withDedicatedDbConnection(db, async dedicated => {
        const result = await dedicated.execute<{ locked: boolean }>(sql`select pg_try_advisory_lock(hashtextextended(${`marketing:connection:job:${job.id}`}, 0)) as locked`);
        if (!result[0]?.locked) return;
        try {
          const snapshot = await graph.getState(config);
          const interrupted = snapshot.tasks.some(task => task.interrupts?.length);
          await graph.invoke(interrupted ? new Command({ resume: true }) : snapshot.values?.jobId ? null : { jobId: job.id }, config);
        } finally { await dedicated.execute(sql`select pg_advisory_unlock(hashtextextended(${`marketing:connection:job:${job.id}`}, 0))`); }
      });
    } catch (error) {
      await queue.patch(job.id, job.leaseOwner, { nextPollAt: new Date(Date.now() + 30000), reason: "저장된 실행을 복구 중입니다. 자동 재요청하지 않습니다." }).catch(() => {});
      throw error;
    } finally { clearInterval(heartbeat); await queue.release(job.id, job.leaseOwner); }
  }
  return { queue, graph, advance, close: () => checkpointer.end() };
}

export async function startMarketingConnectionWorker(db: Db, options: Options) {
  const workflow = await createMarketingConnectionWorkflow(db, options), owner = randomUUID();
  const pending = new Set<Promise<void>>();
  let stopped = false, ticking = false;
  async function sweep() {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await workflow.queue.schedule();
      const jobs = await workflow.queue.claim(owner);
      for (const job of jobs) {
        const execution = workflow.advance(job).catch(async () => {
          // Failures leave their saved native handle and graph available for recovery.
          await workflow.queue.release(job.id, owner);
        }).finally(() => pending.delete(execution));
        pending.add(execution);
      }
    } finally { ticking = false; }
  }
  const timer = setInterval(() => { void sweep().catch(() => logger.warn("Marketing connection queue sweep failed; retrying.")); }, 5000); timer.unref();
  await sweep();
  return { sweep, async shutdown() { stopped = true; clearInterval(timer); await Promise.allSettled([...pending]); await workflow.close(); } };
}
