// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeSidebar } from "./KnowledgeSidebar";
import { KnowledgeNavigation } from "./KnowledgeNavigation";

const close = vi.hoisted(() => vi.fn());
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: true, setSidebarOpen: close }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: null }) }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: true, setSidebarOpen: close, collapsed: false, peeking: false }) }));
let root: Root, host: HTMLDivElement;
function render(path: string, global = false) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<MemoryRouter initialEntries={[path]}>{global ? <KnowledgeNavigation /> : <KnowledgeSidebar />}</MemoryRouter>));
}
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

describe("Knowledge contextual navigation", () => {
  it.each([["/knowledge", "Library"], ["/knowledge/ask", "Ask & Search"], ["/knowledge/graph", "Knowledge Graph"]])("selects the local page at %s", (path, label) => {
    render(path + "?vault=brain&project=Alpha&doc=old&q=old");
    expect([...host.querySelectorAll('nav a')].map(a => a.textContent)).toEqual(["Library", "Ask & Search", "Knowledge Graph"]);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(label);
    for (const link of host.querySelectorAll('nav a')) {
      expect(link.getAttribute('href')).toContain('vault=brain&project=Alpha');
      expect(link.getAttribute('href')).not.toMatch(/doc=|q=/);
    }
    flushSync(() => (host.querySelector('nav a') as HTMLAnchorElement).click());
    expect(close).toHaveBeenCalledWith(false);
    expect(host.textContent).toContain("All menus");
  });
  it("keeps legacy graph navigation in the Paperclip vault", () => {
    render('/knowledge?view=graph&project=Alpha');
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Knowledge Graph');
    expect(host.querySelector('nav a')?.getAttribute('href')).toContain('vault=paperclip');
  });
  it("preserves the vault when the global link opens a legacy document", () => {
    render('/knowledge?id=old&project=Alpha', true);
    expect(host.querySelector('a')?.getAttribute('href')).toContain('vault=paperclip');
  });
  it("shows only one global link and does not copy a Commerce project into Knowledge", () => {
    render('/sourcing?view=orders&project=commerce', true);
    expect(host.querySelectorAll('a')).toHaveLength(1);
    expect(host.querySelector('a')?.textContent).toBe('Knowledge');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/knowledge');
  });
});
