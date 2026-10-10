import { ArrowLeft, Package, Search, Settings, Upload } from "lucide-react";
import { Link, useSearchParams } from "@/lib/router";
import { getSourcingView, sourcingViews } from "@/lib/sourcing-views";
import { useSidebar } from "@/context/SidebarContext";
import { primarySidebarStyles } from "./primary-sidebar-styles";
import { cn } from "@/lib/utils";

const workflowIcons = { sourcing: Search, uploads: Upload, orders: Package, settings: Settings };

export function SourcingSidebar() {
  const [params] = useSearchParams();
  const active = getSourcingView(params.get("view"));
  const { isMobile, setSidebarOpen } = useSidebar();
  const closeMobileSidebar = () => { if (isMobile) setSidebarOpen(false); };

  return (
    <aside data-shopping-sidebar className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex h-(--sz-60px) shrink-0 items-center px-3">
        <span className="px-2 text-sm font-semibold">쇼핑몰 관리</span>
      </div>
      <nav aria-label="쇼핑몰 관리" className={primarySidebarStyles.nav}>
        <div className={primarySidebarStyles.group}>
          {sourcingViews.map(view => {
            const next = new URLSearchParams(params);
            if (view.id !== active.id) {
              for (const key of ["q", "state", "source", "account", "validation", "item", "page", "data", "from", "to"]) next.delete(key);
            }
            next.set("view", view.id);
            const Icon = workflowIcons[view.id];
            return (
              <Link
                key={view.id}
                to={`/sourcing?${next}`}
                aria-current={active.id === view.id ? "page" : undefined}
                onClick={closeMobileSidebar}
                className={cn(
                  "flex min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active.id === view.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{view.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="shrink-0 border-t border-border px-3 py-3">
        <Link to="/dashboard" onClick={closeMobileSidebar} className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden="true" />전체 메뉴
        </Link>
      </div>
    </aside>
  );
}
