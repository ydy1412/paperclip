const id = { type: "string", minLength: 1, maxLength: 100 };
const scope = { projectId: { type: "string", format: "uuid" }, accountId: id };
const source = { sourceProvider: { type: "string", enum: ["taobao"] }, productId: id };
const option = { type: "object", properties: { ordinal: { type: "integer", minimum: 0 }, name: { type: "string", minLength: 1, maxLength: 100 }, value: { type: "string", minLength: 1, maxLength: 150 } }, required: ["ordinal", "name", "value"], additionalProperties: false };
const dimension = { type: "integer", minimum: 1, maximum: 50000 };
export const processingTools = [
  ["get-processing-source", "source", source],
  ["list-processing-drafts", "list", {}],
  ["get-processing-draft", "get", { draftId: id }],
  ["validate-processing-draft", "validate", { draftId: id, expectedRevision: { type: "integer", minimum: 1 } }],
  ["create-processing-draft", "create", { ...source, skuIds: { type: "array", minItems: 1, maxItems: 200, uniqueItems: true, items: id } }],
  ["save-processing-draft", "save", { draftId: id, expectedRevision: { type: "integer", minimum: 1 }, name: { type: "string", minLength: 1, maxLength: 100 },
    items: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", properties: { sourceSkuId: id, name: { type: "string", minLength: 1, maxLength: 150 }, representativeImageUrl: { type: "string", maxLength: 2000 }, options: { type: "array", maxItems: 100, items: option } }, required: ["sourceSkuId", "name", "representativeImageUrl", "options"], additionalProperties: false } },
    cropPlans: { type: "array", maxItems: 200, items: { type: "object", properties: { sourceSkuId: id, imageUrl: { type: "string", maxLength: 2000 }, sourceWidth: dimension, sourceHeight: dimension, x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 }, width: dimension, height: dimension, outputWidth: dimension, outputHeight: dimension, purpose: { type: "string", minLength: 1, maxLength: 200 } }, required: ["sourceSkuId", "imageUrl", "sourceWidth", "sourceHeight", "x", "y", "width", "height", "outputWidth", "outputHeight", "purpose"], additionalProperties: false } },
  }],
] as const;
export const processingToolDeclarations = processingTools.map(([name, operation, fields]) => ({
  name, displayName: name, description: `Local source-backed draft ${operation}. Requires bound project/account and source allowlist. Preserves original SKU facts; no inference, marketplace submission or pixel editing. Category/crop remain unverified.`,
  parametersSchema: { type: "object", properties: { ...scope, ...fields }, required: [...Object.keys(scope), ...Object.keys(fields)], additionalProperties: false },
}));
