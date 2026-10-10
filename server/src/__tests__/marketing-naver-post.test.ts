import { describe, expect, it } from "vitest";
import { parseMarketingNaverPost, marketingNaverTextMatches, marketingNaverPublicationTime } from "../services/marketing-naver-post.js";
const account = { platform: "naver_blog" as const, accountId: "my_blog", accountUrl: "https://blog.naver.com/my_blog" };
const post = { url: "https://blog.naver.com/my_blog/223456789012", postId: "223456789012", title: "제목", body: "첫 줄\n둘째 줄", titleCount: 1 as const, bodyCount: 1 as const, imageCount: 0, videoCount: 0, embedCount: 0, publishedAtText: "2026. 10. 6. 16:00" };
const output = (value: unknown) => `PAPERCLIP_NAVER_POST ${JSON.stringify(value)}\n[ok | 10ms]`;
describe("read-only Naver post evidence", () => {
  it("parses only a valid Naver publication time in Korean local time", () => {
    expect(marketingNaverPublicationTime(post.publishedAtText)?.toISOString()).toBe("2026-10-06T07:00:00.000Z");
    expect(marketingNaverPublicationTime("2026. 2. 30. 12:00")).toBeNull();
    expect(marketingNaverPublicationTime("2026. 10. 6. 25:00")).toBeNull();
    expect(marketingNaverPublicationTime("1분 전")).toBeNull();
  });
  it("accepts exactly one owner-scoped article and compares the full text", () => {
    const value = parseMarketingNaverPost(output(post), account, post.postId);
    expect(marketingNaverTextMatches(value, { title: "제목", body: "첫 줄\r\n둘째 줄", media: [] })).toBe(true);
    expect(marketingNaverTextMatches(value, { title: "제목", body: "첫 줄", media: [] })).toBe(false);
    expect(marketingNaverTextMatches(value, { title: "제목", body: "첫 줄\n둘째 줄\n추가", media: [] })).toBe(false);
  });
  it("rejects a different owner, redirected post, absent or ambiguous body", () => {
    expect(() => parseMarketingNaverPost(output({ ...post, url: "https://blog.naver.com/other/223456789012" }), account, post.postId)).toThrow();
    expect(() => parseMarketingNaverPost(output({ ...post, url: "https://blog.naver.com/my_blog/999999999999" }), account, post.postId)).toThrow();
    expect(() => parseMarketingNaverPost(output({ ...post, bodyCount: 0 }), account, post.postId)).toThrow();
    expect(() => parseMarketingNaverPost(output({ ...post, titleCount: 2 }), account, post.postId)).toThrow();
  });
  it("never treats media or embed presence as proven by text alone", () => {
    const content = { title: post.title, body: post.body, media: [] };
    expect(marketingNaverTextMatches({ ...post, imageCount: 1 }, content)).toBe(false);
    expect(marketingNaverTextMatches({ ...post, videoCount: 1 }, content)).toBe(false);
    expect(marketingNaverTextMatches({ ...post, embedCount: 1 }, content)).toBe(false);
    expect(marketingNaverTextMatches(post, { ...content, media: [{ attachmentId: "native" }] })).toBe(false);
  });
  it("rejects missing, duplicate, malformed and CLI-error evidence", () => {
    expect(() => parseMarketingNaverPost("Posted successfully", account, post.postId)).toThrow();
    expect(() => parseMarketingNaverPost(output(post) + output(post), account, post.postId)).toThrow();
    expect(() => parseMarketingNaverPost(output(post) + "\n[error | 1ms]", account, post.postId)).toThrow();
    expect(() => parseMarketingNaverPost("PAPERCLIP_NAVER_POST {bad}", account, post.postId)).toThrow();
  });
});
