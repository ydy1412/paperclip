// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Knowledge } from "./Knowledge";

const mock=vi.hoisted(()=>({read:vi.fn(),action:vi.fn(),list:vi.fn()}));
vi.mock("../context/CompanyContext",()=>({useCompany:()=>({selectedCompanyId:"co"})}));
vi.mock("../context/BreadcrumbContext",()=>({useBreadcrumbs:()=>({setBreadcrumbs:vi.fn()})}));
vi.mock("../api/plugins",()=>({pluginsApi:{list:mock.list}}));
vi.mock("../api/knowledge",()=>({knowledgeApi:{read:mock.read,action:mock.action}}));
vi.mock("../components/MarkdownBody",()=>({MarkdownBody:({children}:{children:React.ReactNode})=><div>{children}</div>}));

const page={id:"page",projectId:"pr",category:"decisions",title:"결정 사항",summary:"PostgreSQL 선택",body:"검증된 한글 본문",bodyHash:"hash",review:"pending",generationStatus:"ready",updatedAt:"2026-10-05T00:00:00Z",reviewLog:[]};
async function waitFor(assertion:()=>void){for(let i=0;i<50;i++){try{assertion();return;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}assertion();}
let root:Root,container:HTMLDivElement;
function render(path="/knowledge"){
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
  root=createRoot(container);flushSync(()=>root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><Knowledge/></QueryClientProvider></MemoryRouter>));
}
beforeEach(()=>{
  vi.clearAllMocks();container=document.createElement("div");document.body.appendChild(container);
  mock.list.mockResolvedValue([{id:"plugin",pluginKey:"paperclip-plugin-hindsight",status:"ready"}]);
  mock.read.mockImplementation(async(_plugin:string,_company:string,key:string)=>{
    if(key==="knowledge-list")return {items:[page],total:1,page:1,pageSize:20,projects:[{id:"pr",name:"검증 프로젝트"}],categories:[{key:"decisions",title:"결정 사항"}]};
    if(key==="knowledge-detail")return page;
    if(key==="knowledge-usage")return {retrievals:0,citations:0,recent:[]};
    if(key==="knowledge-status")return {connected:true,sourceCount:1,jobs:[],settings:{enabled:true,since:"2026-10-05",historicalProjects:[]}};
    return {items:[],reviews:[],generation:[]};
  });
});
afterEach(()=>{if(root)flushSync(()=>root.unmount());container.remove();});
describe("Knowledge page",()=>{
  it("shows the last successful collection time and an explicit empty state",async()=>{
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-status"?{connected:true,sourceCount:1,jobs:[],settings:{enabled:true},lastCollectedAt:"2026-10-06T01:00:00Z"}:original(plugin,company,key,params));
    render();await waitFor(()=>expect(container.textContent).toContain("마지막 수집"));
    expect(container.textContent).not.toContain("수집 완료 기록 없음");
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-status"?{connected:true,sourceCount:0,jobs:[],settings:{enabled:true},lastCollectedAt:null}:original(plugin,company,key,params));
    flushSync(()=>(container.querySelector('[aria-label="다시 조회"]') as HTMLButtonElement).click());
    await waitFor(()=>expect(container.textContent).toContain("수집 완료 기록 없음"));
  });
  it("previews PDF and image references without claiming unanalysed files were read",async()=>{
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-references"?{items:[
      {id:"pdf",title:"원문 PDF",contentType:"application/pdf",href:"/api/attachments/pdf/content",analyzed:false,warning:"본문 미분석",issueTitle:"원본 작업"},
      {id:"image",title:"설계 이미지",contentType:"image/png",href:"/api/attachments/image/content",analyzed:false,warning:null,issueTitle:"원본 작업"},
    ]}:key==="knowledge-pdf-preview"?{page:1,totalPages:1,width:800,height:1000,imageUrl:"data:image/jpeg;base64,YQ==",checksum:"hash"}:original(plugin,company,key,params));
    render("/knowledge?id=page&tab=references");
    await waitFor(()=>expect(container.querySelector('img[alt="원문 PDF 1쪽"]')?.getAttribute("src")).toBe("data:image/jpeg;base64,YQ=="));
    expect(container.querySelector('img[alt="설계 이미지"]')).not.toBeNull();
    expect(container.textContent).toContain("본문 미분석");
    expect(container.textContent).not.toContain("분석 완료");
  });
  it("shows extraction evidence, uncertainty, checksum and exact original PDF page links",async()=>{
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-references"?{items:[{id:"pdf",title:"원문 PDF",contentType:"application/pdf",href:"/api/attachments/pdf/content",analyzed:true,checksum:"abc123",warning:"AI 이미지 해석이 포함되어 원문과 차이가 있을 수 있습니다.",issueTitle:"원본 작업",evidence:[{page:2,method:"vision",text:"A에서 B로 연결"}]}]}:original(plugin,company,key,params));
    render("/knowledge?id=page&tab=references");
    await waitFor(()=>expect(container.textContent).toContain("SHA-256: abc123"));
    expect(container.textContent).toContain("원문과 차이가 있을 수");
    expect(container.textContent).toContain("A에서 B로 연결");
    expect(container.querySelector('a[href="/api/attachments/pdf/content#page=2"]')).not.toBeNull();
    expect(container.querySelector("summary")?.textContent).toContain("2쪽 · AI 이미지 해석");
  });
  it("hides cached reference previews after a permission failure",async()=>{
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-references"?{items:[{id:"image",title:"원문 이미지",contentType:"image/png",href:"/api/attachments/image/content",analyzed:false,issueTitle:"원본"}]}:original(plugin,company,key,params));
    render("/knowledge?id=page&tab=references");await waitFor(()=>expect(container.querySelector("img")).not.toBeNull());
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-references"?Promise.reject(new Error("접근 권한 없음")):original(plugin,company,key,params));
    flushSync(()=>(container.querySelector('[aria-label="다시 조회"]') as HTMLButtonElement).click());
    await waitFor(()=>expect(container.textContent).toContain("접근 권한 없음"));
    expect(container.querySelector("img")).toBeNull();
  });
  it("places the selected project immediately below search",async()=>{
    render("/knowledge?project=pr");
    await waitFor(()=>expect(container.querySelector('[aria-label="프로젝트 선택 영역"] h3')?.textContent).toBe("검증 프로젝트"));
    const search=container.querySelector('[aria-label="지식 검색"]')!;
    expect(search.parentElement?.nextElementSibling?.getAttribute("aria-label")).toBe("프로젝트 선택 영역");
    expect(mock.read).toHaveBeenCalledWith("plugin","co","knowledge-list",expect.objectContaining({projectId:"pr"}));
  });
  it("does not label generated knowledge as requiring review",async()=>{
    render();await waitFor(()=>expect(container.textContent).toContain("PostgreSQL 선택"));
    expect(container.textContent).not.toContain("검토 필요");
    expect(mock.action).not.toHaveBeenCalled();
  });
  it("exposes collection control without opening settings",async()=>{
    render();await waitFor(()=>expect((container.querySelector('[aria-label="자동 수집"]') as HTMLInputElement)?.checked).toBe(true));
    flushSync(()=>(container.querySelector('[aria-label="자동 수집"]') as HTMLInputElement).click());
    await waitFor(()=>expect(mock.action).toHaveBeenCalledWith("plugin","co","knowledge-settings",{enabled:false}));
  });
  it("disables collection changes when status cannot be read",async()=>{
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-status"?Promise.reject(new Error("상태 조회 실패")):original(plugin,company,key,params));
    render();await waitFor(()=>expect(container.textContent).toContain("상태 조회 실패"));
    expect((container.querySelector('[aria-label="자동 수집"]') as HTMLInputElement).disabled).toBe(true);
  });
  it("loads the selected company through plugin bridge and renders knowledge rather than artifacts",async()=>{
    render();await waitFor(()=>{expect(container.textContent).toContain("PostgreSQL 선택");expect(container.textContent).toContain("Hindsight 연결됨");});
    expect(mock.read).toHaveBeenCalledWith("plugin","co","knowledge-list",expect.objectContaining({page:1}));
    expect(container.querySelector('[aria-label="프로젝트"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="지식 목록"] p')?.textContent).toBe("결정 사항");
  });
  it("shows detail and confirms the exact displayed body hash",async()=>{
    render("/knowledge?id=page");await waitFor(()=>expect(container.textContent).toContain("검증된 한글 본문"));
    const confirm=[...container.querySelectorAll("button")].find(b=>b.textContent==="내용 확인")!;
    flushSync(()=>confirm.click());await waitFor(()=>expect(mock.action).toHaveBeenCalledWith("plugin","co","knowledge-review",{id:"page",bodyHash:"hash"}));
  });
  it("opens a selected list item without losing its selection to a second URL update",async()=>{
    render();await waitFor(()=>expect(container.textContent).toContain("PostgreSQL 선택"));
    const item=container.querySelector('[aria-label="지식 목록"] button') as HTMLButtonElement;
    flushSync(()=>item.click());await waitFor(()=>expect(container.textContent).toContain("검증된 한글 본문"));
    expect(mock.read).toHaveBeenCalledWith("plugin","co","knowledge-detail",{id:"page"});
  });
  it("renders failures and a retry control",async()=>{
    mock.read.mockRejectedValue(new Error("서버 연결 실패"));render();
    await waitFor(()=>expect(container.querySelector('[role="alert"]')?.textContent).toContain("서버 연결 실패"));
    expect([...container.querySelectorAll("button")].some(b=>b.textContent==="재시도")).toBe(true);
  });
  it("keeps mobile back navigation usable when a selected document cannot be read",async()=>{
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-detail"?Promise.reject(new Error("원본 접근 권한을 확인할 수 없습니다.")):original(plugin,company,key,params));
    render("/knowledge?id=page");
    await waitFor(()=>expect(container.querySelector('[role="alert"]')?.textContent).toContain("원본 접근 권한"));
    const back=[...container.querySelectorAll("button")].find(button=>button.textContent==="목록")!;
    expect(back).toBeDefined();flushSync(()=>back.click());
    await waitFor(()=>expect(container.querySelector('[aria-label="지식 목록"]')?.className).not.toContain("hidden"));
  });
  it("hides cached document content when a later permission check fails",async()=>{
    render("/knowledge?id=page");
    await waitFor(()=>expect(container.textContent).toContain("검증된 한글 본문"));
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-detail"?Promise.reject(new Error("원본 접근 권한을 확인할 수 없습니다.")):original(plugin,company,key,params));
    flushSync(()=>(container.querySelector('[aria-label="다시 조회"]') as HTMLButtonElement).click());
    await waitFor(()=>expect(container.querySelector('[role="alert"]')?.textContent).toContain("원본 접근 권한"));
    expect(container.textContent).not.toContain("검증된 한글 본문");
    expect([...container.querySelectorAll("button")].some(button=>button.textContent==="내용 확인")).toBe(false);
  });
  it("hides cached history when a later permission check fails",async()=>{
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-history"?{reviews:[],generation:[{previous_content:"기존 이력 본문"}]}:original(plugin,company,key,params));
    render("/knowledge?id=page&tab=history");
    await waitFor(()=>expect(container.textContent).toContain("기존 이력 본문"));
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-history"?Promise.reject(new Error("이력 접근 권한 없음")):original(plugin,company,key,params));
    flushSync(()=>(container.querySelector('[aria-label="다시 조회"]') as HTMLButtonElement).click());
    await waitFor(()=>expect(container.querySelector('[role="alert"]')?.textContent).toContain("이력 접근 권한 없음"));
    expect(container.textContent).not.toContain("기존 이력 본문");
  });
  it("does not query a disabled plugin",async()=>{
    mock.list.mockResolvedValue([{id:"plugin",pluginKey:"paperclip-plugin-hindsight",status:"disabled"}]);render();
    await waitFor(()=>expect(container.textContent).toContain("플러그인 연결이 필요"));expect(mock.read).not.toHaveBeenCalled();
  });
  it("renders provider history timestamps, previous content and failed generation",async()=>{
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-history"?{
      reviews:[],generation:[{changed_at:"2026-10-05T00:00:00Z",previous_content:"이전의 검증된 지식"},{changed_at:"2026-10-04T00:00:00Z",kind:"refresh_failed",error_message:"모델 응답 실패"}],
    }:original(plugin,company,key,params));
    render("/knowledge?id=page&tab=history");
    await waitFor(()=>{expect(container.textContent).toContain("이전의 검증된 지식");expect(container.textContent).toContain("모델 응답 실패");});
  });
  it("distinguishes redacted historical content from an empty first version",async()=>{
    const original=mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async(plugin,company,key,params)=>key==="knowledge-history"?{
      reviews:[],generation:[{changed_at:"2026-10-05T00:00:00Z",previous_content:null,redacted:true}],
    }:original(plugin,company,key,params));
    render("/knowledge?id=page&tab=history");
    await waitFor(()=>expect(container.textContent).toContain("원본 접근 권한을 확인할 수 없어 이전 내용을 표시하지 않습니다."));
    expect(container.textContent).not.toContain("첫 생성 기록");
  });
});
