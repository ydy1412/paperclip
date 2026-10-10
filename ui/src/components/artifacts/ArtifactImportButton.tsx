import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookPlus, Loader2, RefreshCw } from "lucide-react";
import type { CompanyArtifact } from "../../api/artifacts";
import { pluginsApi } from "../../api/plugins";
import { knowledgeApi, type ArtifactImports } from "../../api/knowledge";
import { Button } from "../ui/button";

export function ArtifactImportButton({ artifact, companyId }: {artifact: CompanyArtifact; companyId: string}) {
  const cache=useQueryClient();
  const plugins=useQuery({queryKey:["plugins"],queryFn:()=>pluginsApi.list()});
  const plugin=plugins.error ? undefined : plugins.data?.find(plugin=>plugin.pluginKey==="paperclip-plugin-hindsight" && plugin.status==="ready");
  const key=["knowledge",companyId,plugin?.id,"artifact-imports"];
  // Every card shares this one company-scoped query, rather than polling per file.
  const imports=useQuery({queryKey:key,queryFn:()=>knowledgeApi.read<ArtifactImports>(plugin!.id,companyId,"knowledge-artifact-imports"),enabled:!!plugin,refetchInterval:10_000});
  const entry=imports.error ? undefined : imports.data?.items.find(item=>item.issueId===artifact.issue.id && item.artifactId===artifact.id);
  const action=useMutation({
    mutationFn:()=>knowledgeApi.action(plugin!.id,companyId,entry?.state==="failed" ? "knowledge-retry" : "knowledge-import-artifact",{issueId:artifact.issue.id,artifactId:artifact.id}),
    onSuccess:()=>cache.invalidateQueries({queryKey:["knowledge",companyId]}),
  });
  const processing=entry?.state==="queued" || entry?.state==="processing";
  const label=entry?.state==="failed" ? "지식 가져오기 재시도" : entry?.state==="captured" ? "지식 수집 완료" : processing ? "지식 처리 중" : "지식으로 가져오기";
  const error=action.error?.message ?? imports.error?.message ?? plugins.error?.message ?? entry?.error;
  return <div className="min-w-0">
    <Button variant="ghost" size="icon" aria-label={`${label}: ${artifact.title}`} title={label} disabled={!plugin || imports.isLoading || !!imports.error || action.isPending || processing} onClick={()=>action.mutate()}>
      {action.isPending || processing ? <Loader2 className="h-4 w-4 animate-spin"/> : entry?.state==="failed" ? <RefreshCw className="h-4 w-4"/> : <BookPlus className="h-4 w-4"/>}
    </Button>
    {error && <p role="alert" className="max-w-48 break-words text-xs text-destructive">{error}</p>}
  </div>;
}
