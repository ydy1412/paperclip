import { useEffect, useRef } from "react";
import { mountDobiOrders } from "@paperclipai/dobi-orders/frontend";
import styles from "@paperclipai/dobi-orders/styles?raw";
import { useSearchParams } from "@/lib/router";

/** Keep imported order UI scoped; React owns its lifetime and the Dovix navigation shell. */
export function DobiOrders({ companyId, projectId, settingsOnly = false }: { companyId: string; projectId: string; settingsOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("orderTab");
  const navigation = useRef({ params, setParams });
  navigation.current = { params, setParams };
  useEffect(() => {
    if (!host.current || !companyId || !projectId) return;
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" });
    const requestedView = navigation.current.params.get("orderTab") ?? "";
    const views = settingsOnly ? ["connections", "settings"] : ["overview", "orders", "claims", "memos", "reports", "forwarding"];
    const dispose = mountDobiOrders(root, {
      basePath: `/api/companies/${encodeURIComponent(companyId)}/sourcing/projects/${encodeURIComponent(projectId)}/order-management`,
      styles, settingsOnly,
      initialView: views.includes(requestedView) ? requestedView : settingsOnly ? "connections" : "orders",
      onNavigate: view => {
        const { params: current, setParams: change } = navigation.current;
        const next = new URLSearchParams(current);
        if (settingsOnly && !["connections", "settings"].includes(view)) next.set("view", "orders");
        if (!settingsOnly && ["connections", "settings"].includes(view)) next.set("view", "settings");
        next.set("orderTab", view); if (["connections", "settings"].includes(view)) next.set("settingsSection", view === "connections" ? "stores" : "automation"); change(next, { replace: true });
      },
    });
    return () => { dispose(); root.replaceChildren(); };
  }, [companyId, projectId, settingsOnly, requestedTab]);
  if (!companyId || !projectId) return <p className="text-sm text-muted-foreground">주문을 관리할 프로젝트를 선택해 주세요.</p>;
  return <section aria-label={settingsOnly ? "주문관리 연결 설정" : "주문 작업실"} className="min-w-0"><div id="dobi-order-workspace" ref={host} /></section>;
}
