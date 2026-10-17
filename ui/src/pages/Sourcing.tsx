import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useSearchParams } from "@/lib/router";
import { getSourcingView } from "../lib/sourcing-views";
import { projectsApi } from "../api/projects";
import { ApiError } from "../api/client";
import { DobiOrders } from "../components/DobiOrders";
import { SourcingImageJobs } from "../components/SourcingImageJobs";
import { SourcingProducts } from "../components/SourcingProducts";
import { SourcingStoreSettings } from "../components/SourcingStoreSettings";
import { SourcingForwarders } from "../components/SourcingForwarders";
import { SourcingCaptureSettings } from "../components/SourcingCaptureSettings";

export function Sourcing() {
  const { setBreadcrumbs, setBreadcrumbToolbar } = useBreadcrumbs();
  const [editingProduct, setEditingProduct] = useState(false);
  const { selectedCompanyId } = useCompany();
  const [params, setParams] = useSearchParams();
  const view = getSourcingView(params.get("view"));
  const requestedSection = params.get("settingsSection");
  const settingsSection = requestedSection ? ["stores", "forwarders", "capture", "automation"].includes(requestedSection) ? requestedSection : "stores" : params.get("orderTab") === "settings" ? "automation" : "stores";
  function setSettingsSection(id: string) { const next = new URLSearchParams(params); next.set("settingsSection", id); if (id === "stores") next.set("orderTab", "connections"); if (id === "automation") next.set("orderTab", "settings"); setParams(next, { replace: true }); }
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
    setBreadcrumbs([{ label: "Commerce", href: "/sourcing" }, { label: view.label }]);
  }, [setBreadcrumbs, view.label]);

  useEffect(() => {
    setBreadcrumbToolbar(<label className="grid w-60 min-w-0 max-w-full gap-1 text-xs text-muted-foreground">
          <span className="sr-only">프로젝트</span>
          <select
            aria-label="프로젝트"
            value={projectId}
            disabled={editingProduct || !selectedCompanyId || projects.isLoading || !!projects.error || !availableProjects.length}
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
        </label>);
    return () => setBreadcrumbToolbar(null);
  }, [setBreadcrumbToolbar, editingProduct, selectedCompanyId, projectId, projects.data, projects.isLoading, projects.error, params, setParams]);

  return (
    <section aria-label="Commerce" className="relative min-w-0 space-y-4">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h1 className="break-words text-base font-semibold text-foreground">{view.label}</h1>

      </header>
      {projects.error && <p role="alert" className="text-sm text-destructive">{accessDenied ? "프로젝트 조회 권한 없음" : "프로젝트 조회 실패"}</p>}
      {view.id === "settings" ? selectedCompanyId && projectId
        ? <div key={`${selectedCompanyId}:${projectId}`} className="space-y-6">
          <nav aria-label="설정 구획" className="flex flex-wrap gap-3 text-sm">{[["stores", "사업자·쇼핑몰"], ["forwarders", "배송대행지"], ["capture", "수집 도구"], ["automation", "자동화·데이터"]].map(([id, label]) => <button key={id} type="button" aria-pressed={settingsSection === id} onClick={() => setSettingsSection(id)} className={`rounded-md px-3 py-2 ${settingsSection === id ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>)}</nav>
          <section hidden={settingsSection !== "stores"} id="commerce-stores" className="space-y-3"><p className="text-sm text-muted-foreground">상품 연동 계정 · 주문 수집 계정과 별도로 관리합니다.</p><SourcingStoreSettings companyId={selectedCompanyId} projectId={projectId} /></section>
          <section hidden={settingsSection !== "forwarders"} id="commerce-forwarders"><SourcingForwarders companyId={selectedCompanyId} projectId={projectId} /></section>
          <section hidden={settingsSection !== "capture"} id="commerce-capture"><SourcingCaptureSettings companyId={selectedCompanyId} projectId={projectId} projectName={availableProjects.find(project => project.id === projectId)?.name} /></section>
          <section hidden={settingsSection !== "automation"} id="commerce-automation" className="space-y-3"><h2 className="font-semibold">자동화·데이터</h2><SourcingImageJobs companyId={selectedCompanyId} projectId={projectId} onChanged={() => {}} settingsOnly /></section>
          <section hidden={!["stores", "automation"].includes(settingsSection)} className="space-y-3"><h2 className="font-semibold">{settingsSection === "stores" ? "주문 수집·배송 신청 계정" : "주문 데이터·백업"}</h2><p className="text-sm text-muted-foreground">주문 전용 설정입니다. 상품 연동·배송 로그인 계정과 별도로 관리합니다.</p><DobiOrders companyId={selectedCompanyId} projectId={projectId} settingsOnly /></section>
        </div>
        : <p className="text-sm text-muted-foreground">{projects.isLoading ? "프로젝트 조회 중" : "배송대행지를 관리할 프로젝트를 선택해 주세요."}</p>
        : view.id === "orders" ? <DobiOrders key={`${selectedCompanyId}:${projectId}`} companyId={selectedCompanyId ?? ""} projectId={projectId} /> :
        <SourcingProducts onEditingChange={setEditingProduct} key={`${selectedCompanyId}:${projectId}:${view.id}`} companyId={selectedCompanyId ?? ""} projectId={projectId} view={view.id === "uploads" ? "uploads" : "source"} />}
    </section>
  );
}
