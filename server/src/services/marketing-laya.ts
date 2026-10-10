import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";
import { marketingPlatformSchema } from "@paperclipai/shared";
import type { MarketingChannelObservation } from "./marketing-jev-gateway.js";

const runFile = promisify(execFile);
const status = z.enum(["connected", "auth_required", "unknown"]);
const probability = z.number().min(0).max(1);
const observation = z.object({ platform: marketingPlatformSchema,
  accountId: z.string().trim().min(1).max(200), observation: z.string().trim().min(1).max(12000) }).strict();
const decision = z.object({
  status, choice: status, probability,
  probabilities: z.object({ connected: probability, auth_required: probability, unknown: probability }).strict()
    .refine(p => Math.abs(Object.values(p).reduce((a, b) => a + b, 0) - 1) < 0.001),
  model: z.literal("local/laya-marketing-rlcd"),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict(),
  truncated: z.literal(false),
}).strict();

/** Local inference only. No browser, network fallback, account writes or publication. */
export async function classifyMarketingLayaObservation(input: MarketingChannelObservation, options: {
  pythonPath: string; scriptPath: string; checkpointPath: string;
  device?: "auto" | "mps" | "cpu"; minProbability?: number; signal?: AbortSignal;
}) {
  const state = observation.safeParse(input);
  if (!state.success) throw new Error("Invalid Laya channel observation");
  const threshold = z.number().min(0.5).max(1).safeParse(options.minProbability ?? 0.8);
  if (!threshold.success) throw new Error("Invalid Laya probability threshold");
  if (![options.pythonPath, options.scriptPath, options.checkpointPath].every(p => typeof p === "string" && path.isAbsolute(p))) {
    throw new Error("Absolute local Laya paths required");
  }
  if (options.device && !["auto", "mps", "cpu"].includes(options.device)) throw new Error("Invalid Laya device");
  if (options.signal?.aborted) throw new Error("Local Laya request cancelled");
  let payload: unknown;
  try {
    const execution = runFile(options.pythonPath, [options.scriptPath, "--checkpoint", options.checkpointPath,
      "--device", options.device ?? "auto", "--min-probability", String(threshold.data)], {
      encoding: "utf8", timeout: 45000, maxBuffer: 65536, signal: options.signal,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, PYTHONUTF8: "1",
        PYTHONDONTWRITEBYTECODE: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", TOKENIZERS_PARALLELISM: "false" },
    });
    execution.child.stdin?.end(JSON.stringify(state.data));
    payload = JSON.parse((await execution).stdout);
  } catch {
    if (options.signal?.aborted) throw new Error("Local Laya request cancelled");
    throw new Error("Local Laya process or JSON response failed");
  }
  const parsed = decision.safeParse(payload);
  if (!parsed.success) throw new Error("Invalid local Laya decision response");
  const answer = parsed.data;
  const selected = answer.probabilities[answer.choice];
  if (Math.abs(selected - answer.probability) > 0.000001 || Object.values(answer.probabilities).some(p => p > selected)
    || answer.status !== (selected >= threshold.data ? answer.choice : "unknown")) {
    throw new Error("Inconsistent local Laya decision");
  }
  return answer;
}
