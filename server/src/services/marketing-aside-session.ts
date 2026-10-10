import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { HttpError } from "../errors.js";

const runFile = promisify(execFile);
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{10,128}$/);
const accountSchema = z.string().regex(/^u\d{1,6}$/);
const stateSchema = z.object({
  id: idSchema,
  status: z.string(),
  children: z.array(z.object({ id: idSchema, status: z.string() }).strict()),
}).strict();
const preparationMarker = "PAPERCLIP_SESSION ";
const stateMarker = "PAPERCLIP_SESSION_STATE ";

function nativeMarker(output: string, marker: string) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  if (/\[error\s*\|/.test(clean)) throw new HttpError(503, "Aside 세션 확인을 완료하지 못했습니다.");
  const candidates = clean.split("\n").filter(line => line.includes(marker + "{"));
  if (candidates.length !== 1) throw new HttpError(503, "Aside 세션 확인 결과가 없거나 모호합니다.");
  const line = candidates[0];
  try { return JSON.parse(line.slice(line.indexOf(marker) + marker.length).trim()); }
  catch { throw new HttpError(503, "Aside 세션 확인 결과를 읽을 수 없습니다."); }
}

export function parseMarketingAsidePreparedSession(output: string) {
  const parsed = z.object({ id: idSchema, status: z.string() }).strict()
    .safeParse(nativeMarker(output, preparationMarker));
  if (!parsed.success) throw new HttpError(503, "Aside 준비 세션 ID를 확인할 수 없습니다.");
  return parsed.data.id;
}

export function parseMarketingAsideSessionState(output: string, expectedId: string) {
  const parsed = stateSchema.safeParse(nativeMarker(output, stateMarker));
  if (!parsed.success || parsed.data.id !== expectedId) throw new HttpError(503, "Aside 대상 세션이 일치하지 않습니다.");
  // Child sessions can outlive the parent. Unknown states never release dispatch.
  return { ...parsed.data, terminal: parsed.data.status === "idle" && parsed.data.children.length === 0 };
}

export async function readMarketingAsideSession(accountId: string, sessionId: string) {
  accountSchema.parse(accountId); idSchema.parse(sessionId);
  const code = `const id=${JSON.stringify(sessionId)};const s=aside.sessions.get(id);console.log(${JSON.stringify(stateMarker)}+JSON.stringify({id:s.id,status:s.status,children:aside.sessions.childSessions(id).map(c=>({id:c.id,status:c.status}))}));`;
  try {
    const result = await runFile("aside", ["--account", accountId, "repl", code], { timeout: 30000, maxBuffer: 65536, encoding: "utf8" });
    return parseMarketingAsideSessionState(result.stdout, sessionId);
  } catch {
    throw new HttpError(503, "Aside의 실제 세션 상태를 확인할 수 없습니다. 재발행하지 마십시오.");
  }
}

export async function readMarketingAsideAssistantResults(accountId: string, sessionId: string) {
  accountSchema.parse(accountId); idSchema.parse(sessionId);
  const marker = "PAPERCLIP_SESSION_RESULTS ";
  const code = `const messages=await aside.sessions.messages(${JSON.stringify(sessionId)},{limit:20,order:"desc"});console.log(${JSON.stringify(marker)}+JSON.stringify({messages:messages.filter(m=>m.role==="assistant").map(m=>typeof m.content==="string"?m.content:m.content.filter(c=>c.type==="text").map(c=>c.text).join("\\n"))}));`;
  try {
    const result = await runFile("aside", ["--account", accountId, "repl", code], { timeout: 30000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" });
    const parsed = z.object({ messages: z.array(z.string().max(100000)).max(20) }).strict().safeParse(nativeMarker(result.stdout, marker));
    if (!parsed.success) throw new Error("Invalid session transcript");
    return parsed.data.messages;
  } catch { throw new HttpError(503, "저장된 Aside 세션의 결과를 확인할 수 없습니다. 재발행하지 마십시오."); }
}

export async function prepareMarketingAsideSession(accountId: string, onSession: (id: string) => Promise<void>) {
  accountSchema.parse(accountId);
  const prompt = [
    "This is a non-publishing execution-context preparation task. Your only permitted operation is the native repl tool with this exact code:",
    `{const s=aside.sessions.current();console.log(${JSON.stringify(preparationMarker)}+JSON.stringify({id:s?.id,status:s?.status}));}`,
    "Do not browse, open tabs, log in, modify files, submit, save or publish anything. Do not start child tasks, change account/security/permission settings or ask questions. After the tool result, report only the session ID and stop.",
  ].join("\n");
  let output: string;
  try {
    const execution = runFile("aside", ["--account", accountId, "exec", "--", prompt], { timeout: 120000, maxBuffer: 262144, encoding: "utf8" });
    // exec reads piped input; close it rather than leaving an unattended prompt open.
    execution.child.stdin?.end();
    const result = await execution;
    output = `${result.stdout}\n${result.stderr}`;
  }
  catch (error) {
    // Preparation has no publication authority, but its real handle still matters.
    const captured = error as { stdout?: unknown; stderr?: unknown };
    output = `${typeof captured.stdout === "string" ? captured.stdout : ""}\n${typeof captured.stderr === "string" ? captured.stderr : ""}`;
  }
  const id = parseMarketingAsidePreparedSession(output);
  await onSession(id);
  const state = await readMarketingAsideSession(accountId, id);
  if (!state.terminal) throw new HttpError(409, "Aside 준비 세션이 아직 실행 중입니다. 상태 확인이 필요합니다.");
  return id;
}

export async function resumeMarketingAsideSession(accountId: string, sessionId: string, prompt: string) {
  accountSchema.parse(accountId); idSchema.parse(sessionId);
  const before = await readMarketingAsideSession(accountId, sessionId);
  if (!before.terminal) throw new HttpError(409, "기존 Aside 세션을 먼저 확인해야 합니다.");
  let output = "", interrupted = false;
  try {
    const execution = runFile("aside", ["--account", accountId, "exec", "--session", sessionId, "--", prompt], { timeout: 300000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" });
    execution.child.stdin?.end();
    output = (await execution).stdout;
  }
  catch (error) {
    interrupted = true;
    output = typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : "";
  }
  let terminal = false;
  try { terminal = (await readMarketingAsideSession(accountId, sessionId)).terminal; }
  catch { /* A missing native state is uncertain, not evidence of completion. */ }
  return { sessionId, terminal, interrupted, output };
}
