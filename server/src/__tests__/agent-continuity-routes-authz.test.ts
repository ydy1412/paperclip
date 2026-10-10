import express from "express";
import request from "supertest";
import type { Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { agentContinuityRoutes } from "../routes/agent-continuity.js";

const mocks = vi.hoisted(() => ({ getById: vi.fn(), assess: vi.fn() }));
vi.mock("../services/agents.js", () => ({ agentService: () => ({ getById: mocks.getById }) }));
vi.mock("../services/agent-continuity.js", () => ({ agentContinuityService: () => ({ assess: mocks.assess }) }));
vi.mock("../services/access.js", () => ({ accessService: () => ({ decide: vi.fn() }) }));

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompanyId = "10000000-0000-4000-8000-000000000002";
const agentId = "20000000-0000-4000-8000-000000000001";
const otherAgentId = "20000000-0000-4000-8000-000000000002";

function app(actor: Express.Request["actor"]) {
  const result = express();
  result.use((req, _res, next) => { req.actor = actor; next(); });
  result.use("/api", agentContinuityRoutes({} as Db));
  result.use(errorHandler);
  return result;
}
const board: Express.Request["actor"] = {
  type: "board", source: "session", userId: "operator", userName: null, userEmail: null,
  isInstanceAdmin: false, companyIds: [companyId],
  memberships: [{ companyId, membershipRole: "operator", status: "active" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assess.mockResolvedValue({ status: "ok" });
});

describe("continuity route company and agent scope", () => {
  it("returns the same 404 for missing agents and agents in another company", async () => {
    mocks.getById.mockResolvedValue(null);
    const missing = await request(app(board)).get(`/api/agents/${agentId}/continuity`).expect(404);
    mocks.getById.mockResolvedValue({ id: agentId, companyId: otherCompanyId });
    const outside = await request(app(board)).get(`/api/agents/${agentId}/continuity`).expect(404);
    expect(outside.body).toEqual(missing.body);
    expect(mocks.assess).not.toHaveBeenCalled();
  });

  it("allows a board member to read an agent in their company", async () => {
    mocks.getById.mockResolvedValue({ id: agentId, companyId });
    await request(app(board)).get(`/api/agents/${agentId}/continuity`).expect(200, { status: "ok" });
    expect(mocks.assess).toHaveBeenCalledWith(companyId, agentId);
  });

  it("hides other companies and keeps agent reads limited to the agent itself", async () => {
    const agent: Express.Request["actor"] = { type: "agent", source: "agent_key", companyId, agentId };
    mocks.getById.mockResolvedValue({ id: otherAgentId, companyId: otherCompanyId });
    await request(app(agent)).get(`/api/agents/${otherAgentId}/continuity`).expect(404);
    mocks.getById.mockResolvedValue({ id: otherAgentId, companyId });
    await request(app(agent)).get(`/api/agents/${otherAgentId}/continuity`).expect(403);
    expect(mocks.assess).not.toHaveBeenCalled();
    mocks.getById.mockResolvedValue({ id: agentId, companyId });
    await request(app(agent)).get(`/api/agents/${agentId}/continuity`).expect(200);
    expect(mocks.assess).toHaveBeenCalledWith(companyId, agentId);
  });
});
