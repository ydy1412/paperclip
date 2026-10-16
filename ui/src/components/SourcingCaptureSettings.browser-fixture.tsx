import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { SourcingCaptureSettings } from "./SourcingCaptureSettings";
import { SourcingWorkspace } from "./SourcingWorkspace";
import "../index.css";
function Fixture() {
  const params = new URLSearchParams(location.search), companyId = params.get("company")!, projectId = params.get("project")!;
  const [view, setView] = useState("settings");
  return <main className="min-h-screen space-y-6 bg-background p-6 text-foreground"><h1 className="text-xl font-semibold">크롬 상품 수집 검증 · 격리된 시험 데이터</h1><nav className="flex gap-4"><button onClick={() => setView("settings")}>연결 설정</button><button onClick={() => setView("sources")}>소싱 상품</button></nav>{view === "settings" ? <SourcingCaptureSettings companyId={companyId} projectId={projectId} /> : <SourcingWorkspace companyId={companyId} projectId={projectId} />}</main>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><Fixture /></QueryClientProvider>);
