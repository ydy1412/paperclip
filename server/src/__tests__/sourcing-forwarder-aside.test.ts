import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, stat, access, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
const native = vi.hoisted(() => ({ home: "", prepare: vi.fn(), read: vi.fn(), resume: vi.fn(),
  calls: [] as unknown[][], proof: {} as Record<string, unknown>, paths: [] as { credentials: string; helper: string }[] }));
vi.mock("node:os", async original => ({ ...await original<typeof import("node:os")>(), homedir: () => native.home }));
vi.mock("../services/aside-session.js", () => ({ asideCommand: "aside", prepareAsideSession: native.prepare, readAsideSession: native.read, resumeAsideSession: native.resume }));
vi.mock("node:child_process", () => {
  const execFile = (...args: unknown[]) => {
    native.calls.push(args.slice(0, 3));
    (args.at(-1) as (error: null, stdout: string, stderr: string) => void)(null, "PAPERCLIP_FORWARDER_PROOF " + JSON.stringify(native.proof) + "\n", "");
  };
  // Node's execFile has a custom promisifier returning both output streams.
  Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), { value: async (...args: unknown[]) => {
    native.calls.push(args);
    return { stdout: "PAPERCLIP_FORWARDER_PROOF " + JSON.stringify(native.proof) + "\n", stderr: "" };
  } });
  return { execFile };
});
import { sourcingForwarderBrowser, forwarderIdentityHash } from "../services/sourcing-forwarder-browser.js";

beforeEach(async () => {
  vi.clearAllMocks(); native.calls = []; native.paths = [];
  native.home = await mkdtemp("/tmp/forwarder-native-");
  native.proof = { origin: "https://www.next1688.com", profilePage: true, authenticated: true, identityHashes: [forwarderIdentityHash("fixture-user")] };
  native.read.mockResolvedValue({ terminal: true });
  let number = 0;
  native.prepare.mockImplementation(async (_account, checkpoint) => {
    const id = "nativeSession" + String(++number).padStart(6, "0");
    await mkdir(path.join(native.home, ".aside/u/1/sessions/2026-10-13_" + id), { recursive: true });
    await checkpoint(id); return id;
  });
  native.resume.mockImplementation(async (_account, sessionId, prompt: string) => {
    const helper = JSON.parse(prompt.match(/fs\.readFile\(("[^"]+")/)![1]);
    const source = await readFile(helper, "utf8");
    const config = JSON.parse(source.match(/const configuration=(\{[^\n]+\});/)![1]);
    expect((await stat(config.credentialsPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(config.credentialsPath, "utf8"))).toEqual({ loginId: "fixture-user", password: "private-fixture-password" });
    native.paths.push({ credentials: config.credentialsPath, helper });
    expect(source).not.toContain("private-fixture-password"); expect(prompt).not.toContain("private-fixture-password");
    await writeFile(config.receiptPath, JSON.stringify({ attemptId: config.attemptId, sessionId,
      status: "verified", errorCode: null, tabId: "fixtureTab123456789", submitted: true }));
    return { terminal: true };
  });
});
afterEach(async () => { await rm(native.home, { recursive: true, force: true }); });
const input = () => ({ id: randomUUID(), companyId: randomUUID(), attemptId: randomUUID(),
  loginUrl: "https://www.next1688.com/Front/Join/Login.asp?gMnu1=207&gMnu2=20702",
  credentials: { loginId: "fixture-user", password: "private-fixture-password" }, onSession: vi.fn(async () => {}) });

describe("forwarder native session and private credential boundary", () => {
  it("starts a fresh session each time, verifies the real tab separately, and removes private inputs", async () => {
    const browser = sourcingForwarderBrowser(), first = input(), second = input();
    const one = await browser.open(first), two = await browser.open(second);
    expect(one.status).toBe("verified"); expect(two.status).toBe("verified"); expect(one.sessionId).not.toBe(two.sessionId);
    expect(native.prepare).toHaveBeenCalledTimes(2); expect(native.calls).toHaveLength(2);
    expect(JSON.stringify(native.calls)).not.toContain("private-fixture-password");
    for (const files of native.paths) { await expect(access(files.credentials)).rejects.toThrow(); await expect(access(files.helper)).rejects.toThrow(); }
  });
  it("does not accept an agent success receipt for a different authenticated account", async () => {
    native.proof.identityHashes = [forwarderIdentityHash("other-account")];
    const result = await sourcingForwarderBrowser().open(input());
    expect(result).toMatchObject({ status: "blocked", errorCode: "verification_unconfirmed" });
    await expect(access(native.paths[0].credentials)).rejects.toThrow();
  });
  it("rejects changed origins and keeps a nonterminal native session unconfirmed", async () => {
    native.proof.origin = "https://other.example";
    expect((await sourcingForwarderBrowser().open(input())).status).toBe("blocked");
    native.read.mockResolvedValue({ terminal: false });
    const browser = sourcingForwarderBrowser(), request = input(), result = await browser.open(request);
    expect(result.status).toBe("verifying"); expect(native.calls).toHaveLength(1);
    expect((await stat(native.paths.at(-1)!.credentials)).mode & 0o777).toBe(0o600);
    native.read.mockResolvedValue({ terminal: true }); native.proof.origin = "https://www.next1688.com";
    expect((await browser.open.reconcile!(request, result.sessionId!)).status).toBe("verified");
    await expect(access(native.paths.at(-1)!.credentials)).rejects.toThrow();
  });
  it("compares the selected account identity exactly", () => {
    expect(forwarderIdentityHash("AccountA")).not.toBe(forwarderIdentityHash("accounta"));
    expect(forwarderIdentityHash(" fixture-user ")).toBe(forwarderIdentityHash("fixture-user"));
  });
});
