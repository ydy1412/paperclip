import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("Marketing draft plugin", () => {
  it("exposes drafting tools only, never approval or publication", () => {
    expect(pluginManifestV1Schema.parse(manifest).tools?.map(tool => tool.name)).toEqual(["get-draft-context", "upload-draft-media", "submit-draft"]);
    expect(manifest.capabilities).not.toContain("approvals.respond");
    expect(manifest.capabilities).not.toContain("http.outbound");
    expect(manifest.tools?.[2].description).toContain("do not stop at chat text");
  });

  it("uses host run company, not a parameter-supplied identity", async () => {
    const harness = createTestHarness({ manifest });
    const get = vi.spyOn(harness.ctx.marketing, "getContext").mockResolvedValue({ issueId: "task", projectId: "project", requiresProjectSelection: false, targets: [], media: [] });
    await plugin.definition.setup(harness.ctx);
    await harness.executeTool("get-draft-context", { companyId: "forged-company", projectId: "project" }, { companyId: "actual-company" });
    expect(get).toHaveBeenCalledExactlyOnceWith({ companyId: "actual-company", projectId: "project" });
  });

  it("reports ambiguous project context and does not submit", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.marketing, "getContext").mockResolvedValue({ issueId: "chat", projectId: null, requiresProjectSelection: true, targets: [], media: [] });
    const submit = vi.spyOn(harness.ctx.marketing, "submitDraft");
    await plugin.definition.setup(harness.ctx);
    expect((await harness.executeTool("get-draft-context", {})).content).toContain("ask if ambiguous");
    expect(submit).not.toHaveBeenCalled();
  });

  it("returns the real uploaded attachment and submitted draft receipt", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.marketing, "uploadMedia").mockResolvedValue({ attachmentId: "native-file", title: "real.png", href: "/api/attachments/native-file/content", byteSize: 10, contentType: "image/png" });
    const submit = vi.spyOn(harness.ctx.marketing, "submitDraft").mockResolvedValue({ id: "draft", projectId: "project", channelId: "channel", revision: 1, state: "draft", href: "/marketing?draft=draft" });
    await plugin.definition.setup(harness.ctx);
    const upload = await harness.executeTool("upload-draft-media", { path: "real.png", contentType: "image/png" });
    expect(upload.data).toMatchObject({ attachmentId: "native-file" });
    const content = { title: "Title", body: "Actual body", media: [{ attachmentId: "native-file", alt: "Description" }] };
    const result = await harness.executeTool("submit-draft", { projectId: "project", channelId: "channel", topic: "Topic", content }, { companyId: "company" });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ companyId: "company", projectId: "project", channelId: "channel", topic: "Topic", content });
    expect(result.data).toMatchObject({ id: "draft", state: "draft" });
    expect(result.content).toContain("Nothing was approved or published");
  });

  it("propagates submission failure instead of claiming registration", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.marketing, "submitDraft").mockRejectedValue(new Error("run stopped"));
    await plugin.definition.setup(harness.ctx);
    await expect(harness.executeTool("submit-draft", {})).rejects.toThrow("run stopped");
  });
});
