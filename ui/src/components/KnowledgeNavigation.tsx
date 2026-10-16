import { BookOpen } from "lucide-react";
import { useLocation } from "@/lib/router";
import { SidebarNavItem } from "./SidebarNavItem";

export function KnowledgeNavigation() {
  const location = useLocation();
  const active = /\/knowledge(?:\/|$)/.test(location.pathname);
  const current = new URLSearchParams(location.search), shared = new URLSearchParams();
  if (active) for (const key of ["vault", "project"]) if (current.has(key)) shared.set(key, current.get(key)!);
  if (active && !current.has("vault") && (current.has("id") || current.get("view") === "graph")) shared.set("vault", "paperclip");
  return <SidebarNavItem to={`/knowledge${shared.size ? `?${shared}` : ""}`} label="Knowledge" icon={BookOpen} active={active} />;
}
