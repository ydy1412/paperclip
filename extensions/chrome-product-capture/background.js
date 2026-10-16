import { collectCurrentProduct } from "./collector.js";
import { parseConnection, sendSnapshot } from "./connection.js";
let running;
const trustStorage = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
async function capture(retry) {
  await trustStorage;
  const state = await chrome.storage.local.get(["connection", "pending"]);
  if (!state.connection) return { setupRequired: true };
  const connection = parseConnection(state.connection);
  let pending = state.pending;
  if (!retry) {
    if (pending?.connectionId === connection.connectionId) return { retryRequired: true, title: pending.request.snapshot.title };
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("현재 상품 탭을 확인해 주세요.");
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: collectCurrentProduct });
    if (!result) throw new Error("상품을 읽지 못했습니다.");
    pending = { connectionId: connection.connectionId, request: { requestId: crypto.randomUUID(), snapshot: result } };
    await chrome.storage.local.set({ pending });
  }
  if (!pending || pending.connectionId !== connection.connectionId) throw new Error("재시도할 상품이 없습니다.");
  const result = await sendSnapshot(connection, pending);
  await chrome.storage.local.remove("pending");
  return result;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  if (!["capture", "retry", "discard"].includes(message?.type)) return false;
  if (!running) running = (message.type === "discard" ? chrome.storage.local.remove("pending").then(() => ({ discarded: true })) : capture(message.type === "retry")).finally(() => { running = undefined; });
  running.then(respond, error => respond({ error: error.message || "전송하지 못했습니다." }));
  return true;
});
