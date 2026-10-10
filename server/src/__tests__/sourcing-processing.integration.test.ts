import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, pluginConfig } from "@paperclipai/db";
import { createHostClientHandlers, CapabilityDeniedError, type HostServices } from "@paperclipai/plugin-sdk";
import { startProcessingFixture } from "./helpers/sourcing-processing-fixture.js";
import { processingViewSchema } from "../services/auto-sourcing-processing-contract.js";

describe("real worker -> host authority -> local HTTP -> file/SQLite processing", () => {
  let f: Awaited<ReturnType<typeof startProcessingFixture>>;
  beforeAll(async () => { f = await startProcessingFixture(); }, 90000);
  afterAll(async () => { await f?.close(); });
  it("registers actual tools, persists Korean SKU edits through operator action, reloads and blocks stale/unknown fields", async () => {
    const source = await f.tool("get-processing-source", { sourceProvider: "taobao", productId: f.productId });
    expect((source.data as { skus: unknown[] }).skus).toHaveLength(2);
    const created = processingViewSchema.parse((await f.tool("create-processing-draft", { sourceProvider: "taobao", productId: f.productId, skuIds: ["1001", "1002"] })).data);
    const input = { operation: "save", draftId: created.draft.id, expectedRevision: created.draft.revision, name: "책상 10cm", cropPlans: [],
      items: created.draft.items.map((i, n) => ({ sourceSkuId: i.sourceSkuId, name: n ? "파랑 10cm 2개" : "빨강 10cm 2개", representativeImageUrl: i.representativeImageUrl,
        options: [{ ordinal: 0, name: "색상", value: n ? "파랑 10cm 2개" : "빨강 10cm 2개" }] })) };
    const saved = processingViewSchema.parse(await f.action(input));
    expect(saved.draft.revision).toBe(2);
    const reloaded = processingViewSchema.parse(await f.data({ operation: "get", draftId: created.draft.id }));
    expect(reloaded.draft.name).toBe("책상 10cm");
    expect(reloaded.source.skus).toEqual((source.data as { skus: unknown[] }).skus);
    expect(reloaded.reviewReady).toBe(false);
    expect(reloaded.draft.issues.some(i => i.field === "requiredFields")).toBe(true);
    await expect(f.action(input)).rejects.toThrow("publication_conflict");
    await expect(f.action({ ...input, expectedRevision: 2, sourceHash: "forged" })).rejects.toThrow();
    const listed = await f.tool("list-processing-drafts"); expect(listed.data).toHaveLength(1);
    const validation = processingViewSchema.parse((await f.tool("validate-processing-draft", { draftId: created.draft.id, expectedRevision: 2 })).data);
    expect(validation.draft.issues.some(i => i.field === "category")).toBe(true);
  }, 30000);
  it("rejects forged company/project/account, unlisted sources, paused agents and read-only write attempts", async () => {
    const input = { companyId: f.companyId, projectId: f.projectId, accountId: f.accountId, operation: "source" as const, sourceProvider: "taobao", productId: f.productId };
    const context = { invocationScope: { companyId: f.companyId } };
    await expect(f.service.processingRead(input)).rejects.toThrow("회사 범위");
    await expect(f.service.processingRead({ ...input, companyId: "11111111-1111-4111-8111-111111111111" }, context)).rejects.toThrow("회사 범위");
    await expect(f.tool("get-processing-source", { sourceProvider: "taobao", productId: f.productId, projectId: "11111111-1111-4111-8111-111111111111" })).rejects.toThrow();
    await expect(f.tool("get-processing-source", { sourceProvider: "taobao", productId: f.productId, accountId: "foreign" })).rejects.toThrow();
    await expect(f.tool("get-processing-source", { sourceProvider: "taobao", productId: "999" })).rejects.toThrow("허용된 원본");
    const readOnly = createHostClientHandlers({ pluginId: f.plugin.id, capabilities: ["auto-sourcing.products.read"], services: { autoSourcing: f.service } as HostServices });
    await expect(readOnly["autoSourcing.processingWrite"]({ ...input, operation: "create", skuIds: ["1001"] }, context)).rejects.toBeInstanceOf(CapabilityDeniedError);
    await dbPause(true);
    await expect(f.tool("get-processing-source", { sourceProvider: "taobao", productId: f.productId })).rejects.toThrow("에이전트 작업");
    await dbPause(false);
    const list = (await f.tool("list-processing-drafts")).data as { id: string }[];
    await f.db.update(pluginConfig).set({ configJson: { ...f.config, sourceProducts: {} } }).where(eq(pluginConfig.pluginId, f.plugin.id));
    await expect(f.tool("get-processing-draft", { draftId: list[0].id })).rejects.toThrow("범위");
    expect((await f.tool("list-processing-drafts")).data).toEqual([]);
  });
  async function dbPause(paused: boolean) { await f.db.update(agents).set({ status: paused ? "paused" : "idle" }).where(eq(agents.id, f.agent.id)); }
});
