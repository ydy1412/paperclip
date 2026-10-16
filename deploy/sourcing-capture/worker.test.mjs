import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";
const token = `Bearer dvc_${"a".repeat(43)}`;
const request = (path = "/api/sourcing-capture", options = {}) => new Request(`https://capture.example${path}`, { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: "{}", ...options });
test("public Worker exposes only capture, rejects web origins, absent auth and bounded bodies", async () => {
  const env = { DOVIX: { fetch() { throw new Error("must not forward"); } } };
  assert.equal((await worker.fetch(request("/api/companies"), env)).status, 404);
  assert.equal((await worker.fetch(request("/api/sourcing-capture?token=x"), env)).status, 404);
  assert.equal((await worker.fetch(request(undefined, { headers: { Origin: "https://evil.example" } }), env)).status, 403);
  assert.equal((await worker.fetch(request(undefined, { headers: { "Content-Type": "application/json" } }), env)).status, 401);
  assert.equal((await worker.fetch(request(undefined, { body: "a".repeat(512 * 1024 + 1) }), env)).status, 413);
});
test("Worker forwards fixed destination and bearer, never cookies or proxy identity", async () => {
  let forwarded;
  const env = { DOVIX: { async fetch(req) { forwarded = req; return Response.json({ status: "stored" }); } } };
  const response = await worker.fetch(request(undefined, { headers: { Authorization: token, "Content-Type": "application/json", Cookie: "private", "X-Forwarded-User": "admin", Origin: `chrome-extension://${"a".repeat(32)}` } }), env);
  assert.equal(response.status, 200); assert.equal(forwarded.url, "http://127.0.0.1:3100/api/sourcing-capture");
  assert.equal(forwarded.headers.get("Cookie"), null); assert.equal(forwarded.headers.get("X-Forwarded-User"), null);
  assert.equal(forwarded.headers.get("Authorization"), token); assert.equal(await forwarded.text(), "{}");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), `chrome-extension://${"a".repeat(32)}`);
});
