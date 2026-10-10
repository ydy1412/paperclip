import { createAgentProfileSchema, type CreateAgentProfile } from "@paperclipai/shared";

export interface AgentProfileDraft {
  profileId: string | null;
  creating: boolean;
  baseVersion: number;
  applyToLinked: boolean;
  manualModel: boolean;
  data: CreateAgentProfile;
}

const key = (companyId: string) => `paperclip.agent-profile-draft.v1:${companyId}`;

/** Browser-only progress, scoped to the company; never creates a server profile. */
export function readAgentProfileDraft(companyId: string): AgentProfileDraft | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key(companyId)) ?? "null");
    if (!raw || raw.version !== 1 || typeof raw.creating !== "boolean"
      || !Number.isInteger(raw.baseVersion) || raw.baseVersion < 0
      || (!raw.creating && (typeof raw.profileId !== "string" || !raw.profileId || raw.baseVersion < 1))) return null;
    // An unfinished name is valid progress, even though permanent save requires it.
    if (typeof raw.data?.name !== "string" || raw.data.name.length > 100) return null;
    const data = createAgentProfileSchema.safeParse({ ...raw.data, name: raw.data.name.trim() || "임시 프로필" });
    if (!data.success) return null;
    return { profileId: raw.creating ? null : raw.profileId, creating: raw.creating,
      baseVersion: raw.baseVersion, applyToLinked: raw.applyToLinked === true,
      manualModel: raw.manualModel === true,
      data: { ...data.data, name: raw.data.name } };
  } catch { return null; }
}

export function writeAgentProfileDraft(companyId: string, draft: AgentProfileDraft): boolean {
  try {
    window.localStorage.setItem(key(companyId), JSON.stringify({ version: 1, ...draft, savedAt: new Date().toISOString() }));
    return true;
  } catch { return false; }
}

export function clearAgentProfileDraft(companyId: string): boolean {
  try { window.localStorage.removeItem(key(companyId)); return true; }
  catch { return false; }
}
