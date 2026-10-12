// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import { submitNextForwarderLogin, supportsForwarderLogin } from "../services/sourcing-forwarder-browser.js";

const loginUrl = "https://www.next1688.com/Front/Join/Login.asp?gMnu1=207&gMnu2=20702";
function pageFixture(url = loginUrl) {
  let idValue = "", passwordValue = "";
  const id = { count: vi.fn().mockResolvedValue(1), fill: vi.fn(async (value: string) => { idValue = value; }),
    isVisible: vi.fn().mockResolvedValue(true), inputValue: vi.fn(async () => idValue) };
  const password = { ...id, count: vi.fn().mockResolvedValue(1), fill: vi.fn(async (value: string) => { passwordValue = value; }),
    inputValue: vi.fn(async () => passwordValue), waitFor: vi.fn().mockResolvedValue(undefined) };
  const submit = { count: vi.fn().mockResolvedValue(1), click: vi.fn().mockResolvedValue(undefined), isVisible: vi.fn().mockResolvedValue(true) };
  const urlFn = vi.fn().mockReturnValue(url);
  const page = { url: urlFn, locator: vi.fn((selector: string) => selector.startsWith("#sMemId") ? id : selector.startsWith("#sMemPw") ? password : submit) };
  return { page: page as unknown as Page, id, password, submit, urlFn };
}
describe("Next Shipping verified login form", () => {
  it("works with native DOM selectors instead of Playwright-only selector syntax", async () => {
    document.body.innerHTML = '<form><input id="sMemId"><input id="sMemPw" type="password"><a onclick="fnLoginM();">로그인</a></form>';
    let submitted = false;
    const page = { url: () => loginUrl, locator: (selector: string) => ({
      count: async () => document.querySelectorAll(selector).length,
      waitFor: async () => { expect(document.querySelector(selector)).not.toBeNull(); },
      isVisible: async () => !!document.querySelector(selector),
      inputValue: async () => (document.querySelector(selector) as HTMLInputElement).value,
      fill: async (value: string) => { (document.querySelector(selector) as HTMLInputElement).value = value; },
      click: async () => { expect(document.querySelector(selector)?.textContent).toBe("로그인"); submitted = true; },
    }) } as unknown as Page;
    await submitNextForwarderLogin(page, loginUrl, { loginId: "fixture-user", password: "fixture-password" });
    expect((document.querySelector("#sMemId") as HTMLInputElement).value).toBe("fixture-user");
    expect((document.querySelector("#sMemPw") as HTMLInputElement).value).toBe("fixture-password");
    expect(submitted).toBe(true); document.body.innerHTML = "";
  });
  it("fills the verified visible fields and clicks once", async () => {
    const f = pageFixture(); await submitNextForwarderLogin(f.page, loginUrl, { loginId: "synthetic-id", password: "synthetic-password" });
    expect(f.id.fill).toHaveBeenCalledWith("synthetic-id", expect.any(Object)); expect(f.password.fill).toHaveBeenCalledWith("synthetic-password", expect.any(Object)); expect(f.submit.click).toHaveBeenCalledTimes(1);
  });
  it.each(["https://next1688.com/Front/Join/Login.asp", "https://www.next1688.com.evil.example/Front/Join/Login.asp", "http://www.next1688.com/Front/Join/Login.asp", "https://www.next1688.com/other"])("does not claim unverified provider URL %s", url => { expect(supportsForwarderLogin(url)).toBe(false); });
  it("does not fill redirected sites", async () => {
    const f = pageFixture("https://example.com/login"); await expect(submitNextForwarderLogin(f.page, loginUrl, { loginId: "x", password: "y" })).rejects.toThrow("사이트"); expect(f.id.fill).not.toHaveBeenCalled(); expect(f.password.fill).not.toHaveBeenCalled();
  });
  it("checks origin again after form inspection", async () => {
    const f = pageFixture(); f.urlFn.mockReturnValueOnce(loginUrl).mockReturnValue("https://example.com/login");
    await expect(submitNextForwarderLogin(f.page, loginUrl, { loginId: "x", password: "y" })).rejects.toThrow("사이트"); expect(f.id.fill).not.toHaveBeenCalled();
  });
  it("stops password input if filling the ID redirects the page", async () => {
    const f = pageFixture(); f.urlFn.mockReturnValueOnce(loginUrl).mockReturnValueOnce(loginUrl).mockReturnValue("https://example.com/login");
    await expect(submitNextForwarderLogin(f.page, loginUrl, { loginId: "x", password: "y" })).rejects.toThrow("사이트");
    expect(f.id.fill).toHaveBeenCalledTimes(1); expect(f.password.fill).not.toHaveBeenCalled(); expect(f.submit.click).not.toHaveBeenCalled();
  });
  it("stops before credentials when the provider changes its login controls", async () => {
    const f = pageFixture(); f.submit.count.mockResolvedValue(0); await expect(submitNextForwarderLogin(f.page, loginUrl, { loginId: "x", password: "y" })).rejects.toThrow("버튼"); expect(f.password.fill).not.toHaveBeenCalled();
  });
  it("does not submit when the input did not retain the selected credentials", async () => {
    const f = pageFixture(); f.password.inputValue.mockResolvedValue("different-synthetic-value");
    await expect(submitNextForwarderLogin(f.page, loginUrl, { loginId: "fixture", password: "selected-password" })).rejects.toThrow("입력");
    expect(f.submit.click).not.toHaveBeenCalled();
  });
});
