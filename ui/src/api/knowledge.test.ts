import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { knowledgeApi } from "./knowledge";

const bridge=vi.hoisted(()=>({bridgeGetData:vi.fn(),bridgePerformAction:vi.fn()}));
vi.mock("./plugins",()=>({pluginsApi:bridge}));
beforeEach(()=>vi.clearAllMocks());

describe("Knowledge bridge errors",()=>{
  it("keeps successful data and authenticated company scope intact",async()=>{
    bridge.bridgeGetData.mockResolvedValue({data:{items:[]}});
    expect(await knowledgeApi.read("plugin","company","knowledge-list",{page:2})).toEqual({items:[]});
    expect(bridge.bridgeGetData).toHaveBeenCalledWith("plugin","knowledge-list",{page:2},"company");
  });
  it("explains source revocation rather than displaying a generic HTTP 502",async()=>{
    bridge.bridgeGetData.mockRejectedValue(new ApiError("Request failed: 502",502,{code:"WORKER_ERROR",message:"원본 접근 권한을 확인할 수 없습니다."}));
    await expect(knowledgeApi.read("plugin","company","knowledge-detail")).rejects.toThrow("원본 자료의 접근 권한을 확인할 수 없습니다.");
  });
  it("explains concurrent generation invalidating the displayed review hash",async()=>{
    bridge.bridgePerformAction.mockRejectedValue(new ApiError("Request failed: 502",502,{code:"WORKER_ERROR",message:"문서가 변경되었습니다. 새 내용을 확인하세요."}));
    await expect(knowledgeApi.action("plugin","company","knowledge-review")).rejects.toThrow("새 내용을 확인한 뒤 다시 검토");
  });
  it.each(["TIMEOUT","WORKER_UNAVAILABLE","CAPABILITY_DENIED","UNKNOWN"])("does not expose raw worker details for %s",async code=>{
    bridge.bridgeGetData.mockRejectedValue(new ApiError("Request failed: 502",502,{code,message:"private source body and native provider prompt",details:{secret:"not for rendering"}}));
    const error=await knowledgeApi.read("plugin","company","knowledge-detail").catch(error=>error);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected a bridge failure");
    expect(error.message).not.toContain("private");
    expect(error.message).not.toContain("not for rendering");
    expect(error.message).not.toContain("502");
  });
});
