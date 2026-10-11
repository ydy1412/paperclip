import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../../../skills/sourcing-reference-processing/scripts/plugin-tools.mjs", import.meta.url));
const execute = promisify(execFile);
const prefix = "paperclipai.plugin-sourcing-processing:";
const servers: Server[] = [], directories: string[] = [];
const requests: { path: string; auth: string | undefined; body: unknown }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  requests.length = 0;
});
async function fixture(executeStatus = 200, image = false) {
  const server = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    requests.push({ path: request.url!, auth: request.headers.authorization, body: body ? JSON.parse(body) : null });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/plugins/tools") {
      response.end(JSON.stringify([{ name: prefix + (image ? "get-product-image" : "get-processing-source"), parametersSchema: { type: "object" } }, { name: "other:publish" }]));
    } else {
      response.statusCode = executeStatus;
      response.end(JSON.stringify(executeStatus === 200 ? { result: { data: image ? { contentType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=" } : { sourceHash: "original", skus: [{ skuId: "sku", options: [{ value: "勿拍" }] }] } } } : { error: "fixture-token" }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); servers.push(server);
  const port = (server.address() as { port: number }).port;
  const directory = await mkdtemp(join(tmpdir(), "sourcing-skill-tools-")); directories.push(directory);
  const file = join(directory, "parameters.json");
  await writeFile(file, JSON.stringify({ projectId: "project", accountId: "account", sourceProvider: "taobao", productId: "source" }));
  const env = { ...process.env, PAPERCLIP_API_URL: `http://127.0.0.1:${port}`, PAPERCLIP_API_KEY: "fixture-token", PAPERCLIP_AGENT_ID: "injected-agent", PAPERCLIP_COMPANY_ID: "injected-company", PAPERCLIP_RUN_ID: "injected-run" };
  return { file, env };
}
describe("sourcing skill native tool runner", () => {
  it("saves an authorized PNG into run scratch without printing media data and recovers identical reads", async () => {
    const { file, env } = await fixture(200, true);
    const assetId = "a".repeat(32);
    await writeFile(file, JSON.stringify({ projectId: "project", productId: "product", assetId }));
    const configured = { ...env, PAPERCLIP_RUN_SCRATCH_DIR: dirname(file) };
    const first = JSON.parse((await execute(process.execPath, [script, "call", "get-product-image", file], { env: configured })).stdout);
    expect(first.filePath).toBe(join(await import("node:fs/promises").then(fs => fs.realpath(dirname(file))), assetId + ".png"));
    expect((await readFile(first.filePath)).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(first).not.toHaveProperty("base64");
    const recovered = JSON.parse((await execute(process.execPath, [script, "call", "get-product-image", file], { env: configured })).stdout);
    expect(recovered).toEqual(first);
    await writeFile(first.filePath, "unrelated");
    await expect(execute(process.execPath, [script, "call", "get-product-image", file], { env: configured })).rejects.toMatchObject({ stderr: expect.stringContaining("existing_image_changed") });
  });
  it.each(["", "/api", "/api/"])("uses the injected identity and correct API path for base suffix %s", async suffix => {
    const { file, env } = await fixture(); env.PAPERCLIP_API_URL += suffix;
    const output = await execute(process.execPath, [script, "call", "get-processing-source", file], { env });
    expect(JSON.parse(output.stdout).result.data.skus[0].options[0].value).toBe("勿拍");
    expect(requests.map(r => r.path)).toEqual(["/api/plugins/tools", "/api/plugins/tools/execute"]);
    expect(requests[1].auth).toBe("Bearer fixture-token");
    expect(requests[1].body).toEqual({ tool: prefix + "get-processing-source", parameters: { projectId: "project", accountId: "account", sourceProvider: "taobao", productId: "source" }, runContext: { companyId: "injected-company", agentId: "injected-agent", runId: "injected-run", projectId: "project" } });
  });
  it("lists only tools available from the processing plugin", async () => {
    const { env } = await fixture();
    const output = await execute(process.execPath, [script, "list"], { env });
    expect(JSON.parse(output.stdout).map((tool: { name: string }) => tool.name)).toEqual([prefix + "get-processing-source"]);
    expect(requests).toHaveLength(1);
  });
  it("runs through a linked skill directory used by the agent runtime", async () => {
    const { env, file } = await fixture();
    const linkedDirectory = join(dirname(file), "assigned-skill");
    await symlink(dirname(script), linkedDirectory, "junction");
    const linkedScript = join(linkedDirectory, basename(script));
    const output = await execute(process.execPath, [linkedScript, "call", "get-processing-source", file], { env });
    expect(JSON.parse(output.stdout).result.data.sourceHash).toBe("original");
    expect(requests.map(r => r.path)).toEqual(["/api/plugins/tools", "/api/plugins/tools/execute"]);
  });
  it("does not invoke an unavailable tool or accept caller-supplied run identity", async () => {
    const { file, env } = await fixture();
    await expect(execute(process.execPath, [script, "call", "other:publish", file], { env })).rejects.toMatchObject({ stderr: expect.stringContaining("tool_not_available_for_current_run") });
    expect(requests).toHaveLength(1);
    await writeFile(file, JSON.stringify({ projectId: "project", runId: "forged" }));
    await expect(execute(process.execPath, [script, "call", "get-processing-source", file], { env })).rejects.toMatchObject({ stderr: expect.stringContaining("identity_must_come_from_injected_run") });
    expect(requests).toHaveLength(2);
  });
  it("stops before discovery when injected context is missing", async () => {
    const { env } = await fixture();
    env.PAPERCLIP_RUN_ID = "";
    await expect(execute(process.execPath, [script, "list"], { env })).rejects.toMatchObject({ stderr: expect.stringContaining("injected_run_context_missing") });
    expect(requests).toHaveLength(0);
  });
  it("reports a failed request without leaking its body or retrying the call", async () => {
    const { file, env } = await fixture(409);
    await expect(execute(process.execPath, [script, "call", "get-processing-source", file], { env })).rejects.toMatchObject({ stderr: expect.stringContaining("HTTP 409") });
    expect(requests).toHaveLength(2);
  });
});
