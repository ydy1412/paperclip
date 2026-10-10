import { pluginsApi } from "./plugins";
import { ApiError } from "./client";

function bridgeFailure(error: unknown): Error {
  let message="지식 서버에 연결할 수 없습니다. 연결 상태를 확인하고 다시 시도해 주세요.";
  if (error instanceof ApiError) {
    const body=error.body && typeof error.body==="object"?error.body as {code?:unknown;message?:unknown}:{};
    const detail=typeof body.message==="string"?body.message:"";
    if (error.status===401) message="로그인이 필요합니다. 다시 로그인한 뒤 확인해 주세요.";
    else if (error.status===403 || body.code==="CAPABILITY_DENIED" || body.code==="INVOCATION_SCOPE_DENIED") message="이 회사의 지식을 조회하거나 변경할 권한이 없습니다.";
    else if (detail.includes("원본 접근 권한")) message="원본 자료의 접근 권한을 확인할 수 없습니다. 권한을 확인하거나 지식을 다시 생성해 주세요.";
    else if (detail.includes("문서가 변경")) message="문서가 변경되었습니다. 새 내용을 확인한 뒤 다시 검토해 주세요.";
    else if (detail.includes("프로젝트 접근 권한")) message="선택한 프로젝트에 접근할 권한이 없습니다.";
    else if (detail.includes("지식 수집이 진행")) message="지식 수집이 진행 중입니다. 완료 후 다시 조회해 주세요.";
    else if (detail.includes("자동 수집을 켠 뒤")) message="완료 작업 자동 수집을 켠 뒤 가져와 주세요.";
    else if (body.code==="TIMEOUT") message="지식 처리 응답이 늦어지고 있습니다. 잠시 후 다시 확인해 주세요.";
  }
  return new Error(message,{cause:error});
}

export interface KnowledgePage {
  id:string;projectId:string;category:string;title:string;summary:string;body:string;bodyHash:string;
  review:"confirmed"|"pending";generationStatus:string;lastError:string|null;updatedAt:string;
  reviewLog:{actor:string;at:string;hash:string}[];
}
export interface KnowledgeList {
  items:KnowledgePage[];total:number;page:number;pageSize:number;
  projects:{id:string;name:string}[];categories:{key:string;title:string}[];
}
export interface KnowledgeStatus {
  connected:boolean;error:string|null;sourceCount:number;
  lastCollectedAt?:string|null;
  settings:{enabled:boolean;since:string;historicalProjects:string[]};
  jobs:{id:string;projectId:string;kind:string;state:string;attempts:number;error:string|null;updatedAt:string}[];
  imports?:{projectId:string;total:number;completed:number;failed:number;generating:boolean}[];
}
export interface KnowledgeSources {
  items:{id:string;issueTitle:string;projectName:string;updatedAt:string;references:{id:string;kind:string;title:string;href:string;analyzed:boolean;warning?:string}[]}[];
  label:string;
}
export interface KnowledgeHistory {
  generation:unknown;reviews:{actor:string;at:string;hash:string}[];
}
export interface KnowledgeReferences {
  items:{id:string;title:string;contentType:string;byteSize:number;href:string;analyzed:boolean;warning:string|null;issueTitle:string;checksum?:string|null;evidence?:{page:number;text:string;method:"pdf-text"|"vision"}[]}[];
}
export interface KnowledgePdfPreview {
  page:number;totalPages:number;width:number;height:number;checksum:string;imageUrl:string;
}
export interface ArtifactImports {
  items:{issueId:string;artifactId:string;state:"queued"|"processing"|"failed"|"captured";error:string|null}[];
}
export interface KnowledgeGraphData {
  nodes:{id:string;label:string;mentions:number}[];
  edges:{id:string;source:string;target:string;weight:number;kind:string}[];
  totalEntities:number;totalEdges:number;partial:boolean;
}
export interface KnowledgeUsageData {
  retrievals:number;citations:number;
  recent:{runId:string;agentId:string;agentName:string;issueId:string;issueTitle:string;kind:"retrieval"|"citation";artifactId:string|null;at:string}[];
}
export interface KnowledgeGraphDetail {
  kind:"node"|"edge";id:string;title:string;relationship:{kind:string;weight:number}|null;
  facts:{id:string;text:string;issueId:string;issueTitle:string;references:KnowledgeSources["items"][number]["references"]}[];
  pages:{id:string;title:string;projectId:string}[];partial:boolean;
}
export const knowledgeApi = {
  async read<T>(plugin:string,company:string,key:string,params:Record<string,unknown>={}) {
    try {
      const response=await pluginsApi.bridgeGetData(plugin,key,params,company);
      return response.data as T;
    } catch (error) { throw bridgeFailure(error); }
  },
  async action<T>(plugin:string,company:string,key:string,params:Record<string,unknown>={}) {
    try {
      const response=await pluginsApi.bridgePerformAction(plugin,key,params,company);
      return response.data as T;
    } catch (error) { throw bridgeFailure(error); }
  },
};
