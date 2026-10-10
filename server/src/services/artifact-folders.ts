import { and, eq, sql } from "drizzle-orm";
import { folders, artifactFolderEntries, issueDocuments, issueAttachments, issueWorkProducts, type Db } from "@paperclipai/db";
import { notFound } from "../errors.js";

export function artifactFolderService(db:Db) {
  return {
    moveEntry:async(companyId:string,artifactId:string,folderId:string|null)=>db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`paperclip:folders:${companyId}`}, 0))`);
      if(folderId){
        const target=await tx.select({id:folders.id}).from(folders).where(and(eq(folders.companyId,companyId),eq(folders.id,folderId),eq(folders.kind,"artifact")));
        if(!target.length) throw notFound("Artifact folder not found in this company");
      }
      const [source,id]=artifactId.split(":");
      let found=false;
      if(source==="document") found=(await tx.select({id:issueDocuments.id}).from(issueDocuments).where(and(eq(issueDocuments.companyId,companyId),eq(issueDocuments.documentId,id)))).length>0;
      else if(source==="attachment") found=(await tx.select({id:issueAttachments.id}).from(issueAttachments).where(and(eq(issueAttachments.companyId,companyId),eq(issueAttachments.id,id)))).length>0;
      else if(source==="work_product") found=(await tx.select({id:issueWorkProducts.id}).from(issueWorkProducts).where(and(eq(issueWorkProducts.companyId,companyId),eq(issueWorkProducts.id,id)))).length>0;
      if(!found) throw notFound("Artifact not found in this company");
      if(!folderId){
        await tx.delete(artifactFolderEntries).where(and(eq(artifactFolderEntries.companyId,companyId),eq(artifactFolderEntries.artifactId,artifactId)));
      }else{
        await tx.insert(artifactFolderEntries).values({companyId,artifactId,folderId}).onConflictDoUpdate({target:[artifactFolderEntries.companyId,artifactFolderEntries.artifactId],set:{folderId,updatedAt:new Date()}});
      }
      return {artifactId,folderId};
    }),
  };
}
