import { api } from "./client";
import { issuesApi } from "./issues";
import type {
  CompanyArtifact,
  FolderListResult,
  CompanyArtifactGroupBy,
  CompanyArtifactMediaKind,
  CompanyArtifactsResponse,
} from "@paperclipai/shared";

export type {
  CompanyArtifact,
  CompanyArtifactGroup,
  CompanyArtifactGroupBy as ArtifactGroupBy,
  CompanyArtifactMediaKind as ArtifactMediaKind,
  CompanyArtifactsResponse,
  CompanyArtifactSource as ArtifactSource,
} from "@paperclipai/shared";

/**
 * Company-level Artifacts client (PAP-10359).
 *
 * Talks to the company-scoped artifacts projection endpoint
 * (`GET /api/companies/:companyId/artifacts`) defined by the approved
 * Artifacts plan (PAP-10353). The endpoint flattens agent-produced issue
 * documents, direct attachments, and `artifact` work products into a single
 * card-ready list so the UI never has to stitch issue-specific endpoints
 * together.
 *
 * The `CompanyArtifact` shape is imported from `@paperclipai/shared` so the
 * frontend and server stay synchronized as the contract evolves.
 */

export type ArtifactKindFilter = Exclude<CompanyArtifactMediaKind, "empty"> | "all";

export interface ListArtifactsParams {
  kind?: ArtifactKindFilter;
  projectId?: string;
  folderId?: string;
  /** Only artifacts attributed to this agent. */
  agentId?: string;
  q?: string;
  /** Grouping mode. `none` (default) returns the flat artifact grid. */
  groupBy?: CompanyArtifactGroupBy;
  /** When grouping, selects a single stack to expand into its artifacts. */
  groupIssueId?: string;
  limit?: number;
  cursor?: string;
}

function buildArtifactsQuery(params?: ListArtifactsParams): string {
  const search = new URLSearchParams();
  if (params?.kind && params.kind !== "all") search.set("kind", params.kind);
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.folderId) search.set("folderId", params.folderId);
  if (params?.agentId) search.set("agentId", params.agentId);
  if (params?.q) search.set("q", params.q);
  if (params?.groupBy && params.groupBy !== "none") search.set("groupBy", params.groupBy);
  if (params?.groupIssueId) search.set("groupIssueId", params.groupIssueId);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Normalize the endpoint response. The contract is an envelope
 * (`{ artifacts, groups?, selectedGroup?, nextCursor }`), but we also tolerate a
 * bare array so the page keeps working if the backend ships the simpler shape.
 */
function normalizeArtifactsResponse(
  raw: CompanyArtifactsResponse | CompanyArtifact[],
): CompanyArtifactsResponse {
  if (Array.isArray(raw)) {
    return { artifacts: raw, nextCursor: null };
  }
  return {
    artifacts: raw.artifacts ?? [],
    groups: raw.groups,
    selectedGroup: raw.selectedGroup,
    nextCursor: raw.nextCursor ?? null,
  };
}

export const artifactsApi = {
  folders:async(companyId:string)=>(await api.get<FolderListResult>(`/companies/${companyId}/folders?kind=artifact`)).folders,
  moveToFolder:(companyId:string,artifactId:string,folderId:string|null)=>api.put<{artifactId:string;folderId:string|null}>(`/companies/${companyId}/artifact-folder-entry`,{artifactId,folderId}),
  remove: async (artifact: CompanyArtifact, deleteFile = false): Promise<void> => {
    const prefix=`${artifact.source}:`;
    if (!artifact.id.startsWith(prefix) || !artifact.id.slice(prefix.length)) {
      throw new Error("자료 식별자가 올바르지 않습니다. 목록을 다시 조회하세요.");
    }
    const id=artifact.id.slice(prefix.length);
    if (artifact.source === "document") {
      const documents=await issuesApi.listDocuments(artifact.issue.id,{includeSystem:true});
      const document=documents.find(item=>item.id===id);
      if (!document) throw new Error("문서를 찾을 수 없습니다. 목록을 다시 조회하세요.");
      await issuesApi.deleteDocument(artifact.issue.id,document.key);
    } else if (artifact.source === "attachment") {
      await issuesApi.deleteAttachment(id);
    } else {
      const products=await issuesApi.listWorkProducts(artifact.issue.id);
      const product=products.find(item=>item.id===id);
      if (!product) throw new Error("결과물을 찾을 수 없습니다. 목록을 다시 조회하세요.");
      if (deleteFile && typeof product.metadata?.attachmentId === "string") {
        const attachments=await issuesApi.listAttachments(artifact.issue.id);
        if (attachments.some(item=>item.id===product.metadata!.attachmentId)) {
          await issuesApi.deleteAttachment(product.metadata.attachmentId);
        }
      }
      await issuesApi.deleteWorkProduct(id);
    }
  },
  list: async (companyId: string, params?: ListArtifactsParams): Promise<CompanyArtifactsResponse> => {
    const raw = await api.get<CompanyArtifactsResponse | CompanyArtifact[]>(
      `/companies/${companyId}/artifacts${buildArtifactsQuery(params)}`,
    );
    return normalizeArtifactsResponse(raw);
  },
};
