import { describe, expect, it } from "vitest";
import { documentProjects, withDocumentProjects, visibleBrainVaults } from "./knowledge-documents";

describe("Knowledge document metadata", () => {
  it("saves explicit project labels without changing the body or other metadata", () => {
    const content = '---\ntitle: Keep this\nproject: Old\n---\n# Original\nExact evidence.';
    const next = withDocumentProjects(content, "Alpha, Beta, Alpha");
    expect(documentProjects(next)).toEqual(["Alpha", "Beta"]);
    expect(next).toContain("title: Keep this\n");
    expect(next.endsWith("# Original\nExact evidence.")).toBe(true);
    expect(next).not.toContain("project: Old");
    expect(documentProjects(withDocumentProjects(next, ""))).toEqual([]);
    expect(() => withDocumentProjects(content, "x".repeat(121))).toThrow();
    expect(withDocumentProjects("# Untagged", "Alpha")).toContain('projects: ["Alpha"]');
  });
  it("preserves CRLF bodies and rejects multiline metadata instead of corrupting it", () => {
    expect(withDocumentProjects("# Original\r\nUnchanged", "Alpha")).toBe('---\r\nprojects: ["Alpha"]\r\n---\r\n# Original\r\nUnchanged');
    expect(() => withDocumentProjects("---\nprojects:\n - Old\n---\nBody", "New")).toThrow();
  });
  it("groups only confirmed identities and preserves explicit read-only links", () => {
    const read = { id: "read", name: "Read", kind: "personal-brain" as const, ownerId: "owner", vaultId: "one", actions: [] };
    const edit = { ...read, id: "edit", actions: ["knowledge_save_document"] };
    expect(visibleBrainVaults([read, edit]).map(v => v.id)).toEqual(["edit"]);
    expect(visibleBrainVaults([read, edit], "read").map(v => v.id)).toEqual(["read"]);
    expect(visibleBrainVaults([read, { ...edit, vaultId: "other" }])).toHaveLength(2);
    expect(visibleBrainVaults([{ ...read, vaultId: null }, { ...edit, vaultId: null }])).toHaveLength(2);
  });
});
