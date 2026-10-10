import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { companySecrets, projects, sourcingForwarders, sourcingForwarderProviders, type Db } from "@paperclipai/db";
import type { CreateSourcingForwarder, UpdateSourcingForwarder, SourcingForwarder } from "@paperclipai/shared";
import { badRequest, notFound, unprocessable } from "../errors.js";
import { secretService } from "./secrets.js";
import { supportsForwarderLogin, type ForwarderBrowserOpen } from "./sourcing-forwarder-browser.js";

type Row = typeof sourcingForwarders.$inferSelect;
const view = (row: Row, configured = true): SourcingForwarder => ({ id: row.id, companyId: row.companyId, projectId: row.projectId,
  name: row.name, providerId: row.providerId, homepageUrl: row.homepageUrl, loginUrl: row.loginUrl, enabled: row.enabled,
  credentialConfigured: configured, automaticLogin: supportsForwarderLogin(row.loginUrl) });
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function sourcingForwarderService(db: Db, openBrowser: ForwarderBrowserOpen) {
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
  async function get(source: Db | Transaction, companyId: string, projectId: string, id: string) {
    await project(source, companyId, projectId);
    const [row] = await source.select().from(sourcingForwarders).where(and(eq(sourcingForwarders.companyId, companyId), eq(sourcingForwarders.projectId, projectId), eq(sourcingForwarders.id, id)));
    if (!row) throw notFound("배송대행지를 찾을 수 없습니다.");
    return row;
  }
  return {
    providers: async (companyId: string, projectId: string) => {
      await project(db, companyId, projectId);
      return db.select({ id: sourcingForwarderProviders.id, name: sourcingForwarderProviders.name, homepageUrl: sourcingForwarderProviders.homepageUrl, loginUrl: sourcingForwarderProviders.loginUrl }).from(sourcingForwarderProviders)
        .where(and(eq(sourcingForwarderProviders.enabled, true))).orderBy(asc(sourcingForwarderProviders.name));
    },
    list: async (companyId: string, projectId: string) => {
      await project(db, companyId, projectId);
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
      const [updated] = await tx.update(sourcingForwarders).set({ name: row.providerId === selected.id ? row.name : selected.name, providerId: selected.id, homepageUrl: selected.homepageUrl,
        loginUrl: selected.loginUrl, enabled: input.enabled, credentialVersion, updatedAt: new Date() }).where(eq(sourcingForwarders.id, row.id)).returning();
      return view(updated);
    }),
    remove: (companyId: string, projectId: string, id: string) => db.transaction(async tx => {
      const row = await get(tx, companyId, projectId, id);
      await tx.delete(sourcingForwarders).where(eq(sourcingForwarders.id, row.id));
      await secretService(tx as unknown as Db).remove(row.credentialSecretId);
    }),
    open: async (companyId: string, projectId: string, id: string) => {
      const row = await get(db, companyId, projectId, id);
      if (!row.enabled) throw badRequest("비활성 배송대행지입니다.");
      if (row.providerId) await provider(db, row.providerId);
      let credentials = { loginId: "", password: "" };
      if (supportsForwarderLogin(row.loginUrl)) {
        try {
          // Pin the version read with this URL. Concurrent edits must not send a new site's password to an old URL.
          const saved: unknown = JSON.parse(await secretService(db).resolveSecretValue(companyId, row.credentialSecretId, row.credentialVersion));
          if (!saved || typeof saved !== "object" || !("loginId" in saved) || !("password" in saved)
            || typeof saved.loginId !== "string" || typeof saved.password !== "string" || !saved.loginId || !saved.password) throw new Error("Invalid credential shape");
          credentials = { loginId: saved.loginId, password: saved.password };
        } catch { throw unprocessable("저장한 로그인 계정을 사용할 수 없습니다. 배송대행지 설정에서 계정을 다시 입력해 주세요."); }
      }
      return openBrowser({ id: row.id, companyId, loginUrl: row.loginUrl, credentials });
    },
  };
}
