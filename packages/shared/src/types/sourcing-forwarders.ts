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
}
export interface SourcingForwarderOpenResult {
  status: "login_submitted" | "page_opened";
  browser: "chrome";
}
export interface SourcingForwarderProvider { id: string; name: string; homepageUrl: string; loginUrl: string; }
