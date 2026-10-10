import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StoreSettings } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { catalogErrorMessage } from "../lib/sourcing-catalog";
import { Button } from "./ui/button";

type ImportStatus = { state: string; errorCode: string; products: number };
export function SourcingCatalogImport({ companyId, projectId, settings, disabled }: {
  companyId: string; projectId: string; settings: StoreSettings; disabled: boolean;
}) {
  const cache = useQueryClient();
  const stores = settings.stores.filter(s => s.provider === "coupang" && s.enabled && s.catalogSupported && s.hasCredentials);
  const [choice, setChoice] = useState("");
  const store = stores.find(s => s.id === choice) ?? stores[0];
  const statusKey = ["sourcing-import", companyId, projectId, store?.id];
  const status = useQuery({ queryKey: statusKey, queryFn: () => sourcingCatalogApi.request<ImportStatus>(companyId, projectId, { operation: "import-status", storeId: store!.id }),
    enabled: !!store, retry: false, refetchInterval: q => q.state.data?.state === "running" ? 2000 : false });
  const start = useMutation({ mutationFn: () => sourcingCatalogApi.request<ImportStatus>(companyId, projectId, { operation: "import", storeId: store!.id }),
    onSuccess: data => cache.setQueryData(statusKey, data) });
  useEffect(() => {
    if (!status.data || !["running", "succeeded", "failed"].includes(status.data.state)) return;
    void cache.invalidateQueries({ queryKey: ["sourcing-catalog", companyId, projectId] });
    void cache.invalidateQueries({ queryKey: ["sourcing-store-settings", companyId, projectId] });
  }, [status.data?.state, status.data?.products, companyId, projectId, cache]);
  const running = start.isPending || status.data?.state === "running" || store?.importState === "running";
  return <section aria-label="기존 쿠팡 상품 가져오기" className="space-y-3 rounded-lg border border-border bg-card p-4">
    <h2 className="text-sm font-semibold">기존 쿠팡 상품 가져오기</h2>
    <p className="text-xs text-muted-foreground">등록된 상품을 가져와 카드로 표시합니다. 편집한 내용은 유지됩니다.</p>
    {stores.length ? <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="catalog-import-store">가져올 쇼핑몰</label>
      <select id="catalog-import-store" className="h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm" value={store?.id ?? ""} disabled={disabled || running} onChange={e => { setChoice(e.target.value); start.reset(); }}>
        {stores.map(s => <option key={s.id} value={s.id}>{settings.businesses.find(b => b.id === s.businessId)?.name} / {s.name}</option>)}
      </select>
      <Button variant="outline" disabled={disabled || running || status.isLoading || !!status.error} onClick={() => start.mutate()}>{running ? "가져오는 중" : status.data?.state === "failed" ? "가져오기 재개" : "쿠팡 상품 가져오기"}</Button>
      {status.data && <p role="status" className="text-xs text-muted-foreground">{status.data.state === "succeeded" ? "가져오기 완료" : status.data.state === "running" ? "쿠팡 상품 조회 중" : status.data.state === "failed" ? "일부 가져오기 실패 · 재개 가능" : "아직 가져오지 않음"} · 저장 상품 {status.data.products.toLocaleString("ko-KR")}개</p>}
    </div> : <p className="text-sm text-muted-foreground">쇼핑몰 관리 설정에서 사업자에 기존 쿠팡 계정을 연결해 주세요.</p>}
    {(start.error || status.error || status.data?.state === "failed") && <p role="alert" className="text-sm text-destructive">{catalogErrorMessage(start.error ?? status.error ?? new Error(status.data?.errorCode || "catalog_request_failed"))}</p>}
  </section>;
}
