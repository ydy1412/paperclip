import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useSearchParams } from "@/lib/router";
import { getSourcingView } from "../lib/sourcing-views";
import { projectsApi } from "../api/projects";
import { ApiError } from "../api/client";
import { SourcingOrders } from "../components/SourcingOrders";
import { SourcingProducts } from "../components/SourcingProducts";
import { SourcingStoreSettings } from "../components/SourcingStoreSettings";
import { SourcingForwarders } from "../components/SourcingForwarders";

export function Sourcing() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const [params, setParams] = useSearchParams();
  const view = getSourcingView(params.get("view"));
  const projects = useQuery({
    queryKey: ["sourcing-projects", selectedCompanyId],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    retry: false,
  });
  const accessDenied = projects.error instanceof ApiError && [401, 403].includes(projects.error.status);
  const availableProjects = accessDenied ? [] : projects.data ?? [];
  const projectId = availableProjects.some(project => project.id === params.get("project")) ? params.get("project")! :
    !params.has("project") ? availableProjects.find(project => project.name === "Auto Sourcing")?.id ?? "" : "";

  useEffect(() => {
    setBreadcrumbs([{ label: "쇼핑몰 관리", href: "/sourcing" }, { label: view.label }]);
  }, [setBreadcrumbs, view.label]);

  return (
    <section aria-label="쇼핑몰 관리" className="min-w-0 space-y-6">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <h1 className="break-words text-xl font-semibold text-foreground">{view.label}</h1>
        <label className="grid w-60 min-w-0 max-w-full gap-1 text-xs text-muted-foreground">
          프로젝트
          <select
            aria-label="프로젝트"
            value={projectId}
            disabled={!selectedCompanyId || projects.isLoading || !!projects.error || !availableProjects.length}
            onChange={event => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set("project", event.target.value);
              else next.delete("project");
              next.delete("item");
              next.delete("account");
              next.delete("page");
              setParams(next);
            }}
            className="h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="">{!selectedCompanyId ? "회사 미선택" : projects.isLoading ? "프로젝트 조회 중" : !availableProjects.length && !projects.error ? "프로젝트 없음" : "프로젝트 선택"}</option>
            {availableProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
      </header>
      {projects.error && <p role="alert" className="text-sm text-destructive">{accessDenied ? "프로젝트 조회 권한 없음" : "프로젝트 조회 실패"}</p>}
      {view.id === "settings" ? selectedCompanyId && projectId
        ? <div key={`${selectedCompanyId}:${projectId}`} className="space-y-8"><SourcingStoreSettings companyId={selectedCompanyId} projectId={projectId} /><SourcingForwarders companyId={selectedCompanyId} projectId={projectId} /></div>
        : <p className="text-sm text-muted-foreground">{projects.isLoading ? "프로젝트 조회 중" : "배송대행지를 관리할 프로젝트를 선택해 주세요."}</p>
        : view.id === "orders" ? <SourcingOrders key={`${selectedCompanyId}:${projectId}`} companyId={selectedCompanyId ?? ""} projectId={projectId} /> :
        <SourcingProducts key={`${selectedCompanyId}:${projectId}:${view.id}`} companyId={selectedCompanyId ?? ""} projectId={projectId} view={view.id === "uploads" ? "uploads" : "source"} />}
    </section>
  );
}
