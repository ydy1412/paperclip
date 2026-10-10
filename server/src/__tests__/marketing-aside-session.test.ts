import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMarketingAsidePreparedSession, parseMarketingAsideSessionState, prepareMarketingAsideSession, resumeMarketingAsideSession } from "../services/marketing-aside-session.js";

const native = vi.hoisted(() => ({ run: vi.fn(), stdinEnd: vi.fn(), status: "idle", validMarker: true }));
vi.mock("node:util", () => ({ promisify: () => native.run }));

const id = "kJ92kUgSeCFlF2Dy";
const state = (status: string, children: { id: string; status: string }[] = []) =>
  `PAPERCLIP_SESSION_STATE ${JSON.stringify({ id, status, children })}\n[ok | 12ms]`;
beforeEach(() => {
  vi.clearAllMocks(); native.status = "idle"; native.validMarker = true;
  native.run.mockImplementation((_command: string, args: string[]) => {
    const result = args.includes("repl") ? { stdout: state(native.status), stderr: "" }
      : args.includes("--session") ? { stdout: id, stderr: "" }
      : { stdout: id, stderr: native.validMarker ? `PAPERCLIP_SESSION ${JSON.stringify({ id, status: "running" })}` : "Missing native handle" };
    let complete!: (value: typeof result) => void;
    const promise = new Promise<typeof result>(resolve => { complete = resolve; });
    const end = () => { native.stdinEnd(); complete(result); };
    if (args.includes("repl")) complete(result);
    return Object.assign(promise, { child: { stdin: { end } } });
  });
});
describe("native Aside marketing sessions", () => {
  it("closes piped input, captures tool evidence from stderr and persists before resuming", async () => {
    const persist = vi.fn(async () => {});
    const prepared = await prepareMarketingAsideSession("u1", persist);
    expect(prepared).toBe(id); expect(persist).toHaveBeenCalledWith(id);
    expect(native.stdinEnd).toHaveBeenCalledTimes(1);
    const result = await resumeMarketingAsideSession("u1", prepared, "Read-only test prompt");
    expect(result.terminal).toBe(true); expect(result.interrupted).toBe(false);
    expect(native.stdinEnd).toHaveBeenCalledTimes(2);
    expect(native.run.mock.calls[3][1]).toEqual(["--account", "u1", "exec", "--session", id, "--", "Read-only test prompt"]);
  });
  it("does not resume an active native session or accept missing preparation evidence", async () => {
    native.status = "running";
    await expect(resumeMarketingAsideSession("u1", id, "Never execute this")).rejects.toThrow("먼저 확인");
    expect(native.run.mock.calls.every(call => call[1].includes("repl"))).toBe(true);
    native.validMarker = false; const persist = vi.fn();
    await expect(prepareMarketingAsideSession("u1", persist)).rejects.toThrow(); expect(persist).not.toHaveBeenCalled();
  });
  it("stops when the prepared handle cannot be persisted", async () => {
    const persist = vi.fn(async () => { throw new Error("Database unavailable"); });
    await expect(prepareMarketingAsideSession("u1", persist)).rejects.toThrow("Database unavailable");
    expect(native.run).toHaveBeenCalledTimes(1);
  });
  it("extracts the native preparation handle from colored tool output, not final prose", () => {
    expect(parseMarketingAsidePreparedSession(`\x1b[2m > PAPERCLIP_SESSION {"id":"${id}","status":"running"}\x1b[0m\n${id}`)).toBe(id);
    expect(() => parseMarketingAsidePreparedSession(`Finished session ${id}`)).toThrow();
  });
  it("rejects ambiguous markers, CLI errors, malformed records and executable ids", () => {
    const marker = `PAPERCLIP_SESSION {"id":"${id}","status":"running"}`;
    expect(() => parseMarketingAsidePreparedSession(marker + "\n" + marker)).toThrow();
    expect(() => parseMarketingAsidePreparedSession(marker + "\n[error | 2ms]")).toThrow();
    expect(() => parseMarketingAsidePreparedSession('PAPERCLIP_SESSION {"id":"../../x","status":"idle"}')).toThrow();
    expect(() => parseMarketingAsidePreparedSession("PAPERCLIP_SESSION {bad-json}")).toThrow();
  });
  it("only marks the expected idle native session without children terminal", () => {
    expect(parseMarketingAsideSessionState(state("idle"), id).terminal).toBe(true);
    expect(() => parseMarketingAsideSessionState(state("idle"), "differentSessionId")).toThrow();
  });
  it.each(["running", "queued", "error", "stopped", "unknown"])("does not infer termination from %s", status => {
    expect(parseMarketingAsideSessionState(state(status), id).terminal).toBe(false);
  });
  it("does not release a parent with children, including idle children with unobserved descendants", () => {
    expect(parseMarketingAsideSessionState(state("idle", [{ id: "childSession1234", status: "running" }]), id).terminal).toBe(false);
    expect(parseMarketingAsideSessionState(state("idle", [{ id: "childSession1234", status: "idle" }]), id).terminal).toBe(false);
  });
});
