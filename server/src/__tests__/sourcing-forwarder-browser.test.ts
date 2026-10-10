import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import { submitNextForwarderLogin, supportsForwarderLogin } from "../services/sourcing-forwarder-browser.js";

const loginUrl = "https://www.next1688.com/Front/Join/Login.asp?gMnu1=207&gMnu2=20702";
function pageFixture(url = loginUrl) {
  const id = { count: vi.fn().mockResolvedValue(1), fill: vi.fn().mockResolvedValue(undefined) };
  const password = { ...id, count: vi.fn().mockResolvedValue(1), fill: vi.fn().mockResolvedValue(undefined), waitFor: vi.fn().mockResolvedValue(undefined) };
  const submit = { count: vi.fn().mockResolvedValue(1), click: vi.fn().mockResolvedValue(undefined) };
  const urlFn = vi.fn().mockReturnValue(url);
  const page = { url: urlFn, locator: vi.fn((selector: string) => selector.startsWith("#sMemId") ? id : selector.startsWith("#sMemPw") ? password : submit) };
  return { page: page as unknown as Page, id, password, submit, urlFn };
}
describe("Next Shipping verified login form", () => {
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
});
