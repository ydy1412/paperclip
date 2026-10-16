import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { companies, projects, companyMemberships, instanceUserRoles, sourcingCaptureConnections, type Db } from "@paperclipai/db";
import { forbidden, HttpError, notFound } from "../errors.js";
import { pluginRegistryService } from "./plugin-registry.js";
import { autoSourcingPluginService } from "./auto-sourcing-plugin.js";
import { captureRequestSchema, captureResultSchema } from "./sourcing-capture-contract.js";
import { logActivity } from "./activity-log.js";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const publicRow = (row: typeof sourcingCaptureConnections.$inferSelect) => ({ id: row.id, name: row.name, createdAt: row.createdAt, expiresAt: row.expiresAt, lastUsedAt: row.lastUsedAt, revokedAt: row.revokedAt });
export function sourcingCaptureService(db: Db, options: { processingPort?: number; allowLocalBoard?: boolean } = {}) {
  const rate = new Map<string, { at: number; count: number }>();
  async function project(companyId: string, projectId: string) {
    const [row] = await db.select({ id: projects.id }).from(projects).innerJoin(companies, eq(companies.id, projects.companyId))
      .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId), isNull(projects.archivedAt), eq(companies.status, "active")));
    if (!row) throw forbidden("사용 가능한 프로젝트가 아닙니다.");
  }
  async function plugin(companyId: string, projectId: string) {
    await project(companyId, projectId);
    const registry = pluginRegistryService(db);
    const found = (await registry.list()).find(p => p.pluginKey === "paperclipai.plugin-auto-sourcing" && p.status === "ready");
    const config = found && (await registry.getConfig(found.id, companyId))?.configJson;
    if (!found || !config?.projects || typeof config.projects !== "object" || !Object.hasOwn(config.projects, projectId))
      throw forbidden("프로젝트의 Auto Sourcing 연결을 확인해 주세요.");
    return found;
  }
  async function owner(row: Pick<typeof sourcingCaptureConnections.$inferSelect, "localBoard" | "userId" | "companyId">) {
    if (row.localBoard) { if (!options.allowLocalBoard) throw forbidden("수집 연결을 다시 만들어 주세요."); return; }
    const [admin] = await db.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(and(eq(instanceUserRoles.userId, row.userId), eq(instanceUserRoles.role, "instance_admin")));
    if (admin) return;
    const [membership] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, row.companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, row.userId), eq(companyMemberships.status, "active")));
    if (!membership || membership.membershipRole === "viewer") throw forbidden("수집 연결 소유자의 권한을 확인해 주세요.");
  }
  return {
    async list(companyId: string, projectId: string, userId: string) {
      await project(companyId, projectId);
      return (await db.select().from(sourcingCaptureConnections).where(and(eq(sourcingCaptureConnections.companyId, companyId), eq(sourcingCaptureConnections.projectId, projectId), eq(sourcingCaptureConnections.userId, userId)))).map(publicRow);
    },
    async create(companyId: string, projectId: string, userId: string, localBoard: boolean, name: string) {
      await plugin(companyId, projectId);
      if (localBoard && !options.allowLocalBoard) throw forbidden("인증된 운영자로 연결해 주세요.");
      await owner({ companyId, userId, localBoard });
      const token = `dvc_${randomBytes(32).toString("base64url")}`;
      const [row] = await db.insert(sourcingCaptureConnections).values({ companyId, projectId, userId, localBoard, name,
        tokenHash: hash(token), expiresAt: new Date(Date.now() + 365 * 86400_000) }).returning();
      return { ...publicRow(row), token };
    },
    async revoke(companyId: string, projectId: string, userId: string, id: string) {
      const [row] = await db.update(sourcingCaptureConnections).set({ revokedAt: new Date() }).where(and(eq(sourcingCaptureConnections.id, id), eq(sourcingCaptureConnections.companyId, companyId), eq(sourcingCaptureConnections.projectId, projectId), eq(sourcingCaptureConnections.userId, userId))).returning({ id: sourcingCaptureConnections.id });
      if (!row) throw notFound("수집 연결을 찾지 못했습니다.");
    },
    async capture(authorization: string | undefined, value: unknown) {
      if (!authorization || !/^Bearer dvc_[A-Za-z0-9_-]{43}$/.test(authorization)) throw new HttpError(401, "수집 연결키가 필요합니다.");
      const [row] = await db.select().from(sourcingCaptureConnections).where(and(eq(sourcingCaptureConnections.tokenHash, hash(authorization.slice(7))), isNull(sourcingCaptureConnections.revokedAt), gt(sourcingCaptureConnections.expiresAt, new Date())));
      if (!row) throw new HttpError(401, "수집 연결이 만료되었거나 해제됐습니다.");
      await owner(row);
      const now = Date.now();
      for (const [id, window] of rate) if (now - window.at >= 60_000) rate.delete(id);
      const window = rate.get(row.id) ?? { at: now, count: 0 }; rate.set(row.id, window);
      if (++window.count > 20) throw new HttpError(429, "잠시 후 다시 보내 주세요.");
      const input = captureRequestSchema.parse(value);
      const found = await plugin(row.companyId, row.projectId);
      const result = captureResultSchema.parse(await autoSourcingPluginService(db, found.id, options).captureProduct(
        { ...input, companyId: row.companyId, projectId: row.projectId }, { invocationScope: { companyId: row.companyId } }));
      if (result.sourceProvider !== input.snapshot.provider || result.sourceProductId !== input.snapshot.productId)
        throw new HttpError(502, "저장된 상품 식별자를 확인하지 못했습니다.");
      // Revocation and company access are rechecked before acknowledging an external write.
      const [current] = await db.select().from(sourcingCaptureConnections).where(and(eq(sourcingCaptureConnections.id, row.id), isNull(sourcingCaptureConnections.revokedAt), gt(sourcingCaptureConnections.expiresAt, new Date())));
      if (!current) throw new HttpError(401, "수집 연결이 해제됐습니다. 저장 여부를 확인해 주세요.");
      await owner(current); await project(row.companyId, row.projectId);
      await db.update(sourcingCaptureConnections).set({ lastUsedAt: new Date() }).where(eq(sourcingCaptureConnections.id, row.id));
      await logActivity(db, { companyId: row.companyId, actorType: "user", actorId: row.userId,
        action: "sourcing.browser_capture_received", entityType: "project", entityId: row.projectId,
        details: { connectionId: row.id, status: result.status, sourceProvider: result.sourceProvider, sourceProductId: result.sourceProductId } });
      return result;
    },
  };
}
