import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertMarketingAsideBinding, marketingAsideProfiles } from "../src/services/marketing-aside-profiles.js";
import { classifyMarketingLayaObservation } from "../src/services/marketing-laya.js";

const status = z.enum(["connected", "auth_required", "unknown"]);
const configSchema = z.object({
  source: z.literal("authenticated_paperclip_marketing_api"),
  profile: z.object({ asideAccountId: z.string().regex(/^u\d{1,6}$/), browserProfileName: z.string().min(1) }).strict(),
  channel: z.object({ platform: z.literal("naver_blog"), accountId: z.string().regex(/^[a-zA-Z0-9_-]+$/), accountUrl: z.string().url() }).strict(),
  pythonPath: z.string(), checkpointPath: z.string(),
}).strict();
const observationSchema = z.object({
  platform: z.literal("naver_blog"), accountId: z.string(), observation: z.string().min(1).max(2000),
  observedState: status,
  evidence: z.object({ checkedAt: z.string().datetime(), ownerMatches: z.boolean().nullable(),
    authenticationRequired: z.boolean().nullable(), urls: z.array(z.string().url()).max(8),
    observedControls: z.array(z.string().max(100)).max(20), failures: z.array(z.string().max(500)).max(10) }).strict(),
  sideEffects: z.object({ tabsCreated: z.number().int().min(0).max(3), tabsClosed: z.number().int().min(0).max(3),
    preExistingTabsPreserved: z.literal(true), contentMutated: z.literal(false), accountsChanged: z.literal(false) }).strict(),
}).strict();

async function main() {
  const [configPath, outputPath] = process.argv.slice(2);
  if (!configPath || !outputPath) throw new Error("Config and report paths required");
  const evidencePath = outputPath + ".observation.json";
  for (const target of [outputPath, evidencePath]) {
    await readFile(target).then(() => { throw new Error("Refusing to overwrite live report or evidence"); }, error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
  phase = "configuration";
  const config = configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  const channelUrl = new URL(config.channel.accountUrl);
  if (channelUrl.origin !== "https://blog.naver.com" || channelUrl.pathname !== `/${config.channel.accountId}` || channelUrl.search || channelUrl.hash) {
    throw new Error("Naver owner URL must match configured identity");
  }
  if (![config.pythonPath, config.checkpointPath].every(p => path.isAbsolute(p))) throw new Error("Absolute runtime paths required");
  phase = "Aside profile binding";
  assertMarketingAsideBinding(await marketingAsideProfiles(), config.profile);
  const marker = "PAPERCLIP_LAYA_OBSERVATION ";
  const prompt = [
    "Read-only verification of the following selected Paperclip Naver Blog channel. Do not start child tasks.",
    JSON.stringify(config.channel),
    "Use only this Aside account/profile. Inspect https://blog.naver.com/MyBlog.naver and the exact channel URL. Follow only visible first-party Naver links if necessary. Preserve all pre-existing tabs and close only tabs you create. Do not edit, fill, save, publish, send, delete, sign out, switch accounts, log in, change settings/permissions/security, access credentials or write files. Do not read full posts, comments or messages.",
    "If login/MFA/passkey/CAPTCHA is required, record auth_required and stop without authenticating. Timeout, missing, conflicting or wrong-owner evidence means unknown, never deletion. Public blog access alone is not proof of login. Check actual owner redirect and owner-only controls. observation must be a concise factual Korean paragraph, not instructions or an expected class name.",
    "Return exactly one compact single-line JSON object prefixed with " + marker + "(one space after the prefix). Required exact keys: platform, accountId, observation, observedState, evidence, sideEffects. observedState is connected/auth_required/unknown. evidence keys: checkedAt (UTC ISO), ownerMatches (boolean or null), authenticationRequired (boolean or null), urls (array, omit query secrets), observedControls (array), failures (array). sideEffects keys: tabsCreated, tabsClosed (counts), preExistingTabsPreserved:true, contentMutated:false, accountsChanged:false. Report actual values only. Do not print this marker in a tool call. Do not ask questions; report a blocker and stop if verification is impossible.",
  ].join("\n\n");
  console.log("Collecting current read-only Aside evidence for the configured Naver channel");
  phase = "Aside observation";
  const execution = promisify(execFile)("aside", ["--account", config.profile.asideAccountId, "exec", "--", prompt],
    { encoding: "utf8", timeout: 180000, maxBuffer: 262144 });
  execution.child.stdin?.end();
  let output: string;
  try { const result = await execution; output = result.stdout + "\n" + result.stderr; }
  catch { throw new Error("Aside observation process failed; do not replay or mutate accounts"); }
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter(line => line.startsWith(marker));
  if (lines.length !== 1) throw new Error("Missing or ambiguous Aside observation; no state confirmed");
  const observed = observationSchema.parse(JSON.parse(lines[0].slice(marker.length)));
  const age = Date.now() - Date.parse(observed.evidence.checkedAt);
  if (age < -60000 || age > 300000 || observed.accountId !== config.channel.accountId || observed.platform !== config.channel.platform) {
    throw new Error("Stale or wrong-target Aside evidence");
  }
  if (observed.sideEffects.tabsCreated !== observed.sideEffects.tabsClosed) throw new Error("Aside did not reconcile its tabs");
  if (observed.observedState === "connected" && (observed.evidence.ownerMatches !== true || observed.evidence.authenticationRequired !== false || !observed.evidence.observedControls.length || observed.evidence.failures.length)) {
    throw new Error("Connected verdict lacks owner/authentication evidence");
  }
  if (observed.observedState === "auth_required" && observed.evidence.authenticationRequired !== true) throw new Error("Authentication verdict lacks current gate evidence");
  phase = "private evidence recording";
  await writeFile(evidencePath, JSON.stringify(observed, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const input = { platform: observed.platform, accountId: observed.accountId, observation: observed.observation };
  phase = "local Laya inference";
  const started = performance.now();
  const decision = await classifyMarketingLayaObservation(input, { pythonPath: config.pythonPath,
    scriptPath: fileURLToPath(new URL("../../scripts/marketing-laya-inference.py", import.meta.url)), checkpointPath: config.checkpointPath });
  const inferenceMilliseconds = performance.now() - started;
  const report = {
    checkedAt: new Date().toISOString(), inputSource: config.source, asideProfileBindingVerified: true,
    platform: observed.platform, observedState: observed.observedState, decision,
    rawChoiceAgrees: decision.choice === observed.observedState, effectiveStatusAgrees: decision.status === observed.observedState,
    observationSha256: createHash("sha256").update(observed.observation).digest("hex"),
    checkpointWeightsSha256: createHash("sha256").update(await readFile(path.join(config.checkpointPath, "model.safetensors"))).digest("hex"),
    evidence: { checkedAt: observed.evidence.checkedAt, ownerMatches: observed.evidence.ownerMatches,
      authenticationRequired: observed.evidence.authenticationRequired, observedControls: observed.evidence.observedControls,
      failureCount: observed.evidence.failures.length },
    sideEffects: observed.sideEffects, inferenceMilliseconds,
    inputFields: Object.keys(input), browserTranscriptSentToModel: false, productionUiChanged: false,
    limitation: "One real Naver account state; this is not general accuracy or live publication proof",
  };
  phase = "report recording";
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(report));
}
let phase = "report path validation";
main().catch(() => { console.error(`Live connection check failed at ${phase}; no channel or publication state was changed. Inspect the private evidence sidecar if present before retrying.`); process.exitCode = 1; });
