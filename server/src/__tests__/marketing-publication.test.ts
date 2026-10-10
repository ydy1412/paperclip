import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createMarketingProfileSchema, marketingContentSchema, queueMarketingDraftsSchema } from "@paperclipai/shared";
import { assertMarketingDraftEditable, assertMarketingJobRetryable, marketingDigest, marketingGenerationPrompt, validateMarketingAccount, validateMarketingPostedUrl, verifyMarketingMediaBytes } from "../services/marketing-publication.js";

const account = { platform: "naver_blog" as const, accountId: "my_blog", accountUrl: "https://blog.naver.com/my_blog" };
describe("marketing publication boundaries", () => {
  const bytes = Buffer.from("original attachment");
  const expected = { byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  it("verifies exact streamed attachment bytes without buffering the entire file", async () => {
    const stream = Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]);
    await expect(verifyMarketingMediaBytes(stream, expected)).resolves.toBeUndefined();
    expect(stream.destroyed).toBe(true);
  });
  it.each([Buffer.from("replaced attachment"), bytes.subarray(0, 5), Buffer.concat([bytes, Buffer.from("extra")])])("rejects changed, truncated or oversized files: %j", async value => {
    const stream = Readable.from([value]);
    await expect(verifyMarketingMediaBytes(stream, expected)).rejects.toThrow();
    expect(stream.destroyed).toBe(true);
  });
  it("fails closed on a storage read error and closes the stream", async () => {
    const stream = new Readable({ read() { this.destroy(new Error("Storage unavailable")); } });
    await expect(verifyMarketingMediaBytes(stream, expected)).rejects.toThrow("Storage unavailable");
    expect(stream.destroyed).toBe(true);
  });
  it("closes a stalled attachment read after the bounded timeout", async () => {
    vi.useFakeTimers();
    const stream = new Readable({ read() {} });
    try {
      const assertion = expect(verifyMarketingMediaBytes(stream, expected)).rejects.toThrow("Attachment read timeout");
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;
      expect(stream.destroyed).toBe(true);
    } finally { stream.destroy(); vi.useRealTimers(); }
  });
  it("requires an explicit Aside account and disallows credential fields", () => {
    const profile = { projectId: "00000000-0000-4000-8000-000000000001", name: "Work", asideAccountId: "u1", browserProfileName: "Profile 1" };
    expect(createMarketingProfileSchema.parse(profile)).toEqual(profile);
    expect(createMarketingProfileSchema.safeParse({ ...profile, asideAccountId: "default" }).success).toBe(false);
    expect(createMarketingProfileSchema.safeParse({ ...profile, password: "secret" }).success).toBe(false);
  });
  it("binds the Naver channel URL to its exact account", () => {
    expect(validateMarketingAccount(account)).toBe(account.accountUrl);
    expect(() => validateMarketingAccount({ ...account, accountUrl: "https://blog.naver.com/another" })).toThrow("계정 ID");
    expect(() => validateMarketingAccount({ ...account, accountUrl: "https://blog.naver.com/my_blog?redirect=anything" })).toThrow();
    expect(() => validateMarketingAccount({ ...account, accountUrl: "https://blog.naver.com/%E0%A4%A" })).toThrow("경로");
  });
  it.each(["http://blog.naver.com/my_blog", "https://blog.naver.com.evil.test/my_blog", "https://x:secret@blog.naver.com/my_blog", "https://localhost/my_blog", "https://blog.naver.com:444/my_blog"])("rejects unsafe account URL %s", url => {
    expect(() => validateMarketingAccount({ ...account, accountUrl: url })).toThrow();
  });
  it("accepts actual Naver permalinks, not profile/editor/other-owner links", () => {
    expect(validateMarketingPostedUrl(account, "https://blog.naver.com/my_blog/223456789012")).toContain("223456789012");
    expect(validateMarketingPostedUrl(account, "https://m.blog.naver.com/PostView.naver?blogId=my_blog&logNo=223456789012")).toContain("logNo=");
    for (const url of [account.accountUrl, "https://blog.naver.com/another/123", "https://blog.naver.com/my_blog/edit", "https://evil.test/my_blog/123"]) expect(() => validateMarketingPostedUrl(account, url)).toThrow();
  });
  it("keeps media ordering and every content byte in the approval digest", () => {
    const one = { title: "A", body: "본문", media: [{ attachmentId: "one", alt: "A" }, { attachmentId: "two", alt: "B" }] };
    expect(marketingDigest(one)).toBe(marketingDigest({ media: one.media, body: one.body, title: one.title }));
    expect(marketingDigest(one)).not.toBe(marketingDigest({ ...one, body: "본문 " }));
    expect(marketingDigest(one)).not.toBe(marketingDigest({ ...one, media: [...one.media].reverse() }));
  });
  it("allows editable queued content but forbids replacing in-flight or uncertain content", () => {
    expect(() => assertMarketingDraftEditable(["queued", "cancelled", "published"])).not.toThrow();
    expect(() => assertMarketingDraftEditable(["publishing"])).toThrow();
    expect(() => assertMarketingDraftEditable(["uncertain"])).toThrow();
  });
  it("never retries an unknown or successful result", () => {
    expect(() => assertMarketingJobRetryable("failed", true)).not.toThrow();
    expect(() => assertMarketingJobRetryable("auth_required", true)).not.toThrow();
    for (const status of ["queued", "publishing", "published", "uncertain", "cancelled"] as const) expect(() => assertMarketingJobRetryable(status, true)).toThrow();
    expect(() => assertMarketingJobRetryable("failed", false)).toThrow();
  });
  it("rejects empty content, raw paths and duplicate batch selection", () => {
    expect(marketingContentSchema.safeParse({ body: "  " }).success).toBe(false);
    expect(marketingContentSchema.safeParse({ body: "text", media: [{ path: "/etc/passwd" }] }).success).toBe(false);
    const row = { id: "00000000-0000-4000-8000-000000000001", revision: 1 };
    expect(queueMarketingDraftsSchema.safeParse({ drafts: [row, row] }).success).toBe(false);
  });
  it("generates a different editorial input per channel without posting authority", () => {
    const channel = { ...account, concept: "개발 기록", audience: "개발자", tone: "차분함", writingRules: "근거 링크 포함" };
    const prompt = marketingGenerationPrompt({ topic: "배포", channel });
    expect(prompt).toContain("Do not browse, log in, publish, approve");
    expect(prompt).toContain("개발 기록");
    expect(prompt).not.toBe(marketingGenerationPrompt({ topic: "배포", channel: { ...channel, concept: "제품 소개" } }));
  });
});
