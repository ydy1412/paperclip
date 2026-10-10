// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgePdfPreview } from "./KnowledgePdfPreview";

const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("../api/knowledge",()=>({knowledgeApi:{read:mock.read}}));
let root:Root,container:HTMLDivElement,client:QueryClient;
function render(id="page",company="co") {flushSync(()=>root.render(<QueryClientProvider client={client}><KnowledgePdfPreview key={`${company}:${id}`} plugin="plugin" company={company} id={id} attachmentId="pdf" title="원문 PDF" checksum="hash"/></QueryClientProvider>));}
async function waitFor(check:()=>void){for(let i=0;i<80;i++){try{check();return;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}check();}
function click(label:string){flushSync(()=>(container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click());}
beforeEach(()=>{vi.clearAllMocks();mock.read.mockImplementation(async(_plugin,_company,_key,params)=>({page:params.page,totalPages:2,width:800,height:1000,checksum:"hash",imageUrl:"data:image/jpeg;base64,YQ=="}));client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(()=>{flushSync(()=>root.unmount());client.clear();container.remove();});
describe("Knowledge PDF original preview",()=>{
  it("renders authorized original pixels and navigates within page bounds",async()=>{
    render();await waitFor(()=>expect(container.querySelector("img")?.alt).toBe("원문 PDF 1쪽"));
    expect((container.querySelector('[aria-label="PDF 이전 페이지"]') as HTMLButtonElement).disabled).toBe(true);
    click("PDF 다음 페이지");await waitFor(()=>expect(container.querySelector("img")?.alt).toBe("원문 PDF 2쪽"));
    expect(mock.read).toHaveBeenLastCalledWith("plugin","co","knowledge-pdf-preview",{id:"page",attachmentId:"pdf",page:2});
    expect((container.querySelector('[aria-label="PDF 다음 페이지"]') as HTMLButtonElement).disabled).toBe(true);
    click("PDF 이전 페이지");await waitFor(()=>expect(container.querySelector("img")?.alt).toBe("원문 PDF 1쪽"));
  });
  it("clears cached pixels after permission loss and provides retry",async()=>{
    render();await waitFor(()=>expect(container.querySelector("img")).not.toBeNull());
    mock.read.mockRejectedValue(new Error("원본 접근 권한 없음"));await client.invalidateQueries({queryKey:["knowledge","co","plugin","pdf-preview"]});
    await waitFor(()=>expect(container.textContent).toContain("원본 접근 권한 없음"));expect(container.querySelector("img")).toBeNull();
    mock.read.mockResolvedValue({page:1,totalPages:2,width:800,height:1000,checksum:"hash",imageUrl:"data:image/jpeg;base64,YQ=="});click("PDF 다시 조회");await waitFor(()=>expect(container.querySelector("img")).not.toBeNull());
  });
  it.each([{imageUrl:"https://foreign.example/image"},{checksum:"changed"},{width:1601},{page:3}])("rejects malformed or changed original output %j",async(patch)=>{
    mock.read.mockResolvedValue({page:1,totalPages:2,width:800,height:1000,checksum:"hash",imageUrl:"data:image/jpeg;base64,YQ==",...patch});render();
    await waitFor(()=>expect(container.textContent).toContain("PDF 미리보기를 확인할 수 없습니다"));expect(container.querySelector("img")).toBeNull();
  });
  it("resets navigation and does not retain pixels across knowledge scope changes",async()=>{
    render();await waitFor(()=>expect(container.querySelector("img")).not.toBeNull());click("PDF 다음 페이지");await waitFor(()=>expect(container.querySelector("img")?.alt).toBe("원문 PDF 2쪽"));
    mock.read.mockImplementation(()=>new Promise(()=>{}));render("other","foreign");expect(container.querySelector("img")).toBeNull();expect(container.textContent).toContain("PDF 불러오는 중");
    expect(mock.read).toHaveBeenLastCalledWith("plugin","foreign","knowledge-pdf-preview",{id:"other",attachmentId:"pdf",page:1});
  });
});
