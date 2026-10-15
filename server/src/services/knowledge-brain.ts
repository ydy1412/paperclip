import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { connectionGrants, toolConnections, toolCatalogEntries, type Db } from "@paperclipai/db";
import { badRequest, forbidden, HttpError, notFound, unprocessable } from "../errors.js";
import { toolAccessService } from "./tool-access.js";
import { resolveConnectionGrantSecret } from "./connection-credentials.js";
import { guardedRemoteHttpFetch } from "./remote-http-fetch.js";
import { parseRemoteHttpEndpoint } from "./remote-http-endpoint-guard.js";
import { mcpHttpRequestHeaders, readMcpHttpResponse, getMcpHttpSession } from "./mcp-http.js";

export const BRAIN_READ_TOOLS = new Set(["knowledge_library", "knowledge_document", "knowledge_graph", "knowledge_graph_detail", "knowledge_file", "knowledge_status", "memory_recall", "memory_reflect", "knowledge_tree", "knowledge_trash"]);
export const BRAIN_WRITE_TOOLS = new Set(["knowledge_create_folder", "knowledge_create_document", "knowledge_save_document", "knowledge_move", "knowledge_trash_item", "knowledge_restore", "knowledge_upload"]);
export function assertBrainWriteEntry(entry: Pick<CatalogEntry, "status" | "isReadOnly" | "isWrite" | "isDestructive"> | undefined) {
  if (!entry || entry.status !== "active" || entry.isReadOnly || (!entry.isWrite && !entry.isDestructive)) throw forbidden("쓰기 권한이 있는 Personal Brain 연결이 필요합니다. Apps에서 연결을 확인해 주세요.");
}
const brainErrors: Record<string, string> = {
  source_changed: "다른 곳에서 수정되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.",
  name_conflict: "같은 이름이 있습니다. 다른 이름이나 위치를 선택해 주세요.",
  restore_parent_required: "원래 폴더가 없습니다. 복원할 폴더를 선택해 주세요.",
  write_path_forbidden: "이 위치는 수정할 수 없습니다.",
  operation_needs_recovery: "이전 작업의 결과를 확인하고 있습니다. 새로고침 후 다시 시도해 주세요.",
  invalid_explorer_arguments: "입력한 이름·위치·파일을 확인해 주세요.",
  body_too_large: "문서 내용이 너무 큽니다. 문서를 나눠 저장해 주세요.",
  unsupported_file_type: "PDF, 이미지 또는 엑셀 파일을 선택해 주세요.",
};
type Connection = typeof toolConnections.$inferSelect;
type Grant = typeof connectionGrants.$inferSelect;
type CatalogEntry = typeof toolCatalogEntries.$inferSelect;
export function assertBrainReadEntry(entry: Pick<CatalogEntry, "status" | "isReadOnly" | "isWrite" | "isDestructive"> | undefined) {
  if (!entry || entry.status !== "active" || !entry.isReadOnly || entry.isWrite || entry.isDestructive) {
    throw notFound("이 지식 조회 도구는 사용할 수 없습니다. Apps 연결을 확인해 주세요.");
  }
}
export function isPersonalBrainConnection(connection: Pick<Connection, "config" | "transportConfig">) {
  return connection.config.knowledgeProvider === "personal-brain" || connection.transportConfig.knowledgeProvider === "personal-brain";
}
export function assertPersonalBrainGrant(connection: Connection | undefined, grant: Grant | undefined, companyId: string, userId: string) {
  if (!connection || !grant || !isPersonalBrainConnection(connection) || connection.companyId !== companyId
    || !connection.enabled || connection.status !== "active" || connection.transport !== "mcp_remote"
    || grant.companyId !== companyId || grant.connectionId !== connection.id || grant.kind !== "user"
    || grant.subjectUserId !== userId || grant.status !== "active") throw notFound("Personal Brain 연결을 찾을 수 없습니다. 본인 계정으로 다시 연결해 주세요.");
}
export function decodeBrainFile(value: unknown) {
  const file = value as { base64?: string; contentType?: string; filename?: string; byteSize?: number; sha256?: string };
  if (typeof file?.base64 !== "string" || typeof file.contentType !== "string" || typeof file.filename !== "string"
    || !Number.isSafeInteger(file.byteSize) || file.byteSize! <= 0 || file.byteSize! > 25 * 1024 * 1024
    || file.base64.length > 36 * 1024 * 1024) throw new HttpError(502, "원본 파일 응답을 확인할 수 없습니다.");
  const bytes = Buffer.from(file.base64, "base64");
  if (bytes.length !== file.byteSize || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new HttpError(502, "원본 파일 검증에 실패했습니다.");
  const inline = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(file.contentType);
  return { bytes, contentType: inline ? file.contentType : "application/octet-stream", filename: file.filename, inline };
}

export function knowledgeBrainService(db: Db, options: {
  request?: (url: URL, init: RequestInit) => Promise<Response>;
  credentials?: (connection: Connection, grant: Grant, userId: string) => Promise<Record<string, string>>;
} = {}) {
  const connections = toolAccessService(db);
  async function owned(companyId: string, connectionId: string, userId: string, tool = "knowledge_library") {
    if (!userId) throw forbidden("개인 보관함은 본인 계정으로 로그인한 뒤 사용할 수 있습니다.");
    const [connection] = await db.select().from(toolConnections).where(and(eq(toolConnections.companyId, companyId), eq(toolConnections.id, connectionId)));
    const [catalog] = await db.select().from(toolCatalogEntries).where(and(eq(toolCatalogEntries.companyId, companyId),
      eq(toolCatalogEntries.connectionId, connectionId), eq(toolCatalogEntries.toolName, tool))).limit(1);
    if (BRAIN_WRITE_TOOLS.has(tool)) assertBrainWriteEntry(catalog); else assertBrainReadEntry(catalog);
    if (connection && !isPersonalBrainConnection(connection)) connection.config = { ...connection.config, knowledgeProvider: "personal-brain" };
    const [grant] = await db.select().from(connectionGrants).where(and(eq(connectionGrants.companyId, companyId),
      eq(connectionGrants.connectionId, connectionId), eq(connectionGrants.kind, "user"), eq(connectionGrants.subjectUserId, userId), eq(connectionGrants.status, "active")));
    assertPersonalBrainGrant(connection, grant, companyId, userId);
    return { connection, grant };
  }
  async function headers(connection: Connection, grant: Grant, userId: string) {
    if (options.credentials) return options.credentials(connection, grant, userId);
    let current: Pick<Grant, "id" | "companyId" | "connectionId" | "kind" | "subjectUserId" | "credentialSecretRefs"> = grant;
    if (connection.authKind === "oauth") current = await connections.refreshOAuthGrantCredentials({ companyId: connection.companyId,
      connectionId: connection.id, grantId: grant.id, actor: { actorType: "user", actorId: userId } });
    const ref = current.credentialSecretRefs.find(r => r.configPath === "oauth.access_token" || /authorization|api_key|token/i.test(r.configPath));
    if (!ref) throw unprocessable("Personal Brain의 개인 인증 정보를 다시 연결해 주세요.");
    const { value } = await resolveConnectionGrantSecret(db, connection, current, ref, { actorType: "user", actorId: userId, consumerType: "tool_connection", consumerId: connection.id });
    return { Authorization: /^Bearer\s/i.test(value) ? value : `Bearer ${value}` };
  }
  return {
    async list(companyId: string, userId: string) {
      if (!userId) return [];
      const rows = await db.select({ connection: toolConnections, grant: connectionGrants }).from(toolConnections)
        .innerJoin(connectionGrants, and(eq(connectionGrants.connectionId, toolConnections.id), eq(connectionGrants.companyId, toolConnections.companyId)))
        .where(and(eq(toolConnections.companyId, companyId), eq(connectionGrants.subjectUserId, userId), eq(connectionGrants.kind, "user"), eq(connectionGrants.status, "active")));
      const visible = [];
      for (const row of rows) {
        try {
          await owned(companyId, row.connection.id, userId);
          const actions = await db.select().from(toolCatalogEntries).where(and(eq(toolCatalogEntries.companyId, companyId), eq(toolCatalogEntries.connectionId, row.connection.id)));
          visible.push({ id: row.connection.id, name: row.connection.name, kind: "personal-brain" as const,
            actions: actions.filter(a => BRAIN_WRITE_TOOLS.has(a.toolName) && a.status === "active" && (a.isWrite || a.isDestructive) && !a.isReadOnly).map(a => a.toolName),
            ownerId: userId });
        } catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
      }
      return visible;
    },
    async call(companyId: string, connectionId: string, userId: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal, mutation = false) {
      if (!(mutation ? BRAIN_WRITE_TOOLS : BRAIN_READ_TOOLS).has(tool)) throw forbidden("허용되지 않은 지식 조회입니다.");
      const { connection, grant } = await owned(companyId, connectionId, userId, tool);
      const config = { ...connection.config, ...connection.transportConfig };
      const url = parseRemoteHttpEndpoint(config.url ?? config.endpoint ?? config.remoteUrl, (message, code) => badRequest(message, { code }));
      const timeoutMs = tool === "memory_reflect" ? 310_000 : 60_000;
      const effectiveSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const credentials = await headers(connection, grant, userId);
      const send = (init: RequestInit) => options.request ? options.request(url, init)
        : guardedRemoteHttpFetch(url, init, { allowPrivateNetwork: false, responseTimeoutMs: timeoutMs, error: (message, code) => badRequest(message, { code }) });
      const requestId = randomUUID();
      try {
        const protocolHeaders = await getMcpHttpSession({ scope: `${connectionId}:${grant.id}`, headers: credentials, requestId,
          send: init => send({ ...init, signal: effectiveSignal }) });
        const response = await send({ method: "POST", redirect: "manual", signal: effectiveSignal,
          headers: { ...mcpHttpRequestHeaders(protocolHeaders), ...(tool === "knowledge_upload" ? { "X-Knowledge-Upload": "1" } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: requestId,
            method: "tools/call", params: { name: tool, arguments: args } }) });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({})) as { error?: string };
          throw new HttpError([400, 401, 403, 404, 409, 413, 415].includes(response.status) ? response.status : 502,
            brainErrors[failure.error ?? ""] ?? (response.status === 401 || response.status === 403 ? "Personal Brain 인증을 확인해 주세요." : "Personal Brain 요청에 실패했습니다."));
        }
        const result = await readMcpHttpResponse(response, requestId, { maxBytes: tool === "knowledge_file" ? 72 * 1024 * 1024 : 8 * 1024 * 1024 }) as {
          error?: unknown; result?: { isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] } };
        if (result.error || !result.result) throw new HttpError(502, "Personal Brain이 요청을 완료하지 못했습니다.");
        if (result.result.isError) {
          let failure: { error?: string; status?: number } = {};
          try { failure = JSON.parse(result.result.content?.[0]?.text ?? "{}"); } catch { /* Generic error below. */ }
          throw new HttpError([400, 401, 403, 404, 409, 413, 415].includes(failure.status ?? 0) ? failure.status! : 502,
            brainErrors[failure.error ?? ""] ?? "Personal Brain이 요청을 완료하지 못했습니다.");
        }
        const data = result.result.structuredContent ?? JSON.parse(result.result.content?.[0]?.text ?? "null");
        await owned(companyId, connectionId, userId, tool); // Revocation during a long reflection also revokes its response.
        return data;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(effectiveSignal.aborted ? 504 : 502,
          effectiveSignal.aborted ? "지식 처리 응답이 늦어지고 있습니다. 다시 시도해 주세요." : "Personal Brain에 연결할 수 없습니다.");
      }
    },
  };
}
