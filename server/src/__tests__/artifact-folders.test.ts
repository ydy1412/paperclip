import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@paperclipai/db";
import { artifactFolderService } from "../services/artifact-folders.js";
import { createFolderSchema, moveArtifactFolderEntrySchema, folderKindSchema } from "@paperclipai/shared";

function fixture(rows:unknown[][]){
  const where=vi.fn();for(const row of rows)where.mockResolvedValueOnce(row);
  const upsert=vi.fn(async()=>{}),values=vi.fn(()=>({onConflictDoUpdate:upsert})),remove=vi.fn(async()=>{});
  const tx={execute:vi.fn(async()=>{}),select:vi.fn(()=>({from:()=>({where})})),insert:vi.fn(()=>({values})),delete:vi.fn(()=>({where:remove}))};
  const db={transaction:vi.fn(async(operation:Function)=>operation(tx))} as unknown as Db;
  return {service:artifactFolderService(db),tx,where,values,upsert,remove};
}
describe("artifact folder membership",()=>{
  it("reuses the established folder kind and validates projected identifiers",()=>{
    expect(folderKindSchema.parse("artifact")).toBe("artifact");
    expect(createFolderSchema.parse({kind:"artifact",name:"  개발 자료  "}).name).toBe("개발 자료");
    expect(moveArtifactFolderEntrySchema.safeParse({artifactId:"work_product:00000000-0000-4000-8000-000000000001",folderId:null}).success).toBe(true);
    expect(moveArtifactFolderEntrySchema.safeParse({artifactId:"task:123",folderId:null}).success).toBe(false);
  });
  it("checks company and artifact kind before idempotent placement",async()=>{
    const f=fixture([[{id:"folder"}],[{id:"source"}]]);
    await expect(f.service.moveEntry("co","work_product:source","folder")).resolves.toEqual({artifactId:"work_product:source",folderId:"folder"});
    const condition=f.where.mock.calls[0][0];
    expect(new PgDialect().sqlToQuery(condition).params).toEqual(["co","folder","artifact"]);
    expect(f.values).toHaveBeenCalledWith({companyId:"co",artifactId:"work_product:source",folderId:"folder"});
    expect(f.upsert).toHaveBeenCalledOnce();
    expect(f.tx.execute).toHaveBeenCalledOnce();
  });
  it("rejects missing/foreign/wrong-kind destinations before mutation",async()=>{
    const f=fixture([[]]);
    await expect(f.service.moveEntry("co","attachment:source","foreign")).rejects.toThrow("this company");
    expect(f.values).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();
  });
  it("rejects artifacts outside the company",async()=>{
    const f=fixture([[{id:"folder"}],[]]);
    await expect(f.service.moveEntry("co","document:foreign","folder")).rejects.toThrow("this company");
    expect(new PgDialect().sqlToQuery(f.where.mock.calls[1][0]).params).toEqual(["co","foreign"]);
    expect(f.values).not.toHaveBeenCalled();
  });
  it("moves a valid artifact out without deleting its content",async()=>{
    const f=fixture([[{id:"source"}]]);
    await expect(f.service.moveEntry("co","attachment:source",null)).resolves.toEqual({artifactId:"attachment:source",folderId:null});
    expect(f.remove).toHaveBeenCalledOnce();expect(f.values).not.toHaveBeenCalled();
  });
});
