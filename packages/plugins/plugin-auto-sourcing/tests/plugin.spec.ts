import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("Auto Sourcing native plugin", () => {
  it("declares stored-read tools, not marketplace actions or unrestricted network", () => {
    expect(pluginManifestV1Schema.parse(manifest).tools?.map(tool => tool.name)).toEqual(["get-processing-source", "list-processing-drafts", "get-processing-draft", "validate-processing-draft", "create-processing-draft", "save-processing-draft", "list-order-accounts", "list-orders", "get-order"]);
    expect(manifest.capabilities).not.toContain("http.outbound");
    expect(manifest.capabilities).not.toContain("secrets.read-ref");
  });
  it("reads the current account carrier catalog through the existing scoped native data bridge", async () => {
    const harness = createTestHarness({ manifest });
    const request = vi.spyOn(harness.ctx.autoSourcing, "request").mockResolvedValue([]);
    await plugin.definition.setup(harness.ctx);
    await harness.getData("carriers", { companyId: "company", projectId: "project", accountId: "seller" });
    expect(request).toHaveBeenCalledExactlyOnceWith({ companyId: "company", projectId: "project", accountId: "seller", operation: "carriers" });
  });
  it("uses authenticated agent run company, never caller-supplied company", async () => {
    const harness = createTestHarness({ manifest });
    const request = vi.spyOn(harness.ctx.autoSourcing, "request").mockResolvedValue({ orders: [] });
    await plugin.definition.setup(harness.ctx);
    await harness.executeTool("list-orders", { companyId: "forged", projectId: "project", accountId: "seller", state: "InTransit", from: "2026-10-01", to: "2026-10-08" }, { companyId: "actual" });
    expect(request).toHaveBeenCalledExactlyOnceWith({ companyId: "actual", projectId: "project", accountId: "seller", state: "InTransit", from: "2026-10-01", to: "2026-10-08", operation: "orders" });
    expect(harness.ctx.autoSourcing.sync).toBeTypeOf("function");
  });
  it("does not allow agents or system actions to start provider sync", async () => {
    const harness = createTestHarness({ manifest });
    const sync = vi.spyOn(harness.ctx.autoSourcing, "sync").mockResolvedValue({ state: "queued" });
    await plugin.definition.setup(harness.ctx);
    await expect(harness.performAction("sync-orders", { projectId: "p" }, { actor: { type: "agent", companyId: "company" } })).rejects.toThrow("board action");
    expect(sync).not.toHaveBeenCalled();
    await harness.performAction("sync-orders", { projectId: "p", accountId: "a", from: "2026-10-01", to: "2026-10-08", companyId: "forged" }, { actor: { type: "user", companyId: "company" }, companyId: "company" });
    expect(sync).toHaveBeenCalledExactlyOnceWith({ companyId: "company", projectId: "p", accountId: "a", from: "2026-10-01", to: "2026-10-08" });
  });
  it("forwards preparation only for authenticated board users with the actual company scope", async () => {
    const harness = createTestHarness({ manifest });
    const shipping = vi.spyOn(harness.ctx.autoSourcing, "shipping").mockResolvedValue({ ticket: null, errorCode: null });
    await plugin.definition.setup(harness.ctx);
    await expect(harness.performAction("shipping-order", { operation: "prepare" }, { actor: { type: "agent", companyId: "company" } })).rejects.toThrow("board action");
    expect(shipping).not.toHaveBeenCalled();
    for (const operation of ["prepare-preview", "prepare", "prepare-status"] as const) {
      const confirmation = operation === "prepare-preview" ? {} : { confirmation: "a".repeat(32) };
      await harness.performAction("shipping-order", { companyId: "forged", projectId: "project", accountId: "seller", operation, shipmentId: "123456789012345678", ...confirmation },
        { actor: { type: "user", companyId: "company" }, companyId: "company" });
      expect(shipping).toHaveBeenLastCalledWith({ companyId: "company", projectId: "project", accountId: "seller", operation, shipmentId: "123456789012345678", ...confirmation });
    }
  });
  it("requires an authenticated board action for shipping and never exposes it as an agent tool", async () => {
    const harness = createTestHarness({ manifest });
    const shipping = vi.spyOn(harness.ctx.autoSourcing, "shipping").mockResolvedValue({ ticket: null, errorCode: null });
    await plugin.definition.setup(harness.ctx);
    for (const type of ["agent", "system"] as const)
      await expect(harness.performAction("shipping-order", { operation: "dispatch" }, { actor: { type, companyId: "company" } })).rejects.toThrow("board action");
    expect(shipping).not.toHaveBeenCalled();
    await harness.performAction("shipping-order", { companyId: "forged", projectId: "project", accountId: "seller", operation: "preview", shipmentId: "123456789012345678", carrierCode: "CJGLS", invoiceNumber: "001234567890" }, { actor: { type: "user", companyId: "company" }, companyId: "company" });
    expect(shipping).toHaveBeenCalledExactlyOnceWith({ companyId: "company", projectId: "project", accountId: "seller", operation: "preview", shipmentId: "123456789012345678", carrierCode: "CJGLS", invoiceNumber: "001234567890" });
    await expect(harness.performAction("shipping-order", { operation: "cancel" }, { actor: { type: "user", companyId: "company" }, companyId: "company" })).rejects.toThrow("Invalid shipping");
  });

});
