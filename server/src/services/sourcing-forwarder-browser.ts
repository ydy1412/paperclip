import { createHash } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright-core";
import type { SourcingForwarderOpenResult } from "@paperclipai/shared";
import { badRequest, conflict, unprocessable } from "../errors.js";

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
}
export type ForwarderBrowserOpen = (input: ForwarderBrowserInput) => Promise<SourcingForwarderOpenResult>;

// Exported separately so origin/field failures can be tested without launching a browser.
export async function submitNextForwarderLogin(page: Page, loginUrl: string, credentials: ForwarderBrowserInput["credentials"]) {
  if (!supportsForwarderLogin(loginUrl) || new URL(page.url()).origin !== nextOrigin) {
    throw badRequest("로그인 화면의 사이트가 달라 계정 입력을 중단했습니다.");
  }
  const loginId = page.locator("#sMemId:visible");
  const password = page.locator("#sMemPw:visible");
  await password.waitFor({ state: "visible", timeout: 10000 });
  if (await loginId.count() !== 1 || await password.count() !== 1) throw unprocessable("로그인 입력 화면이 변경됐습니다. Chrome에서 확인해 주세요.");
  const submit = page.locator('form:has(#sMemPw) a[onclick="fnLoginM();"]:visible');
  if (await submit.count() !== 1) throw unprocessable("로그인 버튼을 확인할 수 없습니다.");
  // A redirect must never receive stored credentials, even after the inputs appeared.
  if (new URL(page.url()).origin !== nextOrigin) throw badRequest("로그인 화면의 사이트가 변경됐습니다.");
  await loginId.fill(credentials.loginId, { timeout: 5000 });
  if (new URL(page.url()).origin !== nextOrigin) throw badRequest("로그인 화면의 사이트가 변경됐습니다.");
  await password.fill(credentials.password, { timeout: 5000 });
  if (new URL(page.url()).origin !== nextOrigin) throw badRequest("로그인 화면의 사이트가 변경됐습니다.");
  await submit.click({ timeout: 10000 });
}

export function sourcingForwarderBrowser() {
  const sessions = new Map<string, { browser: Browser; page: Page; binding: string }>();
  const opening = new Set<string>();
  let stopped = false;
  const open: ForwarderBrowserOpen = async input => {
    if (stopped) throw conflict("Dovix가 종료 중입니다.");
    const key = `${input.companyId}:${input.id}`;
    if (opening.has(key)) throw conflict("배송대행지 브라우저를 여는 중입니다.");
    opening.add(key);
    let browser: Browser | undefined;
    try {
      const previous = sessions.get(key);
      const binding = createHash("sha256").update(JSON.stringify([input.loginUrl, input.credentials])).digest("hex");
      if (previous && previous.binding === binding && previous.browser.isConnected() && !previous.page.isClosed()) {
        await previous.page.bringToFront();
        return { status: "page_opened", browser: "chrome" };
      }
      if (previous) { await previous.browser.close(); sessions.delete(key); }
      if (sessions.size + opening.size > 4) throw conflict("열린 배송대행지 창을 닫고 다시 시도해 주세요.");
      // Installed Chrome, visible separate window, temporary isolated profile; no personal profile.
      browser = await chromium.launch({ channel: "chrome", headless: false, chromiumSandbox: true, timeout: 15000 });
      const context = await browser.newContext({ acceptDownloads: false });
      const page = await context.newPage();
      if (stopped) { await browser.close(); throw conflict("Dovix가 종료 중입니다."); }
      sessions.set(key, { browser, page, binding });
      browser.on("disconnected", () => { if (sessions.get(key)?.browser === browser) sessions.delete(key); });
      page.on("close", () => { void browser?.close().catch(() => undefined); });
      await page.goto(input.loginUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (!supportsForwarderLogin(input.loginUrl)) return { status: "page_opened", browser: "chrome" };
      await submitNextForwarderLogin(page, input.loginUrl, input.credentials);
      return { status: "login_submitted", browser: "chrome" };
    } catch (error) {
      // Never expose browser errors: fill/click diagnostics can include credential values.
      if (browser) await browser.close().catch(() => undefined);
      sessions.delete(key);
      if (error && typeof error === "object" && "status" in error && error.status === 409) throw error;
      throw unprocessable("Chrome에서 로그인 화면을 열지 못했습니다. Chrome 설치 및 배송대행지 주소를 확인해 주세요.");
    } finally { opening.delete(key); }
  };
  return { open, close: async () => { stopped = true; await Promise.allSettled([...sessions.values()].map(session => session.browser.close())); sessions.clear(); } };
}
