import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { assertBrainReadEntry, assertPersonalBrainGrant, BRAIN_READ_TOOLS, decodeBrainFile } from "./knowledge-brain.js";
const connection = { id: "connection", companyId: "company", enabled: true, status: "active", transport: "mcp_remote", config: { knowledgeProvider: "personal-brain" }, transportConfig: {} };
const grant = { id: "grant", companyId: "company", connectionId: "connection", kind: "user", subjectUserId: "owner", status: "active" };
describe("Personal Brain access boundary", () => {
  it("requires the exact active user grant, company and connection", () => {
    const check = (c: unknown, g: unknown, co = "company", user = "owner") => assertPersonalBrainGrant(c as never, g as never, co, user);
    expect(() => check(connection, grant)).not.toThrow();
    for (const g of [{ ...grant, kind: "organization" }, { ...grant, subjectUserId: "other" }, { ...grant, status: "revoked" }, { ...grant, connectionId: "other" }]) expect(() => check(connection, g)).toThrow();
    expect(() => check(connection, grant, "other")).toThrow();
    expect(() => check({ ...connection, enabled: false }, grant)).toThrow();
  });
  it("only exposes reviewed read calls", () => { for (const name of ["knowledge_retry", "delete_note", "update_note", "upload_attachment"]) expect(BRAIN_READ_TOOLS.has(name)).toBe(false); });
  it("stops reads when a catalog action is removed, quarantined, or changed to a write", () => {
    const entry = { status: "active", isReadOnly: true, isWrite: false, isDestructive: false } as const;
    expect(() => assertBrainReadEntry(entry)).not.toThrow();
    for (const changed of [undefined, { ...entry, status: "disabled" as const }, { ...entry, status: "quarantined" as const },
      { ...entry, isReadOnly: false }, { ...entry, isWrite: true }, { ...entry, isDestructive: true }]) {
      expect(() => assertBrainReadEntry(changed)).toThrow();
    }
  });
  it("verifies original bytes and never renders an HTML attachment inline", () => { const bytes = Buffer.from("original"); const file = { filename: "original.html", contentType: "text/html", base64: bytes.toString("base64"), byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; expect(decodeBrainFile(file).inline).toBe(false); expect(decodeBrainFile(file).bytes).toEqual(bytes); expect(() => decodeBrainFile({ ...file, sha256: "wrong" })).toThrow(); expect(() => decodeBrainFile({ ...file, byteSize: 100 })).toThrow(); });
});
