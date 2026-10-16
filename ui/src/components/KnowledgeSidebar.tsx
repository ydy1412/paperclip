import { ArrowLeft, BookOpen, Network, Search } from "lucide-react";
import { Link, useLocation, useSearchParams } from "@/lib/router";
import { getKnowledgeView, knowledgeViews } from "@/lib/knowledge-views";
import { useSidebar } from "@/context/SidebarContext";
import { primarySidebarStyles } from "./primary-sidebar-styles";
import { cn } from "@/lib/utils";

const icons = { library: BookOpen, ask: Search, graph: Network };

export function KnowledgeSidebar() {
  const [params] = useSearchParams(), location = useLocation();
  const active = getKnowledgeView(location.pathname, params.get("view") === "graph");
  const { isMobile, setSidebarOpen } = useSidebar();
  const closeMobileSidebar = () => { if (isMobile) setSidebarOpen(false); };
  const shared = new URLSearchParams();
  for (const key of ["vault", "project"]) if (params.has(key)) shared.set(key, params.get(key)!);
  // Old document/graph URLs refer to the separate Paperclip vault.
  if (!params.has("vault") && (params.has("id") || params.get("view") === "graph")) shared.set("vault", "paperclip");

  return <aside data-knowledge-sidebar className="flex h-full min-h-0 w-full flex-col bg-background">
    <div className="flex h-(--sz-60px) shrink-0 items-center px-3"><span className="px-2 text-sm font-semibold">Knowledge</span></div>
    <nav aria-label="Knowledge" className={primarySidebarStyles.nav}>
      <div className={primarySidebarStyles.group}>{knowledgeViews.map(view => {
        const Icon = icons[view.id];
        return <Link key={view.id} to={`/knowledge${view.path}${shared.size ? `?${shared}` : ""}`} aria-current={active.id === view.id ? "page" : undefined} onClick={closeMobileSidebar}
          className={cn("flex min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active.id === view.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}>
          <Icon className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{view.label}</span>
        </Link>;
      })}</div>
    </nav>
    <div className="shrink-0 border-t border-border px-3 py-3"><Link to="/dashboard" onClick={closeMobileSidebar} className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden="true" />All menus</Link></div>
  </aside>;
}
