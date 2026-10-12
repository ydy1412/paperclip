import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { companySecrets, projects, sourcingForwarders, sourcingForwarderProviders, type Db } from "@paperclipai/db";
import type { CreateSourcingForwarder, UpdateSourcingForwarder, SourcingForwarder, SourcingForwarderOpenResult } from "@paperclipai/shared";
import { badRequest, conflict, notFound, unprocessable } from "../errors.js";
import { secretService } from "./secrets.js";
import { supportsForwarderLogin, type ForwarderBrowserOpen, type ForwarderBrowserInput } from "./sourcing-forwarder-browser.js";

type Row = typeof sourcingForwarders.$inferSelect;
const view = (row: Row, configured = true): SourcingForwarder => ({ id: row.id, companyId: row.companyId, projectId: row.projectId,
  name: row.name, providerId: row.providerId, homepageUrl: row.homepageUrl, loginUrl: row.loginUrl, enabled: row.enabled,
  credentialConfigured: configured, automaticLogin: supportsForwarderLogin(row.loginUrl),
  verificationStatus: (configured && row.enabled ? row.verificationStatus : "unverified") as SourcingForwarder["verificationStatus"],
  verificationSessionId: row.verificationSessionId, verificationCheckedAt: row.verificationCheckedAt?.toISOString() ?? null,
  verifiedAt: row.verifiedAt?.toISOString() ?? null, verificationErrorCode: row.verificationErrorCode });
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function sourcingForwarderService(db: Db, openBrowser: ForwarderBrowserOpen) {
  const active = new Set<string>();
  const checking = new Set<string>();
  const nextReconciliation = new Map<string, number>();
  async function provider(source: Db | Transaction, id: string) {
    const [row] = await source.select().from(sourcingForwarderProviders).where(and(eq(sourcingForwarderProviders.id, id), eq(sourcingForwarderProviders.enabled, true))).for("update");
    if (!row) throw badRequest("사용 가능한 배송대행지를 선택해 주세요.");
    try {
      const home = new URL(row.homepageUrl), login = new URL(row.loginUrl);
      if (home.protocol !== "https:" || login.protocol !== "https:" || home.origin !== login.origin || home.username || home.password || login.username || login.password || home.hash || login.hash) throw new Error();
    } catch { throw unprocessable("배송대행지의 등록 주소를 확인해 주세요."); }
    return row;
  }
  async function project(source: Db | Transaction, companyId: string, projectId: string) {
    const [row] = await source.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)));
    if (!row || row.archivedAt) throw notFound("사용 가능한 프로젝트가 없습니다.");
  }
  async function get(source: Db | Transaction, companyId: string, projectId: string, id: string, lock = false) {
    await project(source, companyId, projectId);
    const query = source.select().from(sourcingForwarders).where(and(eq(sourcingForwarders.companyId, companyId), eq(sourcingForwarders.projectId, projectId), eq(sourcingForwarders.id, id)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw notFound("배송대행지를 찾을 수 없습니다.");
    return row;
  }
  async function credentials(source: Db | Transaction, row: Row) {
    if (!supportsForwarderLogin(row.loginUrl)) return { loginId: "", password: "" };
    try {
      const saved: unknown = JSON.parse(await secretService(source as Db).resolveSecretValue(row.companyId, row.credentialSecretId, row.credentialVersion));
      if (!saved || typeof saved !== "object" || !("loginId" in saved) || !("password" in saved)
        || typeof saved.loginId !== "string" || typeof saved.password !== "string" || !saved.loginId || !saved.password) throw new Error();
      return { loginId: saved.loginId, password: saved.password };
    } catch { throw unprocessable("저장한 로그인 계정을 사용할 수 없습니다. 배송대행지 설정에서 계정을 다시 입력해 주세요."); }
  }
  const binding = (row: Row) => and(eq(sourcingForwarders.companyId, row.companyId), eq(sourcingForwarders.projectId, row.projectId),
    eq(sourcingForwarders.id, row.id), eq(sourcingForwarders.credentialVersion, row.credentialVersion),
    eq(sourcingForwarders.loginUrl, row.loginUrl), eq(sourcingForwarders.verificationAttemptId, row.verificationAttemptId!), eq(sourcingForwarders.enabled, true));
  async function finish(row: Row, result: SourcingForwarderOpenResult) {
    const status = result.status === "page_opened" ? "unverified" : result.status;
    const allowed = ["verification_unconfirmed", "origin_changed", "login_controls_changed", "credentials_unavailable",
      "existing_session_unconfirmed", "login_failed", "account_identity_unconfirmed", "aside_unavailable", "account_changed"];
    const errorCode = !result.errorCode ? null : allowed.includes(result.errorCode) ? result.errorCode : "verification_unconfirmed";
    const [updated] = await db.update(sourcingForwarders).set({ verificationStatus: status,
      verificationSessionId: result.sessionId, verificationCheckedAt: new Date(),
      verifiedAt: status === "verified" ? new Date() : null, verificationErrorCode: errorCode })
      .where(binding(row)).returning();
    if (status !== "verifying") nextReconciliation.delete(row.verificationAttemptId!);
    return updated ? { ...result, errorCode } : { status: "blocked" as const, browser: "aside" as const, sessionId: result.sessionId, errorCode: "account_changed" };
  }
  async function inputFor(row: Row): Promise<ForwarderBrowserInput> {
    return { id: row.id, companyId: row.companyId, loginUrl: row.loginUrl, credentials: await credentials(db, row),
      attemptId: row.verificationAttemptId!, onSession: async sessionId => {
        const [updated] = await db.update(sourcingForwarders).set({ verificationSessionId: sessionId }).where(binding(row)).returning({ id: sourcingForwarders.id });
        if (!updated) throw conflict("확인 중 배송대행지 계정이 변경됐습니다.");
      } };
  }
  async function reconcile(row: Row) {
    const attempt = row.verificationAttemptId;
    if (row.verificationStatus !== "verifying" || !attempt || active.has(attempt) || checking.has(attempt)
      || (nextReconciliation.get(attempt) ?? 0) > Date.now()) return;
    checking.add(attempt); nextReconciliation.set(attempt, Date.now() + 10000);
    try {
      if (row.verificationSessionId && openBrowser.reconcile) {
        let input: ForwarderBrowserInput;
        let unavailable = false;
        try { input = await inputFor(row); }
        catch {
          unavailable = true;
          input = { id: row.id, companyId: row.companyId, loginUrl: row.loginUrl, attemptId: attempt,
            credentials: { loginId: "", password: "" }, onSession: async () => {} };
        }
        const result = await openBrowser.reconcile(input, row.verificationSessionId);
        // An unavailable secret must not accept success or block all accounts forever.
        // Wait for the actual native session to stop before releasing its check.
        await finish(row, unavailable && result.status !== "verifying"
          ? { ...result, status: "blocked", errorCode: "credentials_unavailable" } : result);
      } else if (!row.verificationSessionId && Date.now() - (row.verificationCheckedAt?.getTime() ?? 0) > 150000) {
        await finish(row, { status: "blocked", browser: "aside", sessionId: null, errorCode: "aside_unavailable" });
      }
    } catch { /* Uncertain native state is still checking; never manufacture success. */ }
    finally { checking.delete(attempt); }
  }
  return {
    providers: async (companyId: string, projectId: string) => {
      await project(db, companyId, projectId);
      return db.select({ id: sourcingForwarderProviders.id, name: sourcingForwarderProviders.name, homepageUrl: sourcingForwarderProviders.homepageUrl, loginUrl: sourcingForwarderProviders.loginUrl }).from(sourcingForwarderProviders)
        .where(and(eq(sourcingForwarderProviders.enabled, true))).orderBy(asc(sourcingForwarderProviders.name));
    },
    list: async (companyId: string, projectId: string) => {
      await project(db, companyId, projectId);
      const pending = await db.select().from(sourcingForwarders).where(and(eq(sourcingForwarders.companyId, companyId),
        eq(sourcingForwarders.projectId, projectId), eq(sourcingForwarders.verificationStatus, "verifying")));
      await Promise.all(pending.map(reconcile));
      const rows = await db.select({ row: sourcingForwarders, status: companySecrets.status, deletedAt: companySecrets.deletedAt }).from(sourcingForwarders)
        .leftJoin(companySecrets, and(eq(companySecrets.id, sourcingForwarders.credentialSecretId), eq(companySecrets.companyId, companyId)))
        .where(and(eq(sourcingForwarders.companyId, companyId), eq(sourcingForwarders.projectId, projectId))).orderBy(asc(sourcingForwarders.name));
      return rows.map(({ row, status, deletedAt }) => view(row, status === "active" && !deletedAt));
    },
    create: (companyId: string, projectId: string, input: CreateSourcingForwarder, userId?: string) => db.transaction(async tx => {
      await project(tx, companyId, projectId);
      const selected = await provider(tx, input.providerId);
      const existing = await tx.select({ name: sourcingForwarders.name }).from(sourcingForwarders).where(and(eq(sourcingForwarders.companyId, companyId), eq(sourcingForwarders.projectId, projectId), eq(sourcingForwarders.providerId, selected.id)));
      const ordinal = Math.max(existing.length, ...existing.map(row => Number(row.name.match(/ · 계정 (\d+)$/)?.[1]) || 0)) + 1;
      const id = randomUUID();
      // Secret service uses the same Drizzle query/savepoint API: one atomic metadata + local encrypted write.
      const secret = await secretService(tx as unknown as Db).create(companyId, {
        name: `sourcing-forwarder-${id}`, provider: "local_encrypted",
        value: JSON.stringify({ loginId: input.loginId, password: input.password }),
      }, { userId });
      const [row] = await tx.insert(sourcingForwarders).values({ id, companyId, projectId, name: `${selected.name} · 계정 ${ordinal}`, providerId: selected.id,
        homepageUrl: selected.homepageUrl, loginUrl: selected.loginUrl, enabled: input.enabled, credentialSecretId: secret.id, credentialVersion: secret.latestVersion }).returning();
      return view(row);
    }),
    update: (companyId: string, projectId: string, id: string, input: UpdateSourcingForwarder, userId?: string) => db.transaction(async tx => {
      await project(tx, companyId, projectId);
      const [row] = await tx.select().from(sourcingForwarders).where(and(eq(sourcingForwarders.companyId, companyId), eq(sourcingForwarders.projectId, projectId), eq(sourcingForwarders.id, id))).for("update");
      if (!row) throw notFound("배송대행지를 찾을 수 없습니다.");
      const selected = await provider(tx, input.providerId);
      if ((row.providerId !== selected.id || new URL(row.loginUrl).origin !== new URL(selected.loginUrl).origin) && !input.password) throw badRequest("배송대행지를 바꾸려면 해당 사이트의 계정을 새로 입력해 주세요.");
      let credentialVersion = row.credentialVersion;
      if (input.password) {
        const secret = await secretService(tx as unknown as Db).rotate(row.credentialSecretId, {
          value: JSON.stringify({ loginId: input.loginId, password: input.password }),
        }, { userId });
        credentialVersion = secret.latestVersion;
      }
      const invalidated = !!input.password || row.providerId !== selected.id || row.loginUrl !== selected.loginUrl
        || row.homepageUrl !== selected.homepageUrl || row.enabled !== input.enabled;
      const [updated] = await tx.update(sourcingForwarders).set({ name: row.providerId === selected.id ? row.name : selected.name, providerId: selected.id, homepageUrl: selected.homepageUrl,
        loginUrl: selected.loginUrl, enabled: input.enabled, credentialVersion, updatedAt: new Date(),
        ...(invalidated ? { verificationStatus: "unverified", verificationAttemptId: null, verificationSessionId: null,
          verificationCheckedAt: null, verifiedAt: null, verificationErrorCode: null } : {}) }).where(eq(sourcingForwarders.id, row.id)).returning();
      return view(updated);
    }),
    remove: (companyId: string, projectId: string, id: string) => db.transaction(async tx => {
      const row = await get(tx, companyId, projectId, id);
      await tx.delete(sourcingForwarders).where(eq(sourcingForwarders.id, row.id));
      await secretService(tx as unknown as Db).remove(row.credentialSecretId);
    }),
    open: async (companyId: string, projectId: string, id: string) => {
      await reconcile(await get(db, companyId, projectId, id));
      const row = await db.transaction(async tx => {
        await project(tx, companyId, projectId);
        // One selected Aside profile is a shared local browser resource. This
        // aggregate lock/count reveals no other company's account or credentials.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sourcing-forwarder-aside'))`);
        const current = await get(tx, companyId, projectId, id, true);
        if (!current.enabled) throw badRequest("비활성 배송대행지입니다.");
        const pending = await tx.select({ id: sourcingForwarders.id }).from(sourcingForwarders)
          .where(eq(sourcingForwarders.verificationStatus, "verifying")).limit(1);
        if (pending.length) throw conflict("배송대행지 계정의 로그인 확인이 진행 중입니다. 결과를 기다려 주세요.");
        if (current.providerId) await provider(tx, current.providerId);
        await credentials(tx, current);
        const [claimed] = await tx.update(sourcingForwarders).set({ verificationStatus: "verifying", verificationAttemptId: randomUUID(),
          verificationSessionId: null, verificationCheckedAt: new Date(), verifiedAt: null, verificationErrorCode: null })
          .where(eq(sourcingForwarders.id, current.id)).returning();
        return claimed;
      });
      active.add(row.verificationAttemptId!);
      try {
        return await finish(row, await openBrowser(await inputFor(row)));
      } catch {
        await finish(row, { status: "blocked", browser: "aside", sessionId: null, errorCode: "verification_unconfirmed" });
        throw unprocessable("Aside에서 계정을 확인하지 못했습니다. 저장한 계정과 Aside 상태를 확인해 주세요.");
      } finally { active.delete(row.verificationAttemptId!); }
    },
  };
}
