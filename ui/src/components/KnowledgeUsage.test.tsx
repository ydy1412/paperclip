// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeUsage } from "./KnowledgeUsage";

const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("../api/knowledge",()=>({knowledgeApi:{read:mock.read}}));
vi.mock("@/lib/router",()=>({Link:({to,children}:{to:string;children:React.ReactNode})=><a href={to}>{children}</a>}));
let root:Root,container:HTMLDivElement,client:QueryClient;
async function waitFor(check:()=>void){for(let i=0;i<60;i++){try{check();return;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}check();}
function render(page="page"){flushSync(()=>root.render(<QueryClientProvider client={client}><KnowledgeUsage plugin="plugin" company="co" page={page}/></QueryClientProvider>));}
beforeEach(()=>{vi.clearAllMocks();mock.read.mockResolvedValue({retrievals:3,citations:1,recent:[{runId:"run",agentId:"agent",agentName:"Hermes",issueId:"issue",issueTitle:"결과물 작업",kind:"citation",artifactId:"document:doc",at:"2026-10-06T00:00:00Z"}]});client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(()=>{flushSync(()=>root.unmount());client.clear();container.remove();});
describe("Knowledge usage",()=>{
  it("shows separated counters and actual recent agent/task links without recording a view",async()=>{
    render();await waitFor(()=>expect(container.querySelectorAll("dd")).toHaveLength(2));
    expect([...container.querySelectorAll("dd")].map(item=>item.textContent)).toEqual(["3","1"]);
    expect(container.textContent).toContain("Hermes");expect(container.textContent).toContain("인용");
    expect(container.querySelector('a[href="/agents/agent"]')).not.toBeNull();expect(container.querySelector('a[href="/issues/issue"]')).not.toBeNull();
    expect(mock.read).toHaveBeenCalledWith("plugin","co","knowledge-usage",{id:"page"});expect(mock.read).toHaveBeenCalledTimes(1);
  });
  it("shows zero counts and a distinct empty state",async()=>{
    mock.read.mockResolvedValue({retrievals:0,citations:0,recent:[]});render();await waitFor(()=>expect(container.textContent).toContain("표시할 최근 활용 내역이 없습니다"));
    expect([...container.querySelectorAll("dd")].map(item=>item.textContent)).toEqual(["0","0"]);
  });
  it("shows loading without pretending the count is zero",()=>{
    mock.read.mockReturnValue(new Promise(()=>{}));render();expect(container.querySelector('[role="status"]')?.textContent).toContain("불러오는 중");expect(container.querySelector("dd")).toBeNull();
  });
  it("hides cached attribution and counters after a permission failure",async()=>{
    render();await waitFor(()=>expect(container.textContent).toContain("Hermes"));mock.read.mockRejectedValue(new Error("권한 없음"));
    await client.invalidateQueries({queryKey:["knowledge","co","plugin","usage","page"]});
    await waitFor(()=>expect(container.querySelector('[role="alert"]')).not.toBeNull());expect(container.textContent).not.toContain("Hermes");expect(container.querySelector("dd")).toBeNull();
  });
  it("does not carry the previous page's counts into a newly selected page",async()=>{
    render();await waitFor(()=>expect(container.textContent).toContain("Hermes"));mock.read.mockReturnValue(new Promise(()=>{}));render("other");
    expect(container.textContent).not.toContain("Hermes");expect(container.querySelector("dd")).toBeNull();
  });
});
