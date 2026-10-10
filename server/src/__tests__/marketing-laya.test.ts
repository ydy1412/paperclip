import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyMarketingLayaObservation } from "../services/marketing-laya.js";

const native = vi.hoisted(() => ({ run: vi.fn(), end: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => native.run }));
const input = { platform: "naver_blog" as const, accountId: "fixture_owner", observation: "Fresh matching owner is signed in." };
const options = { pythonPath: "/trusted/python", scriptPath: "/trusted/inference.py", checkpointPath: "/trusted/checkpoint" };
const receipt = () => ({ status: "connected", choice: "connected", probability: 0.9,
  probabilities: { connected: 0.9, auth_required: 0.05, unknown: 0.05 },
  model: "local/laya-marketing-rlcd", usage: { inputTokens: 200, outputTokens: 0 }, truncated: false });
beforeEach(() => {
  vi.clearAllMocks();
  native.run.mockImplementation(() => Object.assign(Promise.resolve({ stdout: JSON.stringify(receipt()), stderr: "" }),
    { child: { stdin: { end: native.end } } }));
});

describe("local Laya observation adapter", () => {
  it("passes only strict observation fields over stdin and loads local paths without a shell", async () => {
    expect(await classifyMarketingLayaObservation(input, options)).toEqual(receipt());
    const [command, args, config] = native.run.mock.calls[0];
    expect(command).toBe(options.pythonPath);
    expect(args).toEqual([options.scriptPath, "--checkpoint", options.checkpointPath, "--device", "auto", "--min-probability", "0.8"]);
    expect(args).not.toContain(input.observation);
    expect(native.end).toHaveBeenCalledWith(JSON.stringify(input));
    expect(config).toMatchObject({ timeout: 45000, maxBuffer: 65536, env: { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } });
    expect(config.env).not.toHaveProperty("AI_GATEWAY_API_KEY");
    expect(config).not.toHaveProperty("shell");
  });
  it("preserves a low-probability raw choice while returning unknown", async () => {
    const result = { ...receipt(), status: "unknown", probability: 0.7,
      probabilities: { connected: 0.7, auth_required: 0.1, unknown: 0.2 } };
    native.run.mockReturnValue(Object.assign(Promise.resolve({ stdout: JSON.stringify(result) }), { child: { stdin: { end: native.end } } }));
    expect(await classifyMarketingLayaObservation(input, options)).toEqual(result);
  });
  it.each([
    { ...input, password: "secret" }, { ...input, observation: "" }, { ...input, accountId: "" },
    { ...input, platform: "fake" }, { ...input, observation: "x".repeat(12001) },
  ])("rejects invalid input without spawning", async invalid => {
    await expect(classifyMarketingLayaObservation(invalid as typeof input, options)).rejects.toThrow("Invalid Laya channel observation");
    expect(native.run).not.toHaveBeenCalled();
  });
  it.each([0.4, 1.1, NaN, Infinity])("rejects invalid threshold %s", async minProbability => {
    await expect(classifyMarketingLayaObservation(input, { ...options, minProbability })).rejects.toThrow("threshold");
    expect(native.run).not.toHaveBeenCalled();
  });
  it("rejects relative runtime paths and unsupported device before spawning", async () => {
    await expect(classifyMarketingLayaObservation(input, { ...options, scriptPath: "relative.py" })).rejects.toThrow("Absolute");
    await expect(classifyMarketingLayaObservation(input, { ...options, device: "fake" as "cpu" })).rejects.toThrow("device");
    expect(native.run).not.toHaveBeenCalled();
  });
  it.each([
    { ...receipt(), truncated: true }, { ...receipt(), choice: "deleted" }, { ...receipt(), probability: 0.5 },
    { ...receipt(), status: "unknown" }, { ...receipt(), model: "other" },
    { ...receipt(), probabilities: { connected: 0.1, auth_required: 0.8, unknown: 0.1 } },
    { ...receipt(), probabilities: { connected: 0.9, auth_required: 0.9, unknown: 0.9 } },
  ])("rejects inconsistent or incomplete results", async invalid => {
    native.run.mockReturnValue(Object.assign(Promise.resolve({ stdout: JSON.stringify(invalid) }), { child: { stdin: { end: native.end } } }));
    await expect(classifyMarketingLayaObservation(input, options)).rejects.toThrow(/Invalid|Inconsistent/);
  });
  it("sanitizes process failure and never turns it into a successful unknown", async () => {
    native.run.mockReturnValue(Object.assign(Promise.reject(new Error(input.observation)), { child: { stdin: { end: native.end } } }));
    await expect(classifyMarketingLayaObservation(input, options)).rejects.toThrow(/^Local Laya process or JSON response failed$/);
    expect(native.run).toHaveBeenCalledTimes(1);
  });
  it("sanitizes non-JSON output", async () => {
    native.run.mockReturnValue(Object.assign(Promise.resolve({ stdout: "private diagnostics" }), { child: { stdin: { end: native.end } } }));
    await expect(classifyMarketingLayaObservation(input, options)).rejects.toThrow(/^Local Laya process or JSON response failed$/);
  });
  it("does not spawn when already cancelled", async () => {
    const controller = new AbortController(); controller.abort("private reason");
    await expect(classifyMarketingLayaObservation(input, { ...options, signal: controller.signal })).rejects.toThrow(/^Local Laya request cancelled$/);
    expect(native.run).not.toHaveBeenCalled();
  });
});
