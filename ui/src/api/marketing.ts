import type { MarketingOverview, MarketingProfile, MarketingChannel, MarketingDraft, MarketingPublishJob, MarketingMediaChoice, CreateMarketingProfile, UpdateMarketingProfile, CreateMarketingChannel, UpdateMarketingChannel, CreateMarketingDraft, UpdateMarketingDraft, QueueMarketingDrafts } from "@paperclipai/shared";
import { api } from "./client";
import type { MarketingBrowserProfile } from "@paperclipai/shared";
import type { MarketingConnectionChecks, MarketingConnectionMonitor } from "@paperclipai/shared";
const path = (company: string) => `/companies/${encodeURIComponent(company)}/marketing`;
export const marketingApi = {
  connectionChecks: (company: string, projectId: string) => api.get<MarketingConnectionChecks>(`${path(company)}/connection-checks?projectId=${encodeURIComponent(projectId)}`),
  requestConnectionChecks: (company: string, projectId: string, channelIds?: string[]) => api.post<{ jobs: { id: string; channelId: string; status: string }[] }>(`${path(company)}/connection-checks`, { projectId, ...(channelIds ? { channelIds } : {}) }),
  setConnectionMonitor: (company: string, projectId: string, enabled: boolean) => api.patch<MarketingConnectionMonitor>(`${path(company)}/projects/${encodeURIComponent(projectId)}/connection-monitor`, { enabled }),
  dispatch: (company: string, projectId: string, jobIds?: string[]) => api.post<{ jobId: string; status: string }[]>(`${path(company)}/dispatch`, { projectId, ...(jobIds ? { jobIds } : {}) }),
  resumeProfile: (company: string, id: string, channelId: string) => api.post<MarketingProfile>(`${path(company)}/profiles/${encodeURIComponent(id)}/resume`, { channelId }),
  reconcile: (company: string, id: string) => api.post<{ status: string }>(`${path(company)}/jobs/${encodeURIComponent(id)}/reconcile`, {}),
  retry: (company: string, id: string) => api.post<{ id: string; status: string }>(`${path(company)}/jobs/${encodeURIComponent(id)}/retry`, {}),
  generationInstructions: (company: string, input: { topic: string; channelIds: string[]; agentId: string }) => api.post<{ projectId: string; assigneeAgentId: string; title: string; description: string }>(`${path(company)}/generation-instructions`, input),
  importGenerated: (company: string, issueId: string) => api.post<MarketingDraft[]>(`${path(company)}/import-generated`, { issueId }),
  checkAccount: (company: string, id: string) => api.post<{ signedIn: boolean; accountId: string | null; accountUrl: string | null; checkedAt: string; matches: boolean }>(`${path(company)}/channels/${encodeURIComponent(id)}/check-account`, {}),
  browserProfiles: (company: string) => api.get<MarketingBrowserProfile[]>(`${path(company)}/browser-profiles`),
  overview: (company: string) => api.get<MarketingOverview>(path(company)),
  media: (company: string, projectId: string) => api.get<MarketingMediaChoice[]>(`${path(company)}/media?projectId=${encodeURIComponent(projectId)}`),
  createProfile: (company: string, input: CreateMarketingProfile) => api.post<MarketingProfile>(`${path(company)}/profiles`, input),
  updateProfile: (company: string, id: string, input: UpdateMarketingProfile) => api.patch<MarketingProfile>(`${path(company)}/profiles/${encodeURIComponent(id)}`, input),
  createChannel: (company: string, input: CreateMarketingChannel) => api.post<MarketingChannel>(`${path(company)}/channels`, input),
  updateChannel: (company: string, id: string, input: UpdateMarketingChannel) => api.patch<MarketingChannel>(`${path(company)}/channels/${encodeURIComponent(id)}`, input),
  createDraft: (company: string, input: CreateMarketingDraft) => api.post<MarketingDraft>(`${path(company)}/drafts`, input),
  updateDraft: (company: string, id: string, input: UpdateMarketingDraft) => api.patch<MarketingDraft>(`${path(company)}/drafts/${encodeURIComponent(id)}`, input),
  queue: (company: string, input: QueueMarketingDrafts) => api.post<MarketingPublishJob[]>(`${path(company)}/queue`, input),
  cancel: (company: string, id: string) => api.post<MarketingPublishJob>(`${path(company)}/jobs/${encodeURIComponent(id)}/cancel`, {}),
};
