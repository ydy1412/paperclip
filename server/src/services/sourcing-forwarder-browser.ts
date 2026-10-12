import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Page } from "playwright-core";
import type { SourcingForwarderOpenResult } from "@paperclipai/shared";
import { badRequest, conflict, unprocessable } from "../errors.js";
import { asideCommand, prepareAsideSession, readAsideSession, resumeAsideSession } from "./aside-session.js";
import { forwarderAsideHelper, forwarderPageProof } from "./sourcing-forwarder-aside-helper.js";

const nextOrigin = "https://www.next1688.com";
export function supportsForwarderLogin(loginUrl: string): boolean {
  const url = new URL(loginUrl);
  return url.origin === nextOrigin && url.pathname.toLowerCase() === "/front/join/login.asp";
}

export interface ForwarderBrowserInput {
  id: string;
  companyId: string;
  loginUrl: string;
  credentials: { loginId: string; password: string };
  attemptId: string;
  onSession: (sessionId: string) => Promise<void>;
}
export type ForwarderBrowserOpen = ((input: ForwarderBrowserInput) => Promise<SourcingForwarderOpenResult>) & {
  reconcile?: (input: ForwarderBrowserInput, sessionId: string) => Promise<SourcingForwarderOpenResult>;
};

// Exported separately so origin/field failures can be tested without launching a browser.
export async function submitNextForwarderLogin(page: Page, loginUrl: string, credentials: ForwarderBrowserInput["credentials"]) {
  if (!supportsForwarderLogin(loginUrl) || new URL(page.url()).origin !== nextOrigin) {
    throw badRequest("로그인 화면의 사이트가 달라 계정 입력을 중단했습니다.");
  }
  // Aside uses native querySelectorAll. Playwright's :visible extension is not
  // valid CSS there; inspect visibility separately before sending credentials.
  const loginId = page.locator("#sMemId");
  const password = page.locator("#sMemPw");
  await password.waitFor({ state: "visible", timeout: 10000 });
  if (await loginId.count() !== 1 || await password.count() !== 1) throw unprocessable("로그인 입력 화면이 변경됐습니다. Aside에서 확인해 주세요.");
  const submit = page.locator('form:has(#sMemPw) a[onclick="fnLoginM();"]');
  if (await submit.count() !== 1) throw unprocessable("로그인 버튼을 확인할 수 없습니다.");
  if (!await loginId.isVisible() || !await password.isVisible() || !await submit.isVisible()) {
    throw unprocessable("로그인 화면을 확인할 수 없습니다.");
  }
  // A redirect must never receive stored credentials, even after the inputs appeared.
  if (new URL(page.url()).origin !== nextOrigin) throw badRequest("로그인 화면의 사이트가 변경됐습니다.");
  await loginId.fill(credentials.loginId, { timeout: 5000 });
  if (new URL(page.url()).origin !== nextOrigin) throw badRequest("로그인 화면의 사이트가 변경됐습니다.");
  await password.fill(credentials.password, { timeout: 5000 });
  if (new URL(page.url()).origin !== nextOrigin) throw badRequest("로그인 화면의 사이트가 변경됐습니다.");
  if (await loginId.inputValue() !== credentials.loginId || await password.inputValue() !== credentials.password) {
    throw unprocessable("로그인 계정 입력을 확인할 수 없습니다.");
  }
  await submit.click({ timeout: 10000 });
}

const runFile = promisify(execFile);
const sessionPattern = /^[A-Za-z0-9_-]{10,128}$/;
const receiptSchema = z.object({ attemptId: z.string().uuid(), sessionId: z.string().regex(sessionPattern),
  status: z.enum(["verified", "failed", "blocked", "page_opened"]), errorCode: z.enum(["verification_unconfirmed", "origin_changed",
    "login_controls_changed", "credentials_unavailable", "existing_session_unconfirmed", "login_failed", "account_identity_unconfirmed"]).nullable(),
  tabId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).nullable(), submitted: z.boolean() }).strict();

export function forwarderIdentityHash(loginId: string) {
  return createHash("sha256").update(loginId.normalize("NFKC").trim()).digest("hex");
}

