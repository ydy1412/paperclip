import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

import { processingToolDeclarations } from "./processing-tools.js";
import { catalogToolDeclarations } from "./catalog-tools.js";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclipai.plugin-auto-sourcing", apiVersion: 1, version: "0.5.0",
  displayName: "Auto Sourcing", description: "Coupang order workspace backed by the local Auto Sourcing service.",
  author: "Paperclip", categories: ["connector"], entrypoints: { worker: "./dist/worker.js" },
  capabilities: ["agent.tools.register", "auto-sourcing.orders.read", "auto-sourcing.orders.sync", "auto-sourcing.shipping.write", "ui.action.register", "auto-sourcing.products.read", "auto-sourcing.drafts.write"],
  instanceConfigSchema: { type: "object", properties: {
    serviceToken: { type: "object", title: "Local service token", properties: { type: { const: "secret_ref" }, secretId: { type: "string" }, version: { type: "string", enum: ["latest"] } }, required: ["type", "secretId"], additionalProperties: false },
    sourceProducts: { type: "object", title: "Project source product allowlists", additionalProperties: { type: "array", items: { type: "string", pattern: "^taobao:[a-zA-Z0-9_-]{1,100}$" }, maxItems: 1000 } },
    projects: { type: "object", title: "Project legacy account bindings", additionalProperties: { type: "array", items: { type: "string" } } },
  }, required: ["serviceToken", "projects"], additionalProperties: false },
  tools: [
    ...catalogToolDeclarations,
    ...processingToolDeclarations,
    { name: "list-order-accounts", displayName: "Order accounts", description: "Read configured sales accounts for an explicitly selected Paperclip project. Does not contact Coupang or reveal credentials.", parametersSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"], additionalProperties: false } },
    { name: "list-orders", displayName: "Read orders", description: "Read locally synchronized orders. Shipping includes Shipped and InTransit. Select a configured project and sales account. Missing rows do not prove no remote orders. No marketplace writes or provider sync.", parametersSchema: { type: "object", properties: { projectId: { type: "string" }, accountId: { type: "string" }, state: { type: "string", enum: ["Unknown", "Paid", "Preparing", "Shipping", "Shipped", "InTransit", "Delivered", "Untracked"] }, q: { type: "string", maxLength: 100 }, page: { type: "integer", minimum: 1, maximum: 100000 }, from: { type: "string", format: "date", description: "Inclusive Korean order start date; requires to." }, to: { type: "string", format: "date", description: "Inclusive Korean order end date; requires from." } }, required: ["projectId", "accountId"], additionalProperties: false } },
    { name: "get-order", displayName: "Order detail", description: "Read stored order items and quantities. No customer identity/address/contact data. Never cancel, ship or modify an order.", parametersSchema: { type: "object", properties: { projectId: { type: "string" }, accountId: { type: "string" }, shipmentId: { type: "string" } }, required: ["projectId", "accountId", "shipmentId"], additionalProperties: false } },
  ],
};
export default manifest;
