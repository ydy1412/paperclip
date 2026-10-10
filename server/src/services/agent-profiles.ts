import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { agentProfiles, agentProfileVersions, agentProfileBindings, agents, heartbeatRuns, companySkills, activityLog, type Db } from "@paperclipai/db";
import type { AgentProfileConfig, AgentProfileDetail, CreateAgentProfile, UpdateAgentProfile } from "@paperclipai/shared";
import { readPaperclipSkillSyncPreference, writePaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { agentService } from "./agents.js";
import { agentInstructionRevisionService } from "./agent-instruction-revisions.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { withAgentStartLock } from "./agent-start-lock.js";
import { findActiveServerAdapter } from "../adapters/registry.js";
import { agentProfileConfigSchema } from "@paperclipai/shared";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function audit(tx: Tx, companyId: string, userId: string, action: string, id: string, details: Record<string, unknown> = {}) {
  return tx.insert(activityLog).values({ companyId, actorType: "user", actorId: userId, responsibleUserId: userId, action, entityType: "agent_profile", entityId: id, details });
}

export function agentProfileService(db: Db) {
  async function requireProfile(source: Db | Tx, companyId: string, id: string, lock = false) {
    const query = source.select().from(agentProfiles).where(and(eq(agentProfiles.companyId, companyId), eq(agentProfiles.id, id)));
    const [row] = await (lock ? query.for("update") : query);
    if (!row) throw notFound("에이전트 프로필을 찾을 수 없습니다.");
    return row;
  }
  async function validateConfig(source: Db | Tx, companyId: string, config: AgentProfileConfig) {
    config = agentProfileConfigSchema.parse(config);
    if (!findActiveServerAdapter(config.adapterType)?.supportsInstructionsBundle) throw badRequest("작업 지침을 지원하는 실행 방식을 선택해 주세요.");
    const keys = [...new Set(config.skills)];
    if (keys.length) {
      const rows = await source.select({ key: companySkills.key }).from(companySkills).where(and(eq(companySkills.companyId, companyId), inArray(companySkills.key, keys)));
      if (rows.length !== keys.length) throw badRequest("이 회사에 등록된 스킬을 선택해 주세요.");
    }
    return { ...config, skills: keys };
  }
  async function get(companyId: string, id: string): Promise<AgentProfileDetail> {
    const profile = await requireProfile(db, companyId, id);
    const [versions, bindings] = await Promise.all([
      db.select().from(agentProfileVersions).where(and(eq(agentProfileVersions.companyId, companyId), eq(agentProfileVersions.profileId, id))).orderBy(desc(agentProfileVersions.version)),
      db.select({ agentId: agents.id, name: agents.name, status: agents.status, appliedVersion: agentProfileBindings.appliedVersion, pendingVersion: agentProfileBindings.pendingVersion, overrides: agentProfileBindings.overrides, error: agentProfileBindings.error })
        .from(agentProfileBindings).innerJoin(agents, and(eq(agents.id, agentProfileBindings.agentId), eq(agents.companyId, companyId)))
        .where(and(eq(agentProfileBindings.companyId, companyId), eq(agentProfileBindings.profileId, id))).orderBy(asc(agents.name)),
    ]);
    return { ...profile, config: agentProfileConfigSchema.parse(profile.config), linkedCount: bindings.length, bindings, versions: versions.map(v => ({ version: v.version, name: v.name, description: v.description, config: agentProfileConfigSchema.parse(v.config), createdAt: v.createdAt.toISOString() })) };
  }
  async function create(companyId: string, input: CreateAgentProfile, userId: string) {
    const id = await db.transaction(async tx => {
      const config = await validateConfig(tx, companyId, input.config);
      const [row] = await tx.insert(agentProfiles).values({ companyId, name: input.name, description: input.description, config }).returning();
      await tx.insert(agentProfileVersions).values({ companyId, profileId: row.id, version: 1, name: row.name, description: row.description, config });
      await audit(tx, companyId, userId, "agent.profile_created", row.id, { version: 1 });
      return row.id;
    });
    return get(companyId, id);
  }
  async function update(companyId: string, id: string, input: UpdateAgentProfile, userId: string) {
    const linked = await db.transaction(async tx => {
      const old = await requireProfile(tx, companyId, id, true);
      if (old.version !== input.expectedVersion) throw conflict("프로필이 변경되었습니다. 새로 조회한 뒤 수정해 주세요.");
      const config = await validateConfig(tx, companyId, input.config);
      const version = old.version + 1;
      await tx.update(agentProfiles).set({ name: input.name, description: input.description, config, version, updatedAt: new Date() }).where(eq(agentProfiles.id, id));
      await tx.insert(agentProfileVersions).values({ companyId, profileId: id, version, name: input.name, description: input.description, config });
      const rows = input.applyToLinked ? await tx.update(agentProfileBindings).set({ pendingVersion: version, requestedByUserId: userId, error: null, updatedAt: new Date() })
        .where(and(eq(agentProfileBindings.companyId, companyId), eq(agentProfileBindings.profileId, id))).returning({ agentId: agentProfileBindings.agentId }) : [];
      await audit(tx, companyId, userId, "agent.profile_updated", id, { version, applyToLinked: input.applyToLinked, linkedCount: rows.length });
      return rows;
    });
    for (const row of linked) await withAgentStartLock(row.agentId, () => applyPending(row.agentId));
    return get(companyId, id);
  }
  async function bind(companyId: string, profileId: string, version: number, agentId: string, userId: string) {
    await db.transaction(async tx => {
      const profile = await requireProfile(tx, companyId, profileId, true);
      const [snapshot] = await tx.select().from(agentProfileVersions).where(and(eq(agentProfileVersions.companyId, companyId), eq(agentProfileVersions.profileId, profileId), eq(agentProfileVersions.version, version)));
      const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
      const [existing] = await tx.select().from(agentProfileBindings).where(eq(agentProfileBindings.agentId, agentId));
      if (existing) throw conflict("이 에이전트는 이미 다른 프로필에 연결되어 있습니다.");
      if (!snapshot || !agent) throw notFound("프로필 또는 에이전트를 찾을 수 없습니다.");
      if (agent.adapterType !== snapshot.config.adapterType) throw conflict("프로필과 에이전트의 실행 방식이 다릅니다.");
      await tx.insert(agentProfileBindings).values({ companyId, profileId: profile.id, agentId, appliedVersion: version, baseline: agentProfileConfigSchema.parse(snapshot.config), requestedByUserId: userId });
      await audit(tx, companyId, userId, "agent.profile_linked", profileId, { agentId, version });
    });
  }
  // Caller owns the existing agent start lock. Durable bindings survive restarts;
  // active runs and approval-pending agents retain their current configuration.
  async function applyPending(agentId: string) {
    try {
      return await db.transaction(async tx => {
        const [binding] = await tx.select().from(agentProfileBindings).where(eq(agentProfileBindings.agentId, agentId)).for("update");
        // Let normal scheduling continue when this agent has no profile work
        // pending. A deferred or failed propagation must hold the next run so
        // it cannot start with a stale profile revision.
        if (!binding?.pendingVersion) return true;
        const [agent] = await tx.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.companyId, binding.companyId))).for("update");
        if (!agent || agent.status === "pending_approval" || agent.status === "terminated") return false;
        const [running] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "running"))).limit(1);
        if (running) return false;
        const [version] = await tx.select().from(agentProfileVersions).where(and(eq(agentProfileVersions.companyId, binding.companyId), eq(agentProfileVersions.profileId, binding.profileId), eq(agentProfileVersions.version, binding.pendingVersion)));
        if (!version || !binding.requestedByUserId) throw conflict("적용할 프로필 버전 또는 수정자를 확인해 주세요.");
        const actor: AuthorizationActor = { type: "board", userId: binding.requestedByUserId, source: "board_key" };
        const decision = await authorizationService(tx as unknown as Db).decide({ actor, action: "agent_config:update", resource: { type: "agent", companyId: binding.companyId, agentId }, scope: { targetAgentId: agentId } });
        if (!decision.allowed) throw forbidden("프로필 수정자의 에이전트 변경 권한을 확인해 주세요.");
        const next = await validateConfig(tx, binding.companyId, version.config);
        if (next.adapterType !== agent.adapterType) throw conflict("실행 방식이 달라 적용하지 않았습니다. 에이전트의 연결 설정을 확인해 주세요.");
        const runtimeProvider = agent.adapterConfig.provider === "acpx" ? agent.adapterConfig.acpxAgent ?? "claude" : agent.adapterConfig.provider ?? "codex";
        if (agent.adapterType === "paperclip_runner" && runtimeProvider !== next.runnerProvider) throw conflict("프로필의 실행 제공자가 다릅니다. 연결 설정을 확인해 주세요.");
        const old = agentProfileConfigSchema.parse(binding.baseline), overrides: string[] = [];
        const patch: Partial<typeof agents.$inferInsert> = {};
        for (const key of ["capabilities"] as const) {
          if (same(agent[key] ?? "", old[key])) patch[key] = next[key]; else overrides.push(key);
        }
        let config = { ...agent.adapterConfig };
        if (same(config.model ?? "", old.model)) {
          if (next.model) config.model = next.model; else delete config.model;
        } else overrides.push("model");
        const selections = readPaperclipSkillSyncPreference(config).desiredSkills;
        if (same([...selections].sort(), [...old.skills].sort())) config = writePaperclipSkillSyncPreference(config, next.skills); else overrides.push("skills");
        const revisions = agentInstructionRevisionService(tx as unknown as Db);
        const head = await revisions.readCommittedForRuntime({ companyId: agent.companyId, agentId });
        if (same(head?.content ?? "", old.instructions)) {
          if (next.instructions !== (head?.content ?? "")) await revisions.commit({ companyId: agent.companyId, agentId, entryFile: head?.revision.entryFile ?? "AGENTS.md", content: next.instructions, baseRevisionId: head?.revision.id ?? null, source: "board" }, actor);
        } else overrides.push("instructions");
        // The instruction commit may initialize managed bundle metadata. Preserve it.
        const [fresh] = await tx.select().from(agents).where(eq(agents.id, agentId));
        patch.adapterConfig = { ...fresh.adapterConfig, ...config };
        if (same(agent.adapterConfig.model ?? "", old.model) && !next.model) delete patch.adapterConfig.model;
        await agentService(tx as unknown as Db).update(agentId, patch, { recordRevision: { createdByUserId: binding.requestedByUserId, source: "agent_profile" } });
        await tx.update(agentProfileBindings).set({ appliedVersion: version.version, pendingVersion: null, baseline: next, overrides, error: null, updatedAt: new Date() }).where(eq(agentProfileBindings.agentId, agentId));
        await audit(tx, binding.companyId, binding.requestedByUserId, "agent.profile_applied", binding.profileId, { agentId, version: version.version, overrides });
        return true;
      });
    } catch (error) {
      // No source/credential/config content enters this public error field.
      const message = error instanceof Error && /프로필|권한|스킬|실행 방식/.test(error.message) ? error.message : "프로필 반영에 실패했습니다. 에이전트 설정을 확인한 뒤 다시 반영해 주세요.";
      await db.update(agentProfileBindings).set({ error: message, updatedAt: new Date() }).where(eq(agentProfileBindings.agentId, agentId));
      return false;
    }
  }
  return {
    get, create, update, bind, applyPending,
    fromAgent: async (companyId: string, agentId: string, actor: AuthorizationActor) => {
      const agent = await agentService(db).getById(agentId);
      if (!agent || agent.companyId !== companyId) throw notFound("에이전트를 찾을 수 없습니다.");
      const [existing] = await db.select().from(agentProfileBindings).where(eq(agentProfileBindings.agentId, agentId));
      if (existing) throw conflict("이 에이전트는 이미 프로필에 연결되어 있습니다.");
      const decision = await authorizationService(db).decide({ actor, action: "agent_config:read", resource: { type: "agent", companyId, agentId } });
      if (!decision.allowed || !actor.userId) throw forbidden("에이전트 설정 조회 권한을 확인해 주세요.");
      const head = await agentInstructionRevisionService(db).readCurrent({ companyId, agentId }, actor);
      const config = agentProfileConfigSchema.parse({ capabilities: agent.capabilities ?? "", adapterType: agent.adapterType,
        runnerProvider: agent.adapterConfig.provider === "acpx" ? agent.adapterConfig.acpxAgent ?? "claude" : agent.adapterConfig.provider ?? "codex", model: typeof agent.adapterConfig.model === "string" ? agent.adapterConfig.model : "", skills: readPaperclipSkillSyncPreference(agent.adapterConfig).desiredSkills, instructions: head?.content ?? "" });
      const profile = await create(companyId, { name: `${agent.name} 프로필`, description: agent.title ?? agent.capabilities?.slice(0, 300) ?? "", config }, actor.userId);
      await bind(companyId, profile.id, profile.version, agent.id, actor.userId);
      return get(companyId, profile.id);
    },
    list: async (companyId: string) => (await db.select({ id: agentProfiles.id, companyId: agentProfiles.companyId, name: agentProfiles.name, description: agentProfiles.description, version: agentProfiles.version, config: agentProfiles.config,
      linkedCount: sql<number>`(select count(*)::int from agent_profile_bindings b where b.profile_id = ${agentProfiles.id} and b.company_id = ${agentProfiles.companyId})` }).from(agentProfiles).where(eq(agentProfiles.companyId, companyId)).orderBy(asc(agentProfiles.name)))
      .map(row => ({ ...row, config: agentProfileConfigSchema.parse(row.config) })),
    restore: async (companyId: string, id: string, input: { version: number; expectedVersion: number; applyToLinked: boolean }, userId: string) => {
      const [v] = await db.select().from(agentProfileVersions).where(and(eq(agentProfileVersions.companyId, companyId), eq(agentProfileVersions.profileId, id), eq(agentProfileVersions.version, input.version)));
      if (!v) throw notFound("복원할 버전을 찾을 수 없습니다.");
      return update(companyId, id, { name: v.name, description: v.description, config: v.config, expectedVersion: input.expectedVersion, applyToLinked: input.applyToLinked }, userId);
    },
    remove: (companyId: string, id: string, expectedVersion: number, userId: string) => db.transaction(async tx => {
      const profile = await requireProfile(tx, companyId, id, true);
      if (profile.version !== expectedVersion) throw conflict("프로필이 변경되었습니다. 다시 조회해 주세요.");
      await tx.delete(agentProfiles).where(eq(agentProfiles.id, id));
      await audit(tx, companyId, userId, "agent.profile_deleted", id);
    }),
  };
}
