import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useSearchParams } from "react-router-dom";
import { DobiOrders } from "./DobiOrders";
import "../index.css";

function Fixture() {
const [params] = useSearchParams();
const companyId = params.get("company") ?? "11111111-1111-4111-8111-111111111111";
const projectId = params.get("project") ?? "22222222-2222-4222-8222-222222222222";
return <>
  <div className="min-h-screen bg-background text-foreground p-6"><header className="mb-6 flex items-center justify-between"><h1 className="text-xl font-semibold">쇼핑몰 관리 · 주문</h1><span className="text-xs text-muted-foreground">격리된 브라우저 검증 환경 · 합성 데이터</span></header>
    <DobiOrders companyId={companyId} projectId={projectId} settingsOnly={params.get("view") === "settings"} />
  </div>
</>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><BrowserRouter><Fixture /></BrowserRouter></React.StrictMode>);
