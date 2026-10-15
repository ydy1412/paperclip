import { api } from "./client";

export interface BrainVault { id: string; name: string; kind: "personal-brain" }
export interface BrainDocument {
  id: string; title: string; path: string; project: string; kind: "source" | "generated";
  updatedAt: string | null; revision: string; summary: string; content?: string;
  state: string; partial: boolean; contentType: string; byteSize: number;
  references?: BrainReference[];
}
export interface BrainReference { sourceId: string; docId: string; path: string; revision: string; project?: string; locator?: string | null }
export interface BrainLibrary { items: BrainDocument[]; total: number; page: number; pageSize: number;
  projects: { id: string; name: string }[]; counts: { all: number; source: number; generated: number }; complete: boolean }
export interface BrainAnswer { markdown: string; references: BrainReference[]; incomplete: boolean; generated: boolean }
export interface BrainRecall { items: { id: string; text: string; reference: BrainReference }[]; incomplete: boolean }
export interface BrainGraphData {
  nodes: { id: string; label: string; type: "project" | "source" | "generated" | "entity"; documentId?: string; project?: string }[];
  edges: { id: string; source: string; target: string; kind: string; weight: number }[];
  totalNodes: number; totalEdges: number; partial: boolean;
}
export interface BrainGraphDetail { title: string; kind: string; facts: { id: string; text: string; documentId: string }[]; documents: BrainDocument[]; partial: boolean }
export interface BrainStatus { connected: boolean; enabled: boolean; paused: boolean; complete: boolean; lastScan: number | null;
  sources: number; generatedNotes: number; partial: number; queue: Record<string, number>; error: string | null }
const root = (company: string) => `/companies/${encodeURIComponent(company)}/knowledge`;
export const knowledgeWorkspaceApi = {
  vaults: (company: string) => api.get<BrainVault[]>(`${root(company)}/vaults`),
  read: <T>(company: string, vault: string, tool: string, args: Record<string, unknown> = {}, signal?: AbortSignal) =>
    api.post<T>(`${root(company)}/${encodeURIComponent(vault)}/read`, { tool, arguments: args }, { signal }),
  file: (company: string, vault: string, doc: BrainDocument, download = false) =>
    `/api${root(company)}/${encodeURIComponent(vault)}/file?${new URLSearchParams({ id: doc.id, revision: doc.revision, ...(download ? { download: "1" } : {}) })}`,
};
