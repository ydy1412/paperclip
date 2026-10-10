import type { MarketingContent, MarketingJobStatus, CreateMarketingChannel, CreateMarketingProfile } from "../validators/marketing.js";

export interface MarketingProfile extends CreateMarketingProfile {
  id: string;
  companyId: string;
  enabled: boolean;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MarketingChannel extends CreateMarketingChannel {
  id: string;
  companyId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface MarketingDraft {
  id: string;
  companyId: string;
  projectId: string;
  channelId: string;
  topic: string;
  content: MarketingContent;
  revision: number;
  contentHash: string;
  generationIssueId: string | null;
  generationRunId?: string | null;
  author?: { agentId: string | null; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
export interface MarketingPublishJob {
  id: string;
  companyId: string;
  projectId: string;
  profileId: string;
  channelId: string;
  draftId: string;
  revision: number;
  status: MarketingJobStatus;
  position: number;
  approvedBy: string;
  approvedAt: string;
  attempts: number;
  externalSessionId: string | null;
  postedUrl: string | null;
  lastError: string | null;
  snapshotHash: string;
  evidence: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
export interface MarketingMediaChoice {
  attachmentId: string;
  title: string;
  contentType: string;
  byteSize: number;
  href: string;
}
export interface MarketingOverview {
  publicationEnabled?: boolean;
  publicationCapabilities?: { platforms: string[]; media: boolean };
  profiles: MarketingProfile[];
  channels: MarketingChannel[];
  drafts: MarketingDraft[];
  jobs: MarketingPublishJob[];
}
export interface MarketingBrowserProfile {
  asideAccountId: string;
  browserProfileName: string;
  signedIn: boolean;
}

export type MarketingConnectionStatus = "connected" | "auth_required" | "unknown";
export type MarketingConnectionCheckStatus = "queued" | "preparing" | "requesting" | "waiting" | "result_received" | "classifying" | "completed" | "needs_attention" | "cancelled";
export interface MarketingConnectionCheck {
  id: string; companyId: string; projectId: string; channelId: string;
  threadId: string; asideSessionId: string | null;
  source: "manual" | "automatic"; status: MarketingConnectionCheckStatus;
  appliedStatus: MarketingConnectionStatus | null;
  rawDecision: { choice: MarketingConnectionStatus; probability: number } | null;
  reason: string | null; createdAt: string; updatedAt: string;
  resultReceivedAt: string | null; finishedAt: string | null;
}
export interface MarketingConnectionMonitor {
  companyId: string; projectId: string; enabled: boolean; nextCheckAt: string | null;
}
export interface MarketingConnectionChecks {
  jobs: MarketingConnectionCheck[]; monitor: MarketingConnectionMonitor;
  connections: { channelId: string; status: MarketingConnectionStatus; checkedAt: string | null }[];
}
