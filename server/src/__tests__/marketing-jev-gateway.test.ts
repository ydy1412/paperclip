import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyMarketingChannelObservation } from "../services/marketing-jev-gateway.js";

const input = {
  platform: "naver_blog" as const,
  accountId: "owner-test",
  observation: "현재 네이버 블로그 소유자 owner-test로 로그인되어 있습니다.",
};
const apiKey = "gateway-test-key";
function receipt(choice: "connected" | "auth_required" | "unknown" = "connected", probability = 0.96) {
  return {
    model: "typesafe-ai/jev",
    answers: {
      channelStatus: {
        type: "choice",
        choice,
        probabilities: {
          connected: choice === "connected" ? probability : (1 - probability) / 2,
          auth_required: choice === "auth_required" ? probability : (1 - probability) / 2,
          unknown: choice === "unknown" ? probability : (1 - probability) / 2,
        },
      },
    },
    usage: { inputTokens: 215, outputTokens: 25 },
    providerMetadata: { gateway: { generationId: "gen-test", cost: "0.00001" } },
  };
}
function httpReply(body: unknown = receipt(), status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Jev Gateway marketing observation adapter", () => {
  it("uses the native evaluation contract, Gateway key and one bounded Choice", async () => {
    const request = httpReply();
    const result = await classifyMarketingChannelObservation(input, { apiKey, fetch: request });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/evaluate");
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: {
      Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
    } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("typesafe-ai/jev");
    expect(body.state).toEqual(input);
    expect(Object.keys(body.questions)).toEqual(["channelStatus"]);
    expect(body.questions.channelStatus.type).toBe("choice");
    expect(Object.keys(body.questions.channelStatus.criteria)).toEqual(["connected", "auth_required", "unknown"]);
    expect(body.providerOptions).toEqual({ gateway: { zeroDataRetention: true, only: ["typesafe-ai"] } });
    expect(JSON.stringify(body)).not.toContain(apiKey);
    expect(result).toEqual({ status: "connected", choice: "connected", probability: 0.96,
      probabilities: receipt().answers.channelStatus.probabilities,
      model: "typesafe-ai/jev", usage: { inputTokens: 215, outputTokens: 25 } });
    expect(result).not.toHaveProperty("providerMetadata");
  });

  it("reads AI_GATEWAY_API_KEY only on the server invocation", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", apiKey);
    const request = httpReply();
    await classifyMarketingChannelObservation(input, { fetch: request });
    expect(request.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` });
  });

  it.each(["connected", "auth_required", "unknown"] as const)("returns %s without changing any identity", async choice => {
    const result = await classifyMarketingChannelObservation(input, { apiKey, fetch: httpReply(receipt(choice)) });
    expect(result.status).toBe(choice);
    expect(result).not.toHaveProperty("accountId");
  });

  it("keeps the original decision and probabilities when the effective status is unknown", async () => {
    const result = await classifyMarketingChannelObservation(input, { apiKey, fetch: httpReply(receipt("connected", 0.7)) });
    expect(result).toMatchObject({ status: "unknown", choice: "connected", probability: 0.7 });
  });

  it("uses the inclusive configured probability threshold", async () => {
    const result = await classifyMarketingChannelObservation(input, {
      apiKey, minProbability: 0.9, fetch: httpReply(receipt("auth_required", 0.9)),
    });
    expect(result.status).toBe("auth_required");
  });

  it.each(["", "  "])("fails without an API key and never makes a request", async key => {
    vi.stubEnv("AI_GATEWAY_API_KEY", key);
    const request = httpReply();
    await expect(classifyMarketingChannelObservation(input, { fetch: request })).rejects.toThrow("AI_GATEWAY_API_KEY");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([-1, 0.49, 1.01, NaN, Infinity])("rejects invalid threshold %s before requesting", async minProbability => {
    const request = httpReply();
    await expect(classifyMarketingChannelObservation(input, { apiKey, minProbability, fetch: request })).rejects.toThrow("threshold");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, observation: " " },
    { ...input, observation: "x".repeat(12001) },
    { ...input, accountId: "" },
    { ...input, platform: "invented" },
    { ...input, password: "must-not-leave-server" },
  ])("rejects an invalid observation without sending its contents", async invalid => {
    const request = httpReply();
    await expect(classifyMarketingChannelObservation(invalid as typeof input, { apiKey, fetch: request })).rejects.toThrow("Invalid Jev channel observation");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500, 503])("reports HTTP %s without leaking bodies or retrying", async status => {
    const request = httpReply({ error: `${apiKey}: ${input.observation}` }, status);
    await expect(classifyMarketingChannelObservation(input, { apiKey, fetch: request })).rejects.toThrow(`Jev Gateway request failed (HTTP ${status})`);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not expose exceptions from the transport", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error(`${apiKey}: ${input.observation}`));
    await expect(classifyMarketingChannelObservation(input, { apiKey, fetch: request })).rejects.toThrow(/^Jev Gateway request or JSON response failed$/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { ...receipt(), model: "other/model" },
    { ...receipt(), usage: { input_tokens: 1, output_tokens: 2 } },
    { ...receipt(), usage: { inputTokens: -1, outputTokens: 2 } },
    { ...receipt(), answers: { channelStatus: { type: "choice", choice: "deleted", probabilities: {} } } },
    { ...receipt(), answers: { channelStatus: { type: "boolean", probability: 1 } } },
    { ...receipt(), answers: { channelStatus: { ...receipt().answers.channelStatus, probabilities: { connected: 1 } } } },
    { ...receipt(), answers: { channelStatus: { ...receipt().answers.channelStatus, probabilities: { connected: 1.1, auth_required: -0.1, unknown: 0 } } } },
    { ...receipt(), answers: { channelStatus: { ...receipt().answers.channelStatus, probabilities: { connected: 0.8, auth_required: 0.8, unknown: 0.8 } } } },
  ])("rejects malformed native responses rather than claiming an observed status", async invalid => {
    await expect(classifyMarketingChannelObservation(input, { apiKey, fetch: httpReply(invalid) })).rejects.toThrow("Invalid Jev Gateway decision response");
  });

  it("rejects a choice that contradicts the probability distribution", async () => {
    const invalid = receipt("auth_required");
    invalid.answers.channelStatus.choice = "connected";
    await expect(classifyMarketingChannelObservation(input, { apiKey, fetch: httpReply(invalid) })).rejects.toThrow("Inconsistent Jev Gateway choice probabilities");
  });

  it("rejects non-JSON responses", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("private upstream failure"));
    await expect(classifyMarketingChannelObservation(input, { apiKey, fetch: request })).rejects.toThrow(/^Jev Gateway request or JSON response failed$/);
  });

  it("does not call the provider if already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error(apiKey));
    const request = httpReply();
    await expect(classifyMarketingChannelObservation(input, { apiKey, fetch: request, signal: controller.signal })).rejects.toThrow(/^Jev Gateway request cancelled$/);
    expect(request).not.toHaveBeenCalled();
  });

  it("supports cancellation while the provider is pending without leaking its reason", async () => {
    const controller = new AbortController();
    const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      controller.abort(new Error(apiKey));
    }));
    await expect(classifyMarketingChannelObservation(input, { apiKey, fetch: request, signal: controller.signal })).rejects.toThrow(/^Jev Gateway request cancelled$/);
  });

  it("sets a 15-second deadline and reports a timeout without retrying", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error(apiKey)), { once: true });
      deadline.abort();
    }));
    await expect(classifyMarketingChannelObservation(input, { apiKey, fetch: request })).rejects.toThrow(/^Jev Gateway request timed out$/);
    expect(timeout).toHaveBeenCalledWith(15000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps the same deadline while reading the response body", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const response = Response.json(receipt());
    vi.spyOn(response, "json").mockImplementation(async () => {
      deadline.abort();
      throw new Error(`${apiKey}: ${input.observation}`);
    });
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(classifyMarketingChannelObservation(input, { apiKey, fetch: request })).rejects.toThrow(/^Jev Gateway request timed out$/);
  });
});
