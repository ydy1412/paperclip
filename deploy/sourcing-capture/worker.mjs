// Public ingress is deliberately limited to one capture endpoint. No board proxy.
export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Vary": "Origin" };
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return new Response("Forbidden", { status: 403, headers });
    if (origin) { headers["Access-Control-Allow-Origin"] = origin; headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"; headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"; }
    if (url.pathname !== "/api/sourcing-capture" || url.search) return new Response("Not found", { status: 404, headers });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
    const token = request.headers.get("Authorization");
    if (!token || !/^Bearer dvc_[A-Za-z0-9_-]{43}$/.test(token)) return new Response("Unauthorized", { status: 401, headers });
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") ?? "")) return new Response("Unsupported content type", { status: 415, headers });
    const limit = 512 * 1024;
    if (Number(request.headers.get("Content-Length")) > limit) return new Response("Payload too large", { status: 413, headers });
    const chunks = []; let length = 0;
    const reader = request.body?.getReader();
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); return new Response("Payload too large", { status: 413, headers }); } chunks.push(value); }
    const body = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    try {
      const response = await env.DOVIX.fetch(new Request("http://127.0.0.1:3100/api/sourcing-capture", { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body, redirect: "manual", signal: AbortSignal.timeout(30000) }));
      if (response.status >= 300 && response.status < 400) return new Response("Unexpected upstream redirect", { status: 502, headers });
      const type = response.headers.get("Content-Type") ?? "";
      if (!type.includes("application/json")) return new Response("Capture service unavailable", { status: 502, headers });
      headers["Content-Type"] = "application/json";
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response("Capture service unavailable", { status: 503, headers }); }
  },
};
