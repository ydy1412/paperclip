import { describe, expect, it } from "vitest";
import { parseMarketingNaverAccount } from "../services/marketing-naver-account.js";
describe("Naver marketing account proof", () => {
  it("accepts the exact MyBlog redirect under an explicit Aside profile", () => {
    expect(parseMarketingNaverAccount('Opened tab\nPAPERCLIP_NAVER_ACCOUNT {"url":"https://blog.naver.com/ydy1412"}\n[ok | 12ms]')).toEqual({ signedIn: true, accountId: "ydy1412", accountUrl: "https://blog.naver.com/ydy1412" });
  });
  it.each(["https://nid.naver.com/nidlogin.login", "https://blog.naver.com.evil.test/ydy1412", "https://blog.naver.com/MyBlog.naver", "https://blog.naver.com/ydy1412/123"])("does not infer logged-in identity from %s", url => {
    expect(parseMarketingNaverAccount(`PAPERCLIP_NAVER_ACCOUNT ${JSON.stringify({ url })}`).signedIn).toBe(false);
  });
  it("does not treat CLI exit success or an observation error as account proof", () => {
    expect(() => parseMarketingNaverAccount("[ok | 12ms]")).toThrow();
    expect(() => parseMarketingNaverAccount('PAPERCLIP_NAVER_ACCOUNT {"url":"https://blog.naver.com/ydy1412"}\n[error | 13ms]')).toThrow();
  });
});
