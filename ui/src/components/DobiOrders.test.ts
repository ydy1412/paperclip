// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { mountDobiOrders } from "@paperclipai/dobi-orders/frontend";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren();
  for (const method of ["showModal", "close"]) Reflect.deleteProperty(HTMLDialogElement.prototype, method);
});

it("keeps Wing MFA steps open and cancels only when the user closes the dialog", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = false; queueMicrotask(() => this.dispatchEvent(new Event("close")));
  } });
  const calls: string[] = [];
  const connection = { id: "synthetic-id", providerId: "coupang", kind: "market", channel: "쿠팡", name: "합성 계정", mode: "wing", sellerId: "synthetic-wing", hasPassword: true, hasCredentials: true };
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit = {}) => {
    const path = url.replace("/scoped", ""); let data: unknown = [];
    if (path === "/bootstrap") data = { statuses: [], workStates: [], claims: [], channels: [], accounts: [], accountBusinesses: [], settings: { title: "합성 주문" } };
    else if (path === "/stats") data = { total: 0, activeClaims: 0 };
    else if (path.startsWith("/orders")) data = { orders: [], total: 0 };
    else if (path === "/connections") data = [connection];
    else if (path === "/integrations/catalog") data = { providers: [{ id: "coupang", name: "쿠팡", kind: "market", wingLogin: true }], counts: {} };
    else if (path.endsWith("/wing-login")) {
      if (options.method === "POST") {
        const step = JSON.parse(String(options.body)).step; calls.push(step);
        data = step === "start" ? { pending: true, stage: "method", methods: [{ id: "mobile", label: "휴대폰 인증" }] }
          : step === "method" ? { pending: true, stage: "code" } : { ok: true, cancelled: true };
      } else data = { pending: false };
    }
    return { ok: true, json: async () => data };
  }));
  const host = document.createElement("div"); document.body.append(host); const root = host.attachShadow({ mode: "open" });
  dispose = mountDobiOrders(root, { basePath: "/scoped", styles: "", initialView: "connections", settingsOnly: true });
  await vi.waitFor(() => expect(root.querySelector('[data-integration-action="wingLoginDialog"]')).not.toBeNull());
  (root.querySelector('[data-integration-action="wingLoginDialog"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(root.querySelector('[data-integrations="wingLogin"][data-step="start"]')).not.toBeNull());
  const submit = () => root.querySelector('[data-integrations="wingLogin"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  submit(); await vi.waitFor(() => expect(root.querySelector('[data-step="method"]')).not.toBeNull());
  submit(); await vi.waitFor(() => expect(root.querySelector('[data-step="code"]')).not.toBeNull());
  expect(calls).toEqual(["start", "method"]);
  root.querySelector("dialog")!.close();
  await vi.waitFor(() => expect(calls).toEqual(["start", "method", "cancel"]));
});
