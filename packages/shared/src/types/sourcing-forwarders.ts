export type SourcingForwarderVerificationStatus = "unverified" | "verifying" | "verified" | "failed" | "blocked";
export interface SourcingForwarder {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  providerId: string | null;
  homepageUrl: string;
  loginUrl: string;
  enabled: boolean;
  credentialConfigured: boolean;
  automaticLogin: boolean;
  verificationStatus: SourcingForwarderVerificationStatus;
  verificationSessionId: string | null;
  verificationCheckedAt: string | null;
  verifiedAt: string | null;
  verificationErrorCode: string | null;
}
export interface SourcingForwarderOpenResult {
  status: "verifying" | "verified" | "failed" | "blocked" | "page_opened";
  browser: "aside";
  sessionId: string | null;
  errorCode?: string | null;
}
export interface SourcingForwarderProvider { id: string; name: string; homepageUrl: string; loginUrl: string; }
