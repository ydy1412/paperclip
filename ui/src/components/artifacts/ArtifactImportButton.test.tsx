// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactImportButton } from "./ArtifactImportButton";
import type { CompanyArtifact } from "../../api/artifacts";

const mock=vi.hoisted(()=>({list:vi.fn(),read:vi.fn(),action:vi.fn()}));
vi.mock("../../api/plugins",()=>({pluginsApi:{list:mock.list}}));
vi.mock("../../api/knowledge",()=>({knowledgeApi:{read:mock.read,action:mock.action}}));
const artifact={id:"document:doc",title:"참고 자료",issue:{id:"issue"}} as CompanyArtifact;
let root:Root,container:HTMLDivElement;
async function waitFor(check:()=>void){for(let i=0;i<50;i++){try{check();return;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}check();}
function render(count=1){flushSync(()=>root.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>{Array.from({length:count},(_,i)=><ArtifactImportButton key={i} artifact={artifact} companyId="co"/>)}</QueryClientProvider>));}
beforeEach(()=>{vi.clearAllMocks();mock.list.mockResolvedValue([{id:"plugin",pluginKey:"paperclip-plugin-hindsight",status:"ready"}]);mock.read.mockResolvedValue({items:[]});mock.action.mockResolvedValue({queued:true});container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(()=>{flushSync(()=>root.unmount());container.remove();});
describe("artifact knowledge imports",()=>{
  it("shares status reads across cards and sends explicit artifact/issue scope",async()=>{
    render(2);
    await waitFor(()=>expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(false));
    expect(mock.read).toHaveBeenCalledTimes(1);
    flushSync(()=>(container.querySelector("button") as HTMLButtonElement).click());
    await waitFor(()=>expect(mock.action).toHaveBeenCalledWith("plugin","co","knowledge-import-artifact",{issueId:"issue",artifactId:"document:doc"}));
  });
  it("disables duplicate imports while queued",async()=>{
    mock.read.mockResolvedValue({items:[{issueId:"issue",artifactId:"document:doc",state:"queued"}]});render();
    await waitFor(()=>expect(container.querySelector("button")?.getAttribute("aria-label")).toContain("지식 처리 중"));
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect(mock.action).not.toHaveBeenCalled();
  });
  it("retries the selected issue's failed work instead of all company jobs",async()=>{
    mock.read.mockResolvedValue({items:[{issueId:"issue",artifactId:"document:doc",state:"failed",error:"가져오기 실패"}]});render();
    await waitFor(()=>expect(container.querySelector("button")?.getAttribute("aria-label")).toContain("재시도"));
    flushSync(()=>(container.querySelector("button") as HTMLButtonElement).click());
    await waitFor(()=>expect(mock.action).toHaveBeenCalledWith("plugin","co","knowledge-retry",{issueId:"issue",artifactId:"document:doc"}));
  });
  it("keeps failures visible and never mutates before a click",async()=>{
    mock.action.mockRejectedValue(new Error("가져오기 권한 없음"));render();
    await waitFor(()=>expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(false));
    expect(mock.action).not.toHaveBeenCalled();
    flushSync(()=>(container.querySelector("button") as HTMLButtonElement).click());
    await waitFor(()=>expect(container.querySelector('[role="alert"]')?.textContent).toContain("가져오기 권한 없음"));
  });
  it("shows capture completion separately from a pending import",async()=>{
    mock.read.mockResolvedValue({items:[{issueId:"issue",artifactId:"document:doc",state:"captured"}]});render();
    await waitFor(()=>expect(container.querySelector("button")?.getAttribute("aria-label")).toContain("지식 수집 완료"));
    expect(mock.action).not.toHaveBeenCalled();
  });
  it("disables import when the authoritative status cannot be read",async()=>{
    mock.read.mockRejectedValue(new Error("상태 조회 권한 없음"));render();
    await waitFor(()=>expect(container.querySelector('[role="alert"]')?.textContent).toContain("상태 조회 권한 없음"));
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect(mock.action).not.toHaveBeenCalled();
  });
});
