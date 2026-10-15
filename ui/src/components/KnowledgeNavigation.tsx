import { useState } from "react";
import { BookOpen, ChevronRight, Network, Search } from "lucide-react";
import { useLocation } from "@/lib/router";
import { useSidebar } from "../context/SidebarContext";
import { SidebarNavItem } from "./SidebarNavItem";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { cn } from "../lib/utils";

export function KnowledgeNavigation() {
  const [open, setOpen] = useState(true), location = useLocation();
  const { collapsed, peeking } = useSidebar();
  const active = /\/knowledge(?:\/|$)/.test(location.pathname);
  const params = new URLSearchParams(location.search), shared = new URLSearchParams();
  for (const key of ["vault", "project"]) if (params.has(key)) shared.set(key, params.get(key)!);
  const suffix = shared.size ? `?${shared}` : "";
  if (collapsed && !peeking) return <SidebarNavItem to={`/knowledge${suffix}`} label="지식" icon={BookOpen} active={active} />;
  return <Collapsible open={open} onOpenChange={setOpen}>
    <CollapsibleTrigger asChild><button type="button" aria-label="지식 메뉴" className="mx-2 flex knowledge-nav-trigger items-center gap-2.5 rounded-lg px-2 py-1.5 text-(length:--text-compact) font-medium text-foreground/80 hover:bg-sidebar-accent">
      <BookOpen className="size-4" /><span className="flex-1 text-left">지식</span><ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
    </button></CollapsibleTrigger>
    <CollapsibleContent><nav aria-label="지식 하위 메뉴" className="ml-5 border-l border-border pl-1">
      <SidebarNavItem to={`/knowledge${suffix}`} label="자료실" icon={BookOpen} end />
      <SidebarNavItem to={`/knowledge/ask${suffix}`} label="질문·검색" icon={Search} />
      <SidebarNavItem to={`/knowledge/graph${suffix}`} label="지식 그래프" icon={Network} />
    </nav></CollapsibleContent>
  </Collapsible>;
}
