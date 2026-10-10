// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactDeleteButton } from "./ArtifactDeleteButton";
import type { CompanyArtifact } from "../../api/artifacts";

const mock=vi.hoisted(()=>({remove:vi.fn()}));
vi.mock("../../api/artifacts",()=>({artifactsApi:mock}));
const artifact={id:"work_product:wp",source:"work_product",title:"원문 자료",contentPath:"/api/attachments/file/content"} as CompanyArtifact;
let root:Root,container:HTMLDivElement;
async function waitFor(check:()=>void){for(let i=0;i<50;i++){try{check();return;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}check();}
function button(label:string){return [...document.querySelectorAll("button")].find(item=>item.textContent===label)!;}
beforeEach(()=>{vi.clearAllMocks();mock.remove.mockResolvedValue(undefined);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);flushSync(()=>root.render(<QueryClientProvider client={new QueryClient({defaultOptions:{mutations:{retry:false}}})}><ArtifactDeleteButton artifact={artifact} companyId="co"/></QueryClientProvider>));});
afterEach(()=>{flushSync(()=>root.unmount());container.remove();});
describe("artifact deletion confirmation",()=>{
  it("does not mutate before confirmation or after cancellation",()=>{
    flushSync(()=>(container.querySelector("button") as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("원문 자료");
    expect(mock.remove).not.toHaveBeenCalled();
    flushSync(()=>button("취소").click());expect(mock.remove).not.toHaveBeenCalled();
  });
  it("preserves original bytes by default and closes after success",async()=>{
    flushSync(()=>(container.querySelector("button") as HTMLButtonElement).click());
    expect((document.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    flushSync(()=>button("삭제").click());
    await waitFor(()=>expect(mock.remove).toHaveBeenCalledWith(artifact,false));
    await waitFor(()=>expect(document.querySelector('[role="dialog"]')).toBeNull());
  });
  it("keeps the confirmation and selection after a failed deletion",async()=>{
    mock.remove.mockRejectedValue(new Error("삭제 권한 없음"));
    flushSync(()=>(container.querySelector("button") as HTMLButtonElement).click());
    flushSync(()=>(document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    flushSync(()=>button("삭제").click());
    await waitFor(()=>expect(document.querySelector('[role="alert"]')?.textContent).toContain("삭제 권한 없음"));
    expect(mock.remove).toHaveBeenCalledWith(artifact,true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
