import path from "node:path";
import { mkdir, chmod } from "node:fs/promises";
import { and, eq, like, ne, isNull } from "drizzle-orm";
import { companySecrets, companyMemberships, projects, type Db } from "@paperclipai/db";
import { createApp, type CredentialVault, type DobiWorkspace } from "@paperclipai/dobi-orders";
import { secretService } from "./secrets.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { notFound } from "../errors.js";

/** The host owns authorization and secrets; Dobi owns all order behavior and persistence. */
export async function createDobiCredentialVault(db: Db, companyId: string, projectId: string): Promise<CredentialVault> {
  const prefix = `dobi-orders-${projectId}-`;
  const rows = await db.select({ id: companySecrets.id, name: companySecrets.name, version: companySecrets.latestVersion })
    .from(companySecrets).where(and(eq(companySecrets.companyId, companyId), like(companySecrets.name, `${prefix}%`), ne(companySecrets.status, "deleted")));
  const refs = new Map(rows.map(row => [row.name.slice(prefix.length), row]));
  const secrets = secretService(db);
  return {
    has: id => refs.has(id),
    async set(id, credentials) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid credential reference");
      const previous = refs.get(id);
      const row = previous ? await secrets.rotate(previous.id, { value: JSON.stringify(credentials) })
        : await secrets.create(companyId, { name: `${prefix}${id}`, provider: "local_encrypted", value: JSON.stringify(credentials) });
      refs.set(id, { id: row.id, name: row.name, version: row.latestVersion });
    },
    async get(id) {
      const row = refs.get(id);
      if (!row) throw new Error("저장한 인증 정보를 확인해주세요.");
      return JSON.parse(await secrets.resolveSecretValue(companyId, row.id, row.version)) as Record<string, string>;
    },
    async remove(id) {
      const row = refs.get(id);
      if (row) { await secrets.remove(row.id); refs.delete(id); }
    },
  };
}

export interface DobiOrdersOptions {
  dataRoot?: string;
  vault?: CredentialVault;
  integrations?: { fetchImpl: typeof fetch; resolveHost: false };
}

export function dobiOrdersService(db: Db, options: DobiOrdersOptions = {}) {
  const workspaces = new Map<string, Promise<DobiWorkspace>>();
  async function assertProject(companyId: string, projectId: string) {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId), isNull(projects.archivedAt)));
    if (!project) throw notFound("사용 가능한 프로젝트가 없습니다.");
  }
  return {
    assertProject,
    async workspace(companyId: string, projectId: string, baseUrl: string) {
      await assertProject(companyId, projectId);
      const key = `${companyId}:${projectId}`;
      let pending = workspaces.get(key);
      if (!pending) {
        pending = (async () => {
          const directory = path.join(options.dataRoot ?? path.join(resolvePaperclipInstanceRoot(), "dobi-orders"), companyId, projectId);
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const app = await createApp({ hosted: true, dataRoot: directory, dbPath: path.join(directory, "orders.sqlite"),
            ...options.integrations,
            vault: options.vault ?? await createDobiCredentialVault(db, companyId, projectId), bridgeBase: baseUrl,
            authorizeBridge: async ownerId => {
              const [membership] = await db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
                eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
                eq(companyMemberships.principalId, ownerId), eq(companyMemberships.status, "active")));
              return !!membership;
            } });
          await chmod(path.join(directory, "orders.sqlite"), 0o600);
          return app;
        })();
        workspaces.set(key, pending);
        pending.catch(() => { if (workspaces.get(key) === pending) workspaces.delete(key); });
      }
      return pending;
    },
    async close() { for (const pending of workspaces.values()) await (await pending).close(); workspaces.clear(); },
  };
}