export function sourcingForwarderBrowser() {
  const account = process.env.PAPERCLIP_ASIDE_ACCOUNT_ID ?? "u1";
  if (!/^u\d{1,6}$/.test(account)) throw new Error("Invalid Aside account");
  const root = path.join(homedir(), ".aside", "u", account.slice(1), "sessions");
  let opening = false;
  let stopped = false;

  async function files(sessionId: string, attemptId: string) {
    if (!sessionPattern.test(sessionId) || !z.string().uuid().safeParse(attemptId).success) throw new Error("Invalid handle");
    const names = (await readdir(root)).filter(name => name.endsWith("_" + sessionId));
    if (names.length !== 1) throw new Error("Unknown Aside session directory");
    const sessionRoot = path.join(root, names[0]);
    const stat = await lstat(sessionRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid Aside directory");
    const directory = path.join(sessionRoot, "tmp");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("Invalid Aside output directory");
    return { credentials: path.join(directory, `forwarder-${attemptId}.credentials.json`),
      helper: path.join(directory, `forwarder-${attemptId}.helper.js`), receipt: path.join(directory, `forwarder-${attemptId}.result.json`) };
  }
  async function cleanup(sessionId: string, attemptId: string) {
    const paths = await files(sessionId, attemptId);
    await Promise.allSettled([unlink(paths.credentials), unlink(paths.helper)]);
  }
  async function reconcile(input: ForwarderBrowserInput, sessionId: string): Promise<SourcingForwarderOpenResult> {
    const base = { browser: "aside" as const, sessionId };
    let terminal = false;
    try {
      terminal = (await readAsideSession(account, sessionId)).terminal;
      if (!terminal) return { ...base, status: "verifying" };
      const paths = await files(sessionId, input.attemptId);
      if ((await lstat(paths.receipt)).isSymbolicLink()) throw new Error("Invalid receipt");
      const receipt = receiptSchema.parse(JSON.parse(await readFile(paths.receipt, "utf8")));
      if (receipt.attemptId !== input.attemptId || receipt.sessionId !== sessionId) throw new Error("Receipt mismatch");
      if (receipt.status !== "verified") return { ...base, status: receipt.status, errorCode: receipt.errorCode };
      if (!supportsForwarderLogin(input.loginUrl) || !receipt.submitted || !receipt.tabId) throw new Error("No authenticated submission");
      // Independently read the actual resulting tab. An agent's final sentence,
      // receipt, completed CLI or clicked login button cannot turn the dot green.
      const marker = "PAPERCLIP_FORWARDER_PROOF ";
      const code = `const p=await attachBrowserTab(${JSON.stringify(receipt.tabId)});try{console.log(${JSON.stringify(marker)}+JSON.stringify(await p.evaluate(${forwarderPageProof.toString()})));}finally{await closeTab(p);}`;
      const native = await runFile(asideCommand, ["--account", account, "repl", code], { timeout: 30000, maxBuffer: 131072, encoding: "utf8" });
      const lines = native.stdout.split("\n").filter(line => line.startsWith(marker));
      if (lines.length !== 1 || /\[error\s*\|/.test(native.stdout)) throw new Error("No native proof");
      const proof = z.object({ origin: z.literal(nextOrigin), profilePage: z.literal(true), authenticated: z.literal(true),
        identityHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(8) }).strict().parse(JSON.parse(lines[0].slice(marker.length)));
      if (!proof.identityHashes.includes(forwarderIdentityHash(input.credentials.loginId))) throw new Error("Account mismatch");
      return { ...base, status: "verified", errorCode: null };
    } catch {
      return { ...base, status: terminal ? "blocked" : "verifying", errorCode: "verification_unconfirmed" };
    } finally {
      if (terminal) await cleanup(sessionId, input.attemptId).catch(() => undefined);
    }
  }
  const open: ForwarderBrowserOpen = async input => {
    if (stopped) throw conflict("Dovix가 종료 중입니다.");
    if (opening) throw conflict("다른 배송대행지 계정의 로그인 확인이 진행 중입니다.");
    opening = true;
    let sessionId: string | null = null;
    try {
      sessionId = await prepareAsideSession(account, input.onSession);
      const paths = await files(sessionId, input.attemptId);
      let helper: string;
      if (supportsForwarderLogin(input.loginUrl)) {
        await writeFile(paths.credentials, JSON.stringify(input.credentials), { flag: "wx", mode: 0o600 });
        helper = forwarderAsideHelper({ attemptId: input.attemptId, sessionId, loginUrl: input.loginUrl,
          credentialsPath: paths.credentials, receiptPath: paths.receipt, identityHash: forwarderIdentityHash(input.credentials.loginId),
          supportsSource: supportsForwarderLogin.toString(), submitSource: submitNextForwarderLogin.toString() });
      } else {
        helper = `(async()=>{const p=await openTab(${JSON.stringify(input.loginUrl)});const result=${JSON.stringify({ attemptId: input.attemptId,
          sessionId, status: "page_opened", errorCode: null, tabId: null, submitted: false })};result.tabId=p.targetId;await fs.writeFile(${JSON.stringify(paths.receipt)},JSON.stringify(result));return result;})()`;
      }
      await writeFile(paths.helper, helper, { flag: "wx", mode: 0o600 });
      const prompt = ["Verify the selected saved shipping-forwarder account in this NEW Aside session. Preserve existing tabs and the new result tab.",
        "Your only permitted operation is the native repl tool with this exact trusted local helper invocation, once:",
        `const result=await eval(await fs.readFile(${JSON.stringify(paths.helper)},"utf8"));console.log("PAPERCLIP_FORWARDER_RESULT "+JSON.stringify(result));`,
        "The helper handles origin checks, private credential input, normal sign-in and account proof. Never read/print the credential file, raw field values, profile contents, errors or screenshots.",
        "Do not ask questions or repeat a login. Do not create children, buy, submit shipping forms, send messages, change permissions/security or Aside profiles. Report human/access blockers without bypassing them.",
        "After the helper returns, report only its bounded result and stop. Never invent a successful receipt."].join("\n");
      const native = await resumeAsideSession(account, sessionId, prompt);
      if (!native.terminal) return { status: "verifying", browser: "aside", sessionId, errorCode: "verification_unconfirmed" };
      return reconcile(input, sessionId);
    } catch {
      if (sessionId) return reconcile(input, sessionId);
      return { status: "blocked", browser: "aside", sessionId: null, errorCode: "aside_unavailable" };
    } finally { opening = false; }
  };
  open.reconcile = reconcile;
  return { open, close: async () => { stopped = true; } };
}
