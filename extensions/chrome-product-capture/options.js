import { parseConnection } from "./connection.js";
const field = document.querySelector("#connection"), status = document.querySelector("#status");
await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const { connection } = await chrome.storage.local.get("connection");
if (connection) status.textContent = `${connection.projectName} · ${connection.serverUrl} 연결됨`;
document.querySelector("form").onsubmit = async event => {
  event.preventDefault();
  try {
    const value = parseConnection(field.value);
    const server = new URL(value.serverUrl);
    const granted = await chrome.permissions.request({ origins: [`${server.protocol}//${server.hostname}/*`] });
    if (!granted) throw new Error("선택한 서버에 전송할 권한이 필요합니다.");
    await chrome.storage.local.set({ connection: value }); await chrome.storage.local.remove("pending");
    field.value = ""; status.textContent = `${value.projectName}에 연결했습니다. 상품 상세 페이지에서 확장 버튼을 누르세요.`;
  } catch (error) { status.textContent = error.message || "연결 정보를 확인해 주세요."; }
};
document.querySelector("#disconnect").onclick = async () => { await chrome.storage.local.remove(["connection", "pending"]); field.value = ""; status.textContent = "이 브라우저의 연결을 해제했습니다. Dovix 설정에서 연결키도 해제할 수 있습니다."; };
