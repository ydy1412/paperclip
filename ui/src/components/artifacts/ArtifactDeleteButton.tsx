import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { artifactsApi, type CompanyArtifact } from "../../api/artifacts";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export function ArtifactDeleteButton({artifact,companyId}:{artifact:CompanyArtifact;companyId:string}) {
  const cache=useQueryClient();
  const [open,setOpen]=useState(false);
  const [deleteFile,setDeleteFile]=useState(false);
  const mutation=useMutation({mutationFn:()=>artifactsApi.remove(artifact,deleteFile),onSuccess:async()=>{
    await cache.invalidateQueries({queryKey:["artifacts",companyId]});
    await cache.invalidateQueries({queryKey:["issues"]});
    setOpen(false);
  }});
  const changeOpen=(value:boolean)=>{
    if(mutation.isPending) return;
    setOpen(value);setDeleteFile(false);mutation.reset();
  };
  return <>
    <Button variant="ghost" size="icon" aria-label={`자료 삭제: ${artifact.title}`} title="자료 삭제" onClick={()=>changeOpen(true)}><Trash2 className="size-4"/></Button>
    <Dialog open={open} onOpenChange={changeOpen}><DialogContent><DialogHeader>
      <DialogTitle>자료 삭제</DialogTitle><DialogDescription className="break-words">{artifact.title}</DialogDescription>
    </DialogHeader>
      <p className="text-sm">{artifact.source==="work_product"?"결과물 등록을 삭제합니다. 원본 첨부 파일은 별도로 선택하지 않으면 유지됩니다.":artifact.source==="attachment"?"원본 첨부 파일을 삭제합니다. 이 작업은 되돌릴 수 없습니다.":"태스크에 연결된 문서를 삭제합니다. 이 작업은 되돌릴 수 없습니다."}</p>
      {artifact.source==="work_product" && artifact.contentPath && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={deleteFile} disabled={mutation.isPending} onChange={event=>setDeleteFile(event.target.checked)}/>원본 첨부 파일도 삭제</label>}
      {mutation.error && <p role="alert" className="break-words text-sm text-destructive">{mutation.error instanceof Error?mutation.error.message:"삭제에 실패했습니다."}</p>}
      <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={mutation.isPending} onClick={()=>changeOpen(false)}>취소</Button><Button variant="destructive" disabled={mutation.isPending} onClick={()=>mutation.mutate()}>{mutation.isPending?"삭제 중":"삭제"}</Button></div>
    </DialogContent></Dialog>
  </>;
}
