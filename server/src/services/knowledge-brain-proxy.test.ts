import { describe, expect, it, vi } from "vitest";
import { connectionGrants, toolCatalogEntries, toolConnections } from "@paperclipai/db";
import { knowledgeBrainService } from "./knowledge-brain.js";

vi.mock("./mcp-http.js", async importOriginal => ({
  ...await importOriginal<typeof import("./mcp-http.js")>(), getMcpHttpSession: async () => ({}),
}));
function fixture() {
  const connection = { id: "connection", companyId: "company", enabled: true, status: "active", transport: "mcp_remote", config: { knowledgeProvider: "personal-brain", url: "https://brain.example/api/mcp" }, transportConfig: {} };
  const grant = { id: "grant", companyId: "company", connectionId: connection.id, kind: "user", subjectUserId: "owner", status: "active" };
  const catalog = { status: "active", isReadOnly: false, isWrite: true, isDestructive: false };
  const db = { select: () => {
    let table: unknown;
    const chain = { from(t: unknown) { table = t; return chain; }, where() { return chain; }, limit() { return chain; },
      then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        const rows = table === toolConnections ? [connection] : table === connectionGrants ? [grant] : table === toolCatalogEntries ? [catalog] : [];
        return Promise.resolve(rows).then(resolve, reject);
      } };
    return chain;
  } };
  const request = vi.fn(async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { id: "document", revision: "saved" } } });
  });
  const service = knowledgeBrainService(db as never, { request, credentials: async () => ({ Authorization: "Bearer fixture-only" }) });
  return { service, request, catalog, grant };
}
describe("Personal Brain management proxy", () => {
  it("keeps the read route closed to every write even with a write-capable grant", async () => {
    const f = fixture(); await expect(f.service.call("company", "connection", "owner", "knowledge_move", {})).rejects.toThrow("허용되지 않은"); expect(f.request).not.toHaveBeenCalled();
  });
  it("does not upgrade a read-only declaration or a revoked/foreign grant", async () => {
    for (const change of ["read", "revoked", "foreign"]) {
      const f = fixture();
      if (change === "read") Object.assign(f.catalog, { isReadOnly: true, isWrite: false });
      if (change === "revoked") f.grant.status = "revoked";
      if (change === "foreign") f.grant.subjectUserId = "other";
      await expect(f.service.call("company", "connection", "owner", "knowledge_move", {}, undefined, true)).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
    }
  });
  it("accepts explicit destructive declarations and checks revocation again after the provider write", async () => {
    const f = fixture(); Object.assign(f.catalog, { isWrite: false, isDestructive: true });
    await expect(f.service.call("company", "connection", "owner", "knowledge_trash_item", {}, undefined, true)).resolves.toEqual({ id: "document", revision: "saved" });
    const response = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(async (url, init) => { const result = await response(url, init); f.grant.status = "revoked"; return result; });
    await expect(f.service.call("company", "connection", "owner", "knowledge_trash_item", {}, undefined, true)).rejects.toThrow("연결을 찾을 수 없습니다");
  });
  it("preserves conflict status and safe Korean errors rather than returning a false success", async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(Response.json({ error: "source_changed" }, { status: 409 }));
    await expect(f.service.call("company", "connection", "owner", "knowledge_save_document", {}, undefined, true)).rejects.toMatchObject({ status: 409 });
  });
  it("marks only upload envelopes for the bounded Worker streaming path", async () => {
    const f = fixture(); await f.service.call("company", "connection", "owner", "knowledge_upload", { base64: "AAAA" }, undefined, true);
    expect(new Headers(f.request.mock.calls[0][1].headers).get("X-Knowledge-Upload")).toBe("1");
    await f.service.call("company", "connection", "owner", "knowledge_move", {}, undefined, true);
    expect(new Headers(f.request.mock.calls[1][1].headers).get("X-Knowledge-Upload")).toBeNull();
  });
});
