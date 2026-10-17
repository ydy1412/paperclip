import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DetailDefault } from "@paperclipai/shared";
import { sourcingCatalogApi } from "../api/sourcing";
import { DetailImages, DetailReferencePicker } from "./SourcingDetailImages";
import { Button } from "./ui/button";
export function SourcingNoticeDefaults({ companyId, projectId, storeId }: { companyId: string; projectId: string; storeId: string }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<DetailDefault | null>(null); const cache = useQueryClient();
  const key = ["store-detail-defaults", companyId, projectId, storeId];
  const data = useQuery({ queryKey: key, queryFn: () => sourcingCatalogApi.request<DetailDefault>(companyId, projectId, { operation: "detail-defaults", storeId }), enabled: open, retry: false });
  useEffect(() => { if (!draft && data.data) setDraft(data.data); }, [draft, data.data]);
  const save = useMutation({ mutationFn: () => sourcingCatalogApi.request<DetailDefault>(companyId, projectId, { operation: "detail-default-save", storeId, expectedRevision: draft!.revision, topImages: draft!.topImages, bottomImages: draft!.bottomImages, referenceProductId: draft!.referenceProductId }), onSuccess: result => { setDraft(result); cache.setQueryData(key, result); } });
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(data.data);
  return <details className="mt-3 min-w-0 space-y-3 rounded-md border border-border p-3" onToggle={e => setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm">쇼핑몰 기본 공지</summary><p className="text-xs text-muted-foreground">이 쇼핑몰에서 새로 만드는 상품에만 복사합니다. 기존 상품과 대기 중인 업로드는 바꾸지 않습니다. 참조 이미지의 사업자·배송·고객센터 내용을 확인하세요.</p>
    {(data.isError || save.isError) && <p role="alert" className="text-sm text-destructive">{save.isError ? "기본 공지를 저장하지 못했습니다. 다른 변경이 있으면 새로 조회한 뒤 다시 확인해 주세요." : "기본 공지를 조회하지 못했습니다."}</p>}
    {draft && <fieldset disabled={save.isPending} className="min-w-0 space-y-3"><DetailImages label="기본 상단" images={draft.topImages} onChange={topImages => setDraft({ ...draft, topImages })} /><DetailImages label="기본 하단" images={draft.bottomImages} onChange={bottomImages => setDraft({ ...draft, bottomImages })} /><DetailReferencePicker topImages={draft.topImages} bottomImages={draft.bottomImages} companyId={companyId} projectId={projectId} storeId={storeId} onChoose={(url, position, referenceProductId) => setDraft({ ...draft, referenceProductId, [position === "top" ? "topImages" : "bottomImages"]: [...(position === "top" ? draft.topImages : draft.bottomImages), url] })} /><div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" disabled={!dirty} onClick={() => setDraft(data.data ?? null)}>변경 취소</Button><Button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "기본 공지 저장"}</Button></div>{save.isSuccess && !dirty && <p role="status" className="text-xs text-muted-foreground">쇼핑몰 기본 공지를 저장했습니다.</p>}</fieldset>}
  </details>;
}
