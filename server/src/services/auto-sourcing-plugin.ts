import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, agents, heartbeatRuns, issues, projects, pluginConfig } from "@paperclipai/db";
import { envBindingSecretRefSchema, catalogRequestSchema, storeSettingRequestSchema, storeSettingsSchema, managedProductSchema, publicationJobSchema, catalogStageCountsSchema } from "@paperclipai/shared";
import type { HostServices, WorkerHostCallContext } from "@paperclipai/plugin-sdk";
import { forbidden } from "../errors.js";
import { pluginRegistryService } from "./plugin-registry.js";
import { createPluginSecretsHandler } from "./plugin-secrets-handler.js";
import { processingReadSchema, processingWriteSchema, processingSourceSchema, processingListSchema, processingViewSchema } from "./auto-sourcing-processing-contract.js";
import { logActivity } from "./activity-log.js";

const identity = z.object({ companyId: z.string().uuid(), projectId: z.string().uuid() });
const readSchema = identity.extend({ operation: z.enum(["accounts", "orders", "detail", "sync-state", "carriers"]),
  accountId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  shipmentId: z.string().regex(/^\d{1,30}$/).optional(),
  state: z.enum(["Unknown", "Paid", "Preparing", "Shipping", "Shipped", "InTransit", "Delivered", "Untracked"]).optional(),
  q: z.string().max(100).optional(), page: z.number().int().min(1).max(100000).optional(),
  from: z.string().date().optional(), to: z.string().date().optional(),
}).strict();
const syncSchema = identity.extend({ accountId: readSchema.shape.accountId.unwrap(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
const shippingBase = identity.extend({ accountId: readSchema.shape.accountId.unwrap(), shipmentId: readSchema.shape.shipmentId.unwrap() });
const invoiceInput = { carrierCode: z.string().regex(/^[A-Z0-9_-]{1,40}$/),
  invoiceNumber: z.string().regex(/^[a-zA-Z0-9]{1,30}$/) };
const carrierSchema = z.object({ code: invoiceInput.carrierCode, name: z.string().trim().min(1).max(100),
  lengths: z.array(z.number().int().min(1).max(30)).max(30).refine(values => new Set(values).size === values.length),
  format: z.enum(["numeric", "alphanumeric"]), trackingSupported: z.boolean() });
const shippingSchema = z.discriminatedUnion("operation", [
  shippingBase.extend({ operation: z.literal("preview"), ...invoiceInput }).strict(),
  shippingBase.extend({ operation: z.literal("dispatch"), ...invoiceInput, confirmation: z.string().regex(/^[a-f0-9]{32}$/) }).strict(),
  shippingBase.extend({ operation: z.literal("status"), confirmation: z.string().regex(/^[a-f0-9]{32}$/).optional() }).strict(),
  shippingBase.extend({ operation: z.literal("prepare-preview") }).strict(),
  shippingBase.extend({ operation: z.literal("prepare"), confirmation: z.string().regex(/^[a-f0-9]{32}$/) }).strict(),
  shippingBase.extend({ operation: z.literal("prepare-status"), confirmation: z.string().regex(/^[a-f0-9]{32}$/).optional() }).strict(),
]);
const shippingResultSchema = z.object({ ticket: z.object({ id: z.string().regex(/^[a-f0-9]{32}$/),
  area: z.enum(["shipping", "orders"]), kind: z.enum(["RegisterInvoice", "Prepare"]), targetId: z.string().regex(/^\d{1,30}$/),
  state: z.enum(["Previewed", "Sending", "Verified", "ReadbackPending", "OutcomeUnknown", "Partial", "Rejected"]),
  expiresAt: z.string(), readbackVerified: z.boolean(),
  results: z.array(z.object({ targetId: z.string(), succeeded: z.boolean(), code: z.string().regex(/^[a-zA-Z0-9_]{1,100}$/) })).max(1000),
}).nullable(), errorCode: z.string().regex(/^[a-zA-Z0-9_]{1,100}$/).nullable() });
const configSchema = z.object({ serviceToken: envBindingSecretRefSchema,
  sourceProducts: z.record(z.string().uuid(), z.array(z.string().regex(/^taobao:[a-zA-Z0-9_-]{1,100}$/)).max(1000)).optional(),
  projects: z.record(z.string().uuid(), z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/))),
});
const itemSchema = z.object({ itemId: z.string(), productId: z.string().nullable(), quantity: z.number().int().nonnegative(),
  cancelledQuantity: z.number().int().nonnegative(), pendingCancellationQuantity: z.number().int().nonnegative(),
  unitPrice: z.number().nullable(), orderPrice: z.number().nullable(), currency: z.string().nullable(), productName: z.string().max(500).nullable().optional() });
const orderSchema = z.object({ shipmentId: z.string(), orderId: z.string(), state: z.string(),
  orderedAt: z.string().nullable(), observedAt: z.string(), quantity: z.number().int().nonnegative(),
  amount: z.number().nullable(), currency: z.string().nullable(), items: z.array(itemSchema).max(1000), buyerName: z.string().max(200).nullable().optional(), recipientName: z.string().max(200).nullable().optional() });
const syncStateSchema = z.object({ state: z.enum(["not_synced", "unknown", "queued", "running", "completed", "failed"]),
  jobId: z.string().nullable(), startedAt: z.string().nullable(), finishedAt: z.string().nullable(),
  items: z.number().int().nullable(), errorCode: z.string().nullable() });

export function autoSourcingPluginService(db: Db, pluginId: string, options: { processingPort?: number } = {}): NonNullable<HostServices["autoSourcing"]> & { operatorSettings(value: unknown, context: WorkerHostCallContext): Promise<unknown> } {
  const processingPort = options.processingPort ?? 3115;
  if (!Number.isInteger(processingPort) || processingPort < 1 || processingPort > 65535) throw new Error("Invalid local processing port");
  const registry = pluginRegistryService(db);
  const secrets = createPluginSecretsHandler({ db, pluginId });

  async function authorize(input: z.infer<typeof identity> & { accountId?: string }, context?: WorkerHostCallContext, catalog = false) {
    const scope = context?.invocationScope;
    if (context?.invalidInvocationScope || scope?.companyId !== input.companyId) throw forbidden("회사 범위가 일치하는 플러그인 호출이 필요합니다.");
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.id, input.projectId), eq(projects.companyId, input.companyId), isNull(projects.archivedAt)));
    if (!project) throw forbidden("사용 가능한 같은 회사 프로젝트가 아닙니다.");
    if (scope.agentRun) {
      const binding = scope.agentRun;
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, binding.runId),
        eq(heartbeatRuns.agentId, binding.agentId), eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.status, "running")));
      const issueId = run?.nativeIssueId ?? run?.contextSnapshot?.issueId;
      const [issue] = typeof issueId === "string" ? await db.select().from(issues).where(and(eq(issues.id, issueId), eq(issues.companyId, input.companyId))) : [];
      const [agent] = await db.select({ status: agents.status }).from(agents).where(and(eq(agents.id, binding.agentId), eq(agents.companyId, input.companyId)));
      if (!issue || !agent || ["paused", "terminated"].includes(agent.status) || issue.hiddenAt
        || ["done", "cancelled"].includes(issue.status)
        || (issue.assigneeAgentId !== binding.agentId && issue.conversationAgentId !== binding.agentId)
        || issue.projectId !== input.projectId
        || (binding.projectId && binding.projectId !== input.projectId)
        || (issue.executionRunId && issue.executionRunId !== binding.runId)
        || (issue.conversationAgentId === binding.agentId && Number(run?.contextSnapshot?.conversationSessionGeneration ?? 0) !== issue.conversationSessionGeneration))
        throw forbidden("현재 에이전트 작업의 조회 범위가 아닙니다.");
    }
    const config = configSchema.parse((await registry.getConfig(pluginId, input.companyId))?.configJson);
    const accounts = config.projects[input.projectId] ?? [];
    if (!catalog && (!accounts.length || (input.accountId && !accounts.includes(input.accountId)))) throw forbidden("프로젝트에 연결된 판매 계정이 아닙니다.");
    return { config, accounts };
  }

  async function catalogCall(companyId: string, tokenRef: z.infer<typeof envBindingSecretRefSchema>, operation: string, body: unknown) {
    const token = await secrets.resolve({ companyId, secretRef: tokenRef, configPath: "serviceToken" });
    const response = await fetch(`http://127.0.0.1:${processingPort}/catalog/${operation}`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(120000) });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { code?: unknown } | null;
      throw new Error(typeof error?.code === "string" && /^[a-z_]{1,80}$/.test(error.code) ? error.code : "catalog_request_failed");
    }
    const text = await response.text(); if (text.length > 8 * 1024 * 1024) throw new Error("catalog_response_too_large");
    return JSON.parse(text) as unknown;
  }
  async function catalog(value: unknown, context: WorkerHostCallContext | undefined, write: boolean) {
    const input = catalogRequestSchema.parse(value);
    const reads = ["settings", "list", "stages", "sources", "get", "jobs", "import-status"];
    if (reads.includes(input.operation) === write) throw forbidden("허용되지 않은 상품 작업입니다.");
    if (context?.invocationScope?.agentRun && write && !["save", "source"].includes(input.operation)) throw forbidden("상품 가져오기와 실제 업로드는 운영 화면에서 실행해 주세요.");
    const { config, accounts } = await authorize(input, context, true);
    if (input.operation === "source" && !(config.sourceProducts?.[input.projectId] ?? []).includes(`${input.sourceProvider}:${input.sourceProductId}`)) throw forbidden("프로젝트에 허용된 원본 상품이 아닙니다.");
    const { operation, ...body } = input;
    const raw = await catalogCall(input.companyId, config.serviceToken, operation, operation === "settings" ? { ...body, legacyAccountIds: context?.invocationScope?.agentRun ? [] : accounts } :
      operation === "sources" ? { ...body, allowedSources: config.sourceProducts?.[input.projectId] ?? [] } : body);
    let result: unknown = raw;
    if (operation === "settings") {
      const settings = storeSettingsSchema.parse(raw);
      if (settings.businesses.some(b => b.companyId !== input.companyId || b.projectId !== input.projectId)) throw forbidden("사업자 조회 범위가 일치하지 않습니다.");
      if (context?.invocationScope?.agentRun) settings.businesses = settings.businesses.map(b => ({ ...b, registrationNumber: "" }));
      result = settings;
    } else if (operation === "list") result = z.array(managedProductSchema).parse(raw);
    else if (operation === "stages") result = catalogStageCountsSchema.parse(raw);
    else if (operation === "sources") result = z.array(z.object({ sourceProvider: z.string(), sourceProductId: z.string(), title: z.string(), mainImage: z.string() })).parse(raw);
    else if (["get", "save", "source"].includes(operation)) result = managedProductSchema.parse(raw);
    else if (["jobs", "queue"].includes(operation)) result = z.array(publicationJobSchema).parse(raw);
    else if (operation === "reconcile") result = publicationJobSchema.parse(raw);
    else result = z.object({ state: z.string(), errorCode: z.string(), products: z.number() }).parse(raw);
    if (["jobs", "queue", "reconcile"].includes(operation)) {
      const jobs = Array.isArray(result) ? result : [result];
      if (jobs.some(j => j.companyId !== input.companyId || j.projectId !== input.projectId)) throw forbidden("업로드 작업 범위가 일치하지 않습니다.");
    }
    if (write) await logActivity(db, { companyId: input.companyId, actorType: "plugin", actorId: pluginId, action: `auto_sourcing.catalog_${operation}`,
      entityType: "project", entityId: input.projectId, details: { operation, ...("productId" in input ? { productId: input.productId } : {}) } });
    return result;
  }
  async function operatorSettings(value: unknown, context: WorkerHostCallContext) {
    if (context.invocationScope?.agentRun) throw forbidden("운영 화면에서만 연결 정보를 저장할 수 있습니다.");
    const input = storeSettingRequestSchema.parse(value); const { config, accounts } = await authorize(input, context, true);
    if (input.operation === "attach" && !accounts.includes(input.accountId)) throw forbidden("프로젝트에 허용된 기존 판매 계정이 아닙니다.");
    const { operation, ...body } = input;
    await catalogCall(input.companyId, config.serviceToken, operation, body);
    // Never relay the credential-bearing request or an unvalidated service response.
    const result = storeSettingsSchema.parse(await catalog({ companyId: input.companyId, projectId: input.projectId, operation: "settings" }, context, false));
    // Extend the established native account allowlist atomically. Other project/config fields survive concurrent registrations.
    const accountIds = JSON.stringify(result.stores.map(s => s.accountId));
    await db.update(pluginConfig).set({ configJson: sql`jsonb_set(${pluginConfig.configJson}, ARRAY['projects', ${input.projectId}]::text[],
      (SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb) FROM jsonb_array_elements(COALESCE(${pluginConfig.configJson} #> ARRAY['projects', ${input.projectId}]::text[], '[]'::jsonb) || ${accountIds}::jsonb)), true)`, updatedAt: new Date() })
      .where(and(eq(pluginConfig.pluginId, pluginId), eq(pluginConfig.companyId, input.companyId)));
    return result;
  }

  async function call(companyId: string, tokenRef: z.infer<typeof envBindingSecretRefSchema>, pathname: string, init?: RequestInit, shipping = false) {
    const token = await secrets.resolve({ companyId, secretRef: tokenRef, configPath: "serviceToken" });
    try {
      const response = await fetch(`http://127.0.0.1:3115${pathname}`, { ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        redirect: "error", signal: AbortSignal.timeout(shipping ? 28000 : 15000) });
      if (!response.ok) throw new Error("Auto Sourcing 요청 실패");
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error("Auto Sourcing 응답 크기 초과");
      return JSON.parse(text) as unknown;
    } catch { throw new Error(shipping ? "발송 요청 결과를 확인하지 못했습니다. 처리 기록을 확인하십시오." : "Auto Sourcing 조회 실패. 기존 주문은 보존됩니다."); }
  }

  async function processing(value: unknown, context: WorkerHostCallContext | undefined, write: boolean) {
    const input = (write ? processingWriteSchema : processingReadSchema).parse(value);
    const { config } = await authorize(input, context);
    const allowed = config.sourceProducts?.[input.projectId] ?? [];
    const permitted = (provider: string, productId: string) => allowed.includes(`${provider}:${productId}`);
    if ("productId" in input && !permitted(input.sourceProvider, input.productId)) throw forbidden("프로젝트에 허용된 원본 상품이 아닙니다.");
    const token = await secrets.resolve({ companyId: input.companyId, secretRef: config.serviceToken, configPath: "serviceToken" });
    const invoke = async (operation: string, body: unknown): Promise<unknown> => {
      let response: Response;
      try {
        response = await fetch(`http://127.0.0.1:${processingPort}/processing/${operation}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15000) });
      } catch { throw new Error("가공 서비스 연결 실패. 저장 결과는 재조회로 확인하십시오."); }
      if (!response.ok) {
        if (response.status === 409) throw new Error("publication_conflict: 초안이 변경되었습니다. 다시 조회하십시오.");
        throw new Error("가공 요청 거부. 원본 근거, 범위와 입력값을 확인하십시오.");
      }
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error("가공 응답 크기 초과");
      return JSON.parse(text);
    };
    const { operation, ...body } = input;
    const checkView = (value: unknown) => {
      const result = processingViewSchema.parse(value);
      if (result.draft.processingCompanyId !== input.companyId || result.draft.processingProjectId !== input.projectId || result.draft.accountId !== input.accountId ||
          result.source.provider !== result.draft.sourceProvider || result.source.productId !== result.draft.productId ||
          ("draftId" in input && result.draft.id !== input.draftId) || !permitted(result.draft.sourceProvider, result.draft.productId))
        throw forbidden("가공 초안 범위가 일치하지 않습니다.");
      return result;
    };
    // Recheck allowlist before edits; local draft ownership is independently enforced by .NET.
    if ("draftId" in input) checkView(await invoke("get", { companyId: input.companyId, projectId: input.projectId, accountId: input.accountId, draftId: input.draftId }));
    const raw = await invoke(operation, body);
    if (operation === "source") {
      const source = processingSourceSchema.parse(raw);
      if (source.provider !== input.sourceProvider || source.productId !== input.productId) throw forbidden("원본 상품 범위가 일치하지 않습니다.");
      return source;
    }
    if (operation === "list") return processingListSchema.parse(raw).filter(d => permitted(d.sourceProvider, d.productId));
    const result = checkView(raw);
    if (write) await logActivity(db, { companyId: input.companyId, actorType: "plugin", actorId: pluginId,
      action: `auto_sourcing.processing_${operation}`, entityType: "project", entityId: input.projectId,
      details: { accountId: input.accountId, draftId: result.draft.id, revision: result.draft.revision } });
    return result;
  }

  return {
    catalogRead: (value: Record<string, unknown> & { companyId: string; projectId: string; operation: string }, context?: WorkerHostCallContext) => catalog(value, context, false),
    catalogWrite: (value: Record<string, unknown> & { companyId: string; projectId: string; operation: string }, context?: WorkerHostCallContext) => catalog(value, context, true),
    operatorSettings,
    processingRead: (value, context) => processing(value, context, false),
    processingWrite: (value, context) => processing(value, context, true),
    async shipping(value, context) {
      const input = shippingSchema.parse(value);
      if (context?.invocationScope?.agentRun) throw forbidden("발송은 인증된 운영 화면에서만 가능합니다.");
      const { config } = await authorize(input, context);
      const preparing = input.operation.startsWith("prepare");
      const status = input.operation === "status" || input.operation === "prepare-status";
      const paths = { preview: "/shipping/preview", dispatch: "/shipping/dispatch", status: "/shipping/status",
        "prepare-preview": "/preparation/preview", prepare: "/preparation/confirm", "prepare-status": "/preparation/status" };
      let path = paths[input.operation];
      const { companyId, projectId, operation, ...body } = input;
      if (input.operation === "status" || input.operation === "prepare-status") path += `?${new URLSearchParams({ accountId: input.accountId, shipmentId: input.shipmentId,
        ...(input.confirmation ? { confirmation: input.confirmation } : {}) })}`;
      const result = shippingResultSchema.parse(await call(companyId, config.serviceToken, path,
        status ? undefined : { method: "POST", body: JSON.stringify(body) }, true));
      if (result.ticket && (result.ticket.targetId !== input.shipmentId || result.ticket.area !== (preparing ? "orders" : "shipping")
        || result.ticket.kind !== (preparing ? "Prepare" : "RegisterInvoice"))) throw new Error("주문 처리 기록의 작업 범위가 일치하지 않습니다.");
      if (!status) await logActivity(db, { companyId, actorType: "plugin", actorId: pluginId,
        action: `auto_sourcing.shipping_${operation}`, entityType: "project", entityId: projectId,
        details: { accountId: input.accountId, shipmentId: input.shipmentId, ticketId: result.ticket?.id,
          state: result.ticket?.state, errorCode: result.errorCode } });
      return result;
    },
    async request(value, context) {
      const input = readSchema.parse(value);
      if (!!input.from !== !!input.to || (input.from && input.to && input.from > input.to))
        throw new Error("조회 기간의 시작일과 종료일을 확인하십시오.");
      const { config, accounts } = await authorize(input, context);
      if (input.operation === "accounts") {
        const rows = await call(input.companyId, config.serviceToken, "/accounts");
        const safe = z.array(z.object({ id: z.string(), displayName: z.string(), provider: z.literal("coupang"), enabled: z.boolean() })).parse(rows);
        return safe.filter(account => accounts.includes(account.id));
      }
      if (!input.accountId || (input.operation === "detail" && !input.shipmentId)) throw new Error("판매 계정과 주문번호가 필요합니다.");
      const query = new URLSearchParams({ accountId: input.accountId });
      let pathname = "/sync";
      if (input.operation === "orders") {
        pathname = "/orders";
        if (input.state) query.set("state", input.state);
        if (input.q) query.set("q", input.q);
        if (input.from && input.to) { query.set("from", input.from); query.set("to", input.to); }
        query.set("page", String(input.page ?? 1));
      } else if (input.operation === "detail") pathname = `/orders/${input.shipmentId}`;
      else if (input.operation === "carriers") pathname = "/shipping/carriers";
      const result = await call(input.companyId, config.serviceToken, `${pathname}?${query}`);
      if (input.operation === "carriers") return z.array(carrierSchema).max(500)
        .refine(rows => new Set(rows.map(row => row.code)).size === rows.length).parse(result);
      if (input.operation === "detail") return orderSchema.parse(result);
      if (input.operation === "sync-state") return syncStateSchema.parse(result);
      return z.object({ orders: z.array(orderSchema).max(20), total: z.number().int().nonnegative(),
        page: z.number().int().positive(), pageSize: z.literal(20), summary: z.object({ totalOrders: z.number().int().nonnegative(), totalQuantity: z.number().int().nonnegative(), newOrders: z.number().int().nonnegative(), preparingOrders: z.number().int().nonnegative(), shippingOrders: z.number().int().nonnegative(), deliveredOrders: z.number().int().nonnegative(), unknownAmountOrders: z.number().int().nonnegative(), revenue: z.array(z.object({ currency: z.string().regex(/^[A-Z]{3}$/), amount: z.number() })).max(100) }).nullable().optional() }).parse(result);
    },
    async sync(value, context) {
      const input = syncSchema.parse(value);
      if (context?.invocationScope?.agentRun) throw forbidden("주문 동기화는 운영 화면에서 요청하십시오.");
      const { config } = await authorize(input, context);
      const result = syncStateSchema.parse(await call(input.companyId, config.serviceToken, "/sync", { method: "POST",
        body: JSON.stringify({ accountId: input.accountId, from: input.from, to: input.to }) }));
      await logActivity(db, { companyId: input.companyId, actorType: "plugin", actorId: pluginId,
        action: "auto_sourcing.orders_sync_requested", entityType: "project", entityId: input.projectId,
        details: { jobId: result.jobId, accountId: input.accountId, from: input.from, to: input.to } });
      return result;
    },
  };
}
