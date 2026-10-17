import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImageProcessingJob, ImageProcessingSettings, ManagedProduct } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { catalogErrorMessage } from "../lib/sourcing-catalog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const states: Record<ImageProcessingJob["state"], string> = { queued: "대기", processing: "가공 중", succeeded: "저장 완료", failed: "실패", attention: "확인 필요" };
export function SourcingImageJobs({ companyId, projectId, onChanged, settingsOnly = false, onOpenProduct, disabled = false }: { companyId: string; projectId: string; onChanged: () => void; settingsOnly?: boolean; onOpenProduct?: (product: ManagedProduct) => void; disabled?: boolean }) {
  const cache = useQueryClient(), key = ["sourcing-image-jobs", companyId, projectId];
  const settings = useQuery({ queryKey: [...key, "settings"], queryFn: () => sourcingCatalogApi.request<ImageProcessingSettings>(companyId, projectId, { operation: "image-job-settings" }), retry: false });
  const jobs = useQuery({ queryKey: key, queryFn: () => sourcingCatalogApi.request<ImageProcessingJob[]>(companyId, projectId, { operation: "image-jobs" }), retry: false, refetchInterval: 5000 });
  const [imagePage, setImagePage] = useState(1);
  const [open, setOpen] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [enabled, setEnabled] = useState(false), [minutes, setMinutes] = useState("1"), [editing, setEditing] = useState(false);
  const changed = useRef(onChanged); changed.current = onChanged;
  const previous = useRef<string | null>(null);
  const signature = jobs.data?.map(j => `${j.id}:${j.state}:${j.assetId}`).join(",");
  useEffect(() => {
    if (signature === undefined || signature === previous.current) return;
    if (previous.current !== null) changed.current();
    previous.current = signature;
  }, [signature]);
  useEffect(() => {
    if (settings.data && !editing) { setEnabled(settings.data.enabled); setMinutes(String(settings.data.scanIntervalSeconds / 60)); }
  }, [settings.data, editing]);
  const configure = useMutation({ mutationFn: () => sourcingCatalogApi.request<ImageProcessingSettings>(companyId, projectId,
    { operation: "image-job-configure", enabled, scanIntervalSeconds: Number(minutes) * 60 }),
    onSuccess: value => { cache.setQueryData([...key, "settings"], value); setEditing(false); void cache.invalidateQueries({ queryKey: key }); } });
  const retry = useMutation({ mutationFn: (jobId: string) => sourcingCatalogApi.request(companyId, projectId, { operation: "image-job-retry", jobId }),
    onSuccess: () => void cache.invalidateQueries({ queryKey: key }) });
  const error = settings.error ?? jobs.error ?? configure.error ?? retry.error;
  const visibleJobs = jobs.data?.filter(job => !attentionOnly || ["failed", "attention"].includes(job.state) || job.reviewRequired) ?? [];
  const pageCount = Math.max(1, Math.ceil(visibleJobs.length / 20));
  const currentPage = Math.min(imagePage, pageCount);
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className={settingsOnly ? "rounded-lg border border-border p-4" : "commerce-review-entry"}>
    <summary className="cursor-pointer text-sm font-medium">{settingsOnly ? "이미지 자동화 설정" : "이미지 확인"} · {jobs.error ? "조회 실패" : jobs.isLoading ? "조회 중" : `${jobs.data?.filter(j => ["failed", "attention"].includes(j.state) || j.reviewRequired).length ?? 0}개`}</summary>
    <div className="space-y-4 pt-4"><p className="text-xs text-muted-foreground">{jobs.data?.filter(j => j.state === "processing").length ?? 0}개 가공 중 · {jobs.data?.filter(j => j.state === "queued").length ?? 0}개 대기</p>
      <p className="text-sm text-muted-foreground">가공 전 상품의 대표·옵션·상세 사진을 서버가 한 장씩 변환하고 저장합니다. 원본은 보존하며 창을 닫아도 계속 처리합니다.</p>
      {error && <p role="alert" className="text-sm text-destructive">{catalogErrorMessage(error)}</p>}
      {settings.isLoading && <p className="text-sm text-muted-foreground">설정 조회 중</p>}
      {settingsOnly && settings.data && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); configure.mutate(); }}>
        <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setEditing(true); }} />자동 이미지 가공</label>
        <label className="grid gap-1 text-sm">확인 주기 (분)<Input className="w-24" type="number" min={1} max={60} step={1} required value={minutes} onChange={e => { setMinutes(e.target.value); setEditing(true); }} /></label>
        <Button type="submit" disabled={!editing || configure.isPending}>{configure.isPending ? "저장 중" : "설정 저장"}</Button>
        <span className="text-sm text-muted-foreground">{settings.data.workerEnabled ? settings.data.enabled ? "자동 확인 켜짐" : "자동 확인 꺼짐" : "서버 작업자 설정 필요"}</span>
      </form>}
      {settings.data?.errorCode && <p className="text-sm text-destructive">{catalogErrorMessage(new Error(settings.data.errorCode))}</p>}
      <p className="text-xs text-muted-foreground">저장 완료 후에도 제품 모양·색상 검토가 필요합니다. 새 이미지 생성은 힉스필드 크레딧을 사용합니다. 자동 확인을 끄면 새 작업을 멈추고 이미 시작한 사진은 마무리합니다.</p>
      {!settingsOnly && <><p className="text-xs text-muted-foreground">이미지 작업의 확인 필요 수입니다. 소싱 단계의 확인 필요 상품 수와 범위가 다르며 저장 완료 후 검토 대상도 포함합니다.</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attentionOnly} onChange={e => { setAttentionOnly(e.target.checked); setImagePage(1); }} />확인·실패 작업만 보기</label>
      {jobs.error ? <p className="text-sm text-destructive">이미지 작업 목록을 조회하지 못했습니다.</p> : jobs.isLoading ? <p className="text-sm text-muted-foreground">작업 조회 중</p> : visibleJobs.length === 0 ? <p className="text-sm text-muted-foreground">{attentionOnly ? "확인·실패 작업이 없습니다." : "아직 이미지 가공 작업이 없습니다."}</p> :
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="p-2">사진</th><th className="p-2">상품</th><th className="p-2">상태</th><th className="p-2">확인 사항</th><th className="p-2">작업</th></tr></thead><tbody>
          {visibleJobs.slice((currentPage - 1) * 20, currentPage * 20).map(job => <tr key={job.id} className="border-b border-border"><td className="p-2"><img src={job.assetId ? `/api/companies/${companyId}/sourcing/projects/${projectId}/images/${job.productId}/${job.assetId}.png` : job.imageUrl} alt="이미지 가공 사진" className="size-16 rounded-md object-contain" loading="lazy" referrerPolicy="no-referrer" /></td><td className="p-2"><ImageJobProduct companyId={companyId} projectId={projectId} productId={job.productId} disabled={disabled} enabled={open} onOpen={onOpenProduct ? product => { if (disabled) return; setOpen(false); onOpenProduct(product); } : undefined} /></td><td className="whitespace-nowrap p-2">{states[job.state]}</td><td className="p-2">{job.errorCode ? catalogErrorMessage(new Error(job.errorCode)) : job.state === "succeeded" ? "사진 검토 필요" : ""}</td><td className="space-y-2 p-2"><details><summary className="cursor-pointer text-xs">원본·결과 비교</summary><div className="flex flex-wrap gap-2 py-2"><figure><img src={job.imageUrl} alt="원본 이미지" className="size-40 object-contain" loading="lazy" referrerPolicy="no-referrer" /><figcaption className="text-xs">원본</figcaption></figure>{job.assetId && <figure><img src={`/api/companies/${companyId}/sourcing/projects/${projectId}/images/${job.productId}/${job.assetId}.png`} alt="가공 결과" className="size-40 object-contain" loading="lazy" /><figcaption className="text-xs">가공 결과 · 검토 전</figcaption></figure>}</div></details>{["failed", "attention"].includes(job.state) && !["higgsfield_submission_unknown", "legacy_image_request_requires_adoption"].includes(job.errorCode) && <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(job.id)}>{job.errorCode === "image_text_review_required" || job.errorCode.startsWith("higgsfield_generation_") ? "새 이미지 생성" : "재시도"}</Button>}</td></tr>)}
        </tbody></table></div>}
      {pageCount > 1 && <nav aria-label="이미지 작업 페이지" className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setImagePage(currentPage - 1)}>이전 작업</Button><span className="text-xs text-muted-foreground">{currentPage} / {pageCount} · {visibleJobs.length}개 작업</span><Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setImagePage(currentPage + 1)}>다음 작업</Button></nav>}</>}
    </div>
  </details>;
}

function ImageJobProduct({ companyId, projectId, productId, disabled, enabled, onOpen }: { companyId: string; projectId: string; productId: string; disabled: boolean; enabled: boolean; onOpen?: (product: ManagedProduct) => void }) {
  const product = useQuery({ queryKey: ["sourcing-image-product", companyId, projectId, productId], queryFn: () => sourcingCatalogApi.request<ManagedProduct>(companyId, projectId, { operation: "get", productId }), enabled, retry: false, staleTime: 60000 });
  return <div className="space-y-1"><p className="text-sm">{product.data?.title || "상품 정보"}</p><p className="break-all font-mono text-xs text-muted-foreground">{product.data?.sourceProductId || productId}</p>{product.error && <p className="text-xs text-destructive">상품 조회 실패</p>}{onOpen && <Button variant="outline" size="sm" disabled={disabled || !product.data} onClick={() => product.data && onOpen(product.data)}>상품 편집</Button>}</div>;
}
