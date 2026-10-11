import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { catalogToolDeclarations } from "@paperclipai/plugin-auto-sourcing/catalog-tools";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclipai.plugin-sourcing-processing", apiVersion: 1, version: "0.2.0",
  displayName: "소싱 상품 가공", description: "가공 전 상품 조회, 업로드 상품 참고, 상품명·옵션·이미지·상세 설명의 로컬 가공 저장.",
  author: "Dovix", categories: ["connector"], entrypoints: { worker: "./dist/worker.js" },
  capabilities: ["agent.tools.register", "auto-sourcing.products.read", "auto-sourcing.drafts.write"],
  instanceConfigSchema: { type: "object", properties: {
    serviceToken: { type: "object", title: "Local service token", properties: { type: { const: "secret_ref" }, secretId: { type: "string" }, version: { type: "string", enum: ["latest"] } }, required: ["type", "secretId"], additionalProperties: false },
    sourceProducts: { type: "object", title: "Project source product allowlists", additionalProperties: { type: "array", items: { type: "string", pattern: "^taobao:[a-zA-Z0-9_-]{1,100}$" }, maxItems: 1000 } },
    projects: { type: "object", title: "Project account bindings", additionalProperties: { type: "array", items: { type: "string" } } },
  }, required: ["serviceToken", "projects"], additionalProperties: false },
  tools: [
    { name: "list-sourcing-workspace", displayName: "가공 전 상품 조회", description: "Read scoped raw collected sources, candidates and managed products. Use stage=unprocessed to find actual unprocessed sources; search before paging. No collection or marketplace call.", parametersSchema: { type: "object", properties: { projectId: { type: "string", format: "uuid" }, stage: { type: "string", enum: ["all", "candidate", "unprocessed", "processing", "ready", "queued", "uploaded", "attention"] }, query: { type: "string", maxLength: 200 }, page: { type: "integer", minimum: 1, maximum: 100000 } }, required: ["projectId"], additionalProperties: false } },
    { name: "start-managed-processing", displayName: "소싱 상품 가공 시작", description: "Create or return the local editable common product from an authorized existing collected source. Preserves source and all SKU identities. Does not collect, publish or queue. Read and save using returned product id/revision.", parametersSchema: { type: "object", properties: { projectId: { type: "string", format: "uuid" }, sourceProvider: { type: "string", enum: ["taobao"] }, sourceProductId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" } }, required: ["projectId", "sourceProvider", "sourceProductId"], additionalProperties: false } },
    ...catalogToolDeclarations,
    { name: "recommend-coupang-category", displayName: "쿠팡 카테고리 추천", description: "Recommend a Coupang category from the product name using a registered enabled Coupang store from list-product-stores. Read-only; does not save the recommendation or verify product facts.", parametersSchema: { type: "object", properties: { projectId: { type: "string", format: "uuid" }, storeId: { type: "string", pattern: "^[a-f0-9]{32}$" }, productName: { type: "string", minLength: 1, maxLength: 200 } }, required: ["projectId", "storeId", "productName"], additionalProperties: false } },
    { name: "get-coupang-category-metadata", displayName: "쿠팡 카테고리 필수정보 조회", description: "Read required attributes, notice groups, certifications and documents for a positive category code using a registered enabled Coupang store. Requirements describe needed facts; reading them does not attest the product or permit publication.", parametersSchema: { type: "object", properties: { projectId: { type: "string", format: "uuid" }, storeId: { type: "string", pattern: "^[a-f0-9]{32}$" }, categoryCode: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }, required: ["projectId", "storeId", "categoryCode"], additionalProperties: false } },
  ],
};
export default manifest;
