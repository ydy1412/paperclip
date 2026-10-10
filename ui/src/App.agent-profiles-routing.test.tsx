// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const uiState = vi.hoisted(() => ({ enabled: true, loaded: true }));
vi.mock("./hooks/useStreamlinedUiEnabled", () => ({
  useStreamlinedUiEnabled: () => uiState,
}));
vi.mock("./components/Layout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { Layout: () => <Outlet /> };
});
vi.mock("./components/Layout.production", async () => {
  const { Outlet } = await import("react-router-dom");
  return { Layout: () => <Outlet /> };
});
vi.mock("./components/CloudAccessGate", async () => {
  const { Outlet } = await import("react-router-dom");
  return { CloudAccessGate: () => <Outlet /> };
});
vi.mock("./components/OnboardingWizardVariant", () => ({
  OnboardingWizardVariant: () => null,
}));
vi.mock("./pages/AgentProfiles", () => ({
  AgentProfiles: () => {
    const location = useLocation();
    return <div>{`PROFILES@${location.pathname}${location.search}${location.hash}`}</div>;
  },
}));

const company = { id: "company-1", name: "Dovix", issuePrefix: "DOB", status: "active" };
vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [company], selectedCompanyId: company.id,
    selectedCompany: company, loading: false,
  }),
  CompanyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("App Agent Profiles routing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it.each([true, false])("redirects the bare profile URL with UI mode %s", async (enabled) => {
    uiState.enabled = enabled;
    flushSync(() => root.render(
      <MemoryRouter initialEntries={["/agent-profiles?selected=p1#details"]}>
        <App />
      </MemoryRouter>,
    ));
    await vi.waitFor(() => expect(container.textContent)
      .toContain("PROFILES@/DOB/agent-profiles?selected=p1#details"));
  });

  it("preserves the organization already named by a profile deep link", async () => {
    uiState.enabled = true;
    flushSync(() => root.render(
      <MemoryRouter initialEntries={["/NEW/agent-profiles"]}>
        <App />
      </MemoryRouter>,
    ));
    await vi.waitFor(() => expect(container.textContent).toContain("PROFILES@/NEW/agent-profiles"));
  });
});
