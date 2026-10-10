/** Compatibility bridge ONLY for the installed 2026.1001.0 instructions API.
 * Current source uses agent-instruction-revisions. The deployment assembler
 * selects this bridge for the older server; it never replaces a core module.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { agents, type Db } from "@paperclipai/db";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { agentInstructionsService } from "./agent-instructions.js";
import { agentService } from "./agents.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";

const hash = (content: string) => createHash("sha256").update(content).digest("hex");
type Undo = { file: string; previous: string | null; writtenHash: string };
const transactions = new AsyncLocalStorage<Undo[]>();
export async function legacyProfileInstructionTransaction<T>(db: Db, operation: Parameters<Db["transaction"]>[0]): Promise<T> {
  const undo: Undo[] = [];
  return transactions.run(undo, async () => {
    try { return await db.transaction(operation) as T; }
    catch (error) {
      for (const saved of undo.reverse()) {
        const current = await fs.readFile(saved.file, "utf8").catch(() => null);
        // Never overwrite a subsequent independent edit while compensating.
        if (current === null || hash(current) !== saved.writtenHash) continue;
        if (saved.previous === null) await fs.rm(saved.file, { force: true });
        else await fs.writeFile(saved.file, saved.previous, "utf8");
      }
      throw error;
    }
  });
}
export function legacyAgentProfileInstructions(db: Db) {
  const bundles = agentInstructionsService();
  async function target(companyId: string, agentId: string, actor?: AuthorizationActor, write = false) {
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.companyId, companyId))).for("update");
    if (!agent) throw notFound("Agent not found");
    if (actor) {
      const decision = await authorizationService(db).decide({ actor, action: write ? "agent_config:update" : "agent_config:read", resource: { type: "agent", companyId, agentId } });
      if (!decision.allowed) throw forbidden("에이전트 지침 변경 권한을 확인해 주세요.");
    }
    return agent;
  }
  async function read(input: { companyId: string; agentId: string }, actor?: AuthorizationActor) {
    const agent = await target(input.companyId, input.agentId, actor);
    const bundle = await bundles.getBundle(agent);
    try {
      const file = await bundles.readFile(agent, bundle.entryFile);
      return { content: file.content, revision: { id: hash(file.content), entryFile: bundle.entryFile } };
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 404) return null;
      throw error;
    }
  }
  return {
    readCurrent: read,
    readCommittedForRuntime: (input: { companyId: string; agentId: string }) => read(input),
    commit: async (input: { companyId: string; agentId: string; entryFile: string; content: string; baseRevisionId: string | null }, actor: AuthorizationActor) => {
      const undo = transactions.getStore();
      if (!undo) throw unprocessable("Legacy profile instructions require an atomic profile transaction");
      const agent = await target(input.companyId, input.agentId, actor, true);
      const bundle = await bundles.getBundle(agent);
      if (bundle.mode === "external") throw unprocessable("외부 지침은 프로필에서 변경하지 않습니다. 에이전트의 관리형 지침 설정을 확인해 주세요.");
      const current = await read(input);
      if ((current?.revision.id ?? null) !== input.baseRevisionId) throw conflict("프로필 지침이 변경되었습니다. 다시 조회해 주세요.");
      if (bundle.entryFile !== input.entryFile) throw conflict("프로필 지침 파일이 변경되었습니다.");
      const result = await bundles.writeFile(agent, input.entryFile, input.content);
      if (!result.bundle.rootPath) throw unprocessable("Instructions root unavailable");
      undo.push({ file: path.join(result.bundle.rootPath, input.entryFile), previous: current?.content ?? null, writtenHash: hash(input.content) });
      await agentService(db).update(agent.id, { adapterConfig: result.adapterConfig }, { recordRevision: { createdByUserId: actor.userId, source: "agent_profile_instructions" } });
      return { content: input.content, revision: { id: hash(input.content), entryFile: input.entryFile } };
    },
  };
}
