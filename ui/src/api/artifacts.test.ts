import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));
const issueCalls=vi.hoisted(()=>({listDocuments:vi.fn(),deleteDocument:vi.fn(),listWorkProducts:vi.fn(),deleteWorkProduct:vi.fn(),listAttachments:vi.fn(),deleteAttachment:vi.fn()}));
vi.mock("./issues",()=>({issuesApi:issueCalls}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { artifactsApi, type CompanyArtifact } from "./artifacts";

function sampleArtifact(overrides: Partial<CompanyArtifact> = {}): CompanyArtifact {
  return {
    id: "wp-1",
    source: "work_product",
    mediaKind: "video",
    title: "Primary cut",
    previewText: null,
    contentType: "video/mp4",
    contentPath: "/files/wp-1.mp4",
    openPath: "/files/wp-1.mp4",
    downloadPath: "/files/wp-1.mp4?download=1",
    issue: { id: "issue-1", identifier: "PAP-10205", title: "Demo reel" },
    project: { id: "proj-1", name: "Paperclip App" },
    createdByAgent: { id: "agent-1", name: "ClaudeCoder" },
    updatedAt: "2026-06-01T00:00:00.000Z",
    href: "/issues/PAP-10205#work-product-wp-1",
    ...overrides,
  };
}

describe("artifactsApi.list", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.get.mockResolvedValue({ artifacts: [], nextCursor: null });
  });

  it("calls the company-scoped artifacts endpoint with no params", async () => {
    await artifactsApi.list("company-1");
    expect(mockApi.get).toHaveBeenCalledWith("/companies/company-1/artifacts");
  });

  it("omits the kind param when filtering by all", async () => {
    await artifactsApi.list("company-1", { kind: "all" });
    expect(mockApi.get).toHaveBeenCalledWith("/companies/company-1/artifacts");
  });

  it("serializes kind, project, search, and pagination params", async () => {
    await artifactsApi.list("company-1", {
      kind: "video",
      projectId: "proj-1",
      q: "demo reel",
      limit: 24,
      cursor: "abc",
    });
    expect(mockApi.get).toHaveBeenCalledWith(
      "/companies/company-1/artifacts?kind=video&projectId=proj-1&q=demo+reel&limit=24&cursor=abc",
    );
  });

  it("omits groupBy when grouping is none", async () => {
    await artifactsApi.list("company-1", { groupBy: "none" });
    expect(mockApi.get).toHaveBeenCalledWith("/companies/company-1/artifacts");
  });

  it("serializes groupBy and the selected stack issue", async () => {
    await artifactsApi.list("company-1", {
      groupBy: "parent_task",
      groupIssueId: "issue-9",
      kind: "image",
    });
    expect(mockApi.get).toHaveBeenCalledWith(
      "/companies/company-1/artifacts?kind=image&groupBy=parent_task&groupIssueId=issue-9",
    );
  });

  it("preserves groups and selectedGroup from the envelope", async () => {
    const artifact = sampleArtifact();
    const group = {
      id: "task:issue-1",
      groupBy: "task" as const,
      issue: artifact.issue,
      title: "Demo reel",
      count: 3,
      mediaKinds: ["video" as const],
      previewArtifacts: [artifact],
      updatedAt: "2026-06-01T00:00:00.000Z",
      href: "/PAP/artifacts?groupBy=task&groupIssueId=issue-1",
    };
    mockApi.get.mockResolvedValue({ artifacts: [], groups: [group], nextCursor: "next" });
    const result = await artifactsApi.list("company-1", { groupBy: "task" });
    expect(result.groups).toEqual([group]);
    expect(result.nextCursor).toBe("next");
  });

  it("returns the envelope shape from the backend", async () => {
    const artifact = sampleArtifact();
    mockApi.get.mockResolvedValue({ artifacts: [artifact], nextCursor: "next" });
    const result = await artifactsApi.list("company-1");
    expect(result).toEqual({ artifacts: [artifact], nextCursor: "next" });
  });

  it("normalizes a bare array response into the envelope shape", async () => {
    const artifact = sampleArtifact();
    mockApi.get.mockResolvedValue([artifact]);
    const result = await artifactsApi.list("company-1");
    expect(result).toEqual({ artifacts: [artifact], nextCursor: null });
  });
});

describe("artifactsApi.remove",()=>{
  beforeEach(()=>{vi.clearAllMocks();issueCalls.listWorkProducts.mockResolvedValue([{id:"wp-1",metadata:{attachmentId:"file-1"}}]);issueCalls.listAttachments.mockResolvedValue([{id:"file-1"}]);});
  it("removes only a registration by default",async()=>{
    await artifactsApi.remove(sampleArtifact({id:"work_product:wp-1"}));
    expect(issueCalls.deleteWorkProduct).toHaveBeenCalledWith("wp-1");
    expect(issueCalls.deleteAttachment).not.toHaveBeenCalled();
  });
  it("removes explicitly selected attachment bytes before the registration",async()=>{
    await artifactsApi.remove(sampleArtifact({id:"work_product:wp-1"}),true);
    expect(issueCalls.deleteAttachment).toHaveBeenCalledWith("file-1");
    expect(issueCalls.deleteAttachment.mock.invocationCallOrder[0]).toBeLessThan(issueCalls.deleteWorkProduct.mock.invocationCallOrder[0]);
  });
  it("does not remove the registration when attachment deletion fails",async()=>{
    issueCalls.deleteAttachment.mockRejectedValueOnce(new Error("permission denied"));
    await expect(artifactsApi.remove(sampleArtifact({id:"work_product:wp-1"}),true)).rejects.toThrow("permission denied");
    expect(issueCalls.deleteWorkProduct).not.toHaveBeenCalled();
  });
  it("can retry after attachment removal without deleting the file twice",async()=>{
    issueCalls.listAttachments.mockResolvedValueOnce([]);
    await artifactsApi.remove(sampleArtifact({id:"work_product:wp-1"}),true);
    expect(issueCalls.deleteAttachment).not.toHaveBeenCalled();
    expect(issueCalls.deleteWorkProduct).toHaveBeenCalledWith("wp-1");
  });
  it("resolves document keys from the actual ID rather than display title",async()=>{
    issueCalls.listDocuments.mockResolvedValue([{id:"doc-1",key:"notes/v1"}]);
    await artifactsApi.remove(sampleArtifact({id:"document:doc-1",source:"document",title:"not the key"}));
    expect(issueCalls.deleteDocument).toHaveBeenCalledWith("issue-1","notes/v1");
  });
  it("rejects mismatched projected IDs before any API mutation",async()=>{
    await expect(artifactsApi.remove(sampleArtifact({id:"attachment:wp-1"}))).rejects.toThrow("식별자");
    expect(issueCalls.listWorkProducts).not.toHaveBeenCalled();
    expect(issueCalls.deleteAttachment).not.toHaveBeenCalled();
  });
  it("deletes a directly attached artifact through its authorized endpoint",async()=>{
    await artifactsApi.remove(sampleArtifact({id:"attachment:file-1",source:"attachment"}));
    expect(issueCalls.deleteAttachment).toHaveBeenCalledWith("file-1");
  });
});
