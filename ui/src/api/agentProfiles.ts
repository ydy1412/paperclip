import type { AgentProfile, AgentProfileDetail, CreateAgentProfile, UpdateAgentProfile } from "@paperclipai/shared";
import { api, requestResponse } from "./client";
const path = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/agent-profiles`;
export const agentProfilesApi = {
  list: (companyId: string) => api.get<AgentProfile[]>(path(companyId)),
  get: (companyId: string, id: string) => api.get<AgentProfileDetail>(`${path(companyId)}/${encodeURIComponent(id)}`),
  create: (companyId: string, input: CreateAgentProfile) => api.post<AgentProfileDetail>(path(companyId), input),
  fromAgent: (companyId: string, agentId: string) => api.post<AgentProfileDetail>(`${path(companyId)}/from-agent`, { agentId }),
  update: (companyId: string, id: string, input: UpdateAgentProfile) => api.patch<AgentProfileDetail>(`${path(companyId)}/${encodeURIComponent(id)}`, input),
  restore: (companyId: string, id: string, input: { expectedVersion: number; version: number; applyToLinked: boolean }) => api.post<AgentProfileDetail>(`${path(companyId)}/${encodeURIComponent(id)}/restore`, input),
  remove: (companyId: string, id: string, expectedVersion: number) => requestResponse(`${path(companyId)}/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ expectedVersion }) }),
};
