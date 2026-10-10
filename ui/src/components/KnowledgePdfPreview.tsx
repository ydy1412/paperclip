import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { knowledgeApi, type KnowledgePdfPreview as PdfPage } from "../api/knowledge";
import { Button } from "./ui/button";

export function KnowledgePdfPreview({plugin,company,id,attachmentId,title,checksum}:{plugin:string;company:string;id:string;attachmentId:string;title:string;checksum?:string|null}) {
  const [page,setPage]=useState(1);
  const preview=useQuery({
    queryKey:["knowledge",company,plugin,"pdf-preview",id,attachmentId,checksum,page],
    queryFn:async()=>{
      const result=await knowledgeApi.read<PdfPage>(plugin,company,"knowledge-pdf-preview",{id,attachmentId,page});
      if (result.page!==page || !Number.isSafeInteger(result.totalPages) || result.totalPages<page ||
          !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width<1 || result.height<1 ||
          result.width>1600 || result.height>1600 || result.imageUrl.length>3*1024*1024 ||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.imageUrl) || (checksum && result.checksum!==checksum)) throw new Error("PDF 미리보기를 확인할 수 없습니다.");
      return result;
    },
    retry:false,
  });
  const image=preview.error?undefined:preview.data;
  return <div className="min-w-0 space-y-2">
    <div className="flex items-center justify-between gap-2">
      <Button variant="ghost" size="icon" aria-label="PDF 이전 페이지" title="이전 페이지" disabled={page===1 || preview.isFetching} onClick={()=>setPage(page-1)}><ChevronLeft className="size-4"/></Button>
      <span className="text-xs text-muted-foreground">{page} / {image?.totalPages??"?"}</span>
      <Button variant="ghost" size="icon" aria-label="PDF 다음 페이지" title="다음 페이지" disabled={!image || page>=image.totalPages || preview.isFetching} onClick={()=>setPage(page+1)}><ChevronRight className="size-4"/></Button>
    </div>
    <div className="flex h-96 min-w-0 items-center justify-center overflow-hidden border border-border bg-background">
      {preview.isLoading?<p role="status" className="text-sm text-muted-foreground">PDF 불러오는 중</p>:preview.error?<div role="alert" className="flex items-center gap-2 px-4 text-sm text-destructive">{preview.error.message}<Button variant="ghost" size="icon" aria-label="PDF 다시 조회" title="다시 조회" onClick={()=>preview.refetch()}><RefreshCw className="size-4"/></Button></div>:image && <img src={image.imageUrl} alt={`${title} ${page}쪽`} width={image.width} height={image.height} className="max-h-full max-w-full object-contain"/>}
    </div>
  </div>;
}
