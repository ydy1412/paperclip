import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SourcingStoreSettings } from "./SourcingStoreSettings";
import { SourcingProducts } from "./SourcingProducts";
import { useState } from "react";
import "../index.css";

function Fixture() {
  const params = new URLSearchParams(location.search);
  const companyId = params.get("company")!; const projectId = params.get("project")!;
  const [view, setView] = useState("settings");
  return <main className="min-h-screen space-y-6 bg-background p-6 text-foreground"><h1 className="text-xl font-semibold">쇼핑몰 관리 검증 · 격리된 테스트 데이터</h1><nav className="flex gap-4"><button onClick={() => setView("settings")}>설정</button><button onClick={() => setView("uploads")}>상품 업로드</button><button onClick={() => setView("source")}>소싱</button></nav>{view === "settings" ? <SourcingStoreSettings companyId={companyId} projectId={projectId} /> : <SourcingProducts key={view} companyId={companyId} projectId={projectId} view={view === "uploads" ? "uploads" : "source"} />}</main>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><Fixture /></QueryClientProvider>);
