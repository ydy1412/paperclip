export function parseConnection(text) {
  const value = typeof text === "string" ? JSON.parse(text) : text;
  const url = new URL(value.serverUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !(url.protocol === "https:" || url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("HTTPS 서버 주소를 확인해 주세요.");
  if (!/^dvc_[A-Za-z0-9_-]{43}$/.test(value.token) || !/^[a-f0-9-]{36}$/i.test(value.connectionId)) throw new Error("Dovix에서 새 연결 정보를 복사해 주세요.");
  return { serverUrl: url.origin, token: value.token, connectionId: value.connectionId, projectName: String(value.projectName ?? "선택한 프로젝트").slice(0, 200) };
}
export async function sendSnapshot(connection, pending, fetcher = fetch) {
  const body = JSON.stringify(pending.request);
  if (new TextEncoder().encode(body).length > 512 * 1024) throw new Error("상품 정보가 너무 큽니다. 전송하지 않았습니다.");
  const response = await fetcher(`${connection.serverUrl}/api/sourcing-capture`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.token}` }, body, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(({ 400: "상품 정보 형식을 확인해 주세요.", 401: "연결이 만료되었거나 해제됐습니다. 다시 연결해 주세요.", 403: "프로젝트 연결 권한을 확인해 주세요.", 409: "기존 수집 작업을 마친 뒤 다시 보내 주세요.", 429: "잠시 후 다시 보내 주세요." })[response.status] ?? "서버에 연결하지 못했습니다. 재시도할 수 있습니다.");
  const result = await response.json();
  if (!["stored", "already_saved"].includes(result.status) || !Array.isArray(result.missingFields)) throw new Error("서버 응답을 확인하지 못했습니다. 저장 여부를 확인해 주세요.");
  return result;
}
