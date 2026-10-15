import express from "../../server/node_modules/express/index.js";
import { createServer } from "../../ui/node_modules/vite/dist/node/index.js";
import react from "../../ui/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "../../ui/node_modules/@tailwindcss/vite/dist/index.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startProcessingFixture } from "../../server/src/__tests__/helpers/sourcing-processing-fixture.ts";
import { sourcingCaptureRoutes } from "../../server/src/routes/sourcing-capture.ts";
import { sourcingCatalogRoutes } from "../../server/src/routes/sourcing-catalog.ts";
import { errorHandler } from "../../server/src/middleware/error-handler.ts";
import { companyMemberships } from "../../packages/db/src/index.ts";
await mkdir("tmp/chrome-capture", { recursive: true });
await writeFile("tmp/chrome-capture/preview.html", `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dovix 수집 검증</title><div id="root"></div><script type="module" src="/ui/src/components/SourcingCaptureSettings.browser-fixture.tsx"></script></html>`);
const f = await startProcessingFixture();
await f.db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "user", principalId: "fixture-operator", status: "active", membershipRole: "owner" });
const routes = sourcingCaptureRoutes(f.db, { processingPort: Number(new URL(f.url).port) });
const ingress = express(); ingress.use(express.json({ limit: "512kb" })); ingress.use(routes.ingress); ingress.use(errorHandler);
const ingressServer = ingress.listen(0, "127.0.0.1"); await new Promise(r => ingressServer.once("listening", r));
const ingressPort = (ingressServer.address() as any).port;
process.env.PAPERCLIP_SOURCING_CAPTURE_URL = `http://127.0.0.1:${ingressPort}`;
const app = express(); app.use(express.json({ limit: "512kb" })); app.use(routes.ingress);
app.use((req, _res, next) => { req.actor = { type: "board", source: "board_key", userId: "fixture-operator", companyIds: [f.companyId] }; next(); });
app.use("/api", routes.management, sourcingCatalogRoutes(f.db, { processingPort: Number(new URL(f.url).port) }));
app.get("/api/plugins", (_req, res) => res.json([f.plugin]));
app.post("/api/plugins/:id/data/:key", async (req, res) => res.json({ data: await f.data(req.body.params ?? {}, req.params.key) }));
app.use(errorHandler); const server = app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
const apiUrl = `http://127.0.0.1:${(server.address() as any).port}`;
const vite = await createServer({ root: process.cwd(), configFile: false, plugins: [react(), tailwindcss()], resolve: { alias: { "@": `${process.cwd()}/ui/src`, "react": `${process.cwd()}/ui/node_modules/react`, "react-dom": `${process.cwd()}/ui/node_modules/react-dom` } }, server: { host: "127.0.0.1", port: 6017, strictPort: true, proxy: { "/api": apiUrl } } }); await vite.listen();
let tunnel;
if (process.argv.includes("--tunnel")) {
 tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${ingressPort}`], { stdio: ["ignore", "ignore", "pipe"] });
 const publicUrl = await new Promise<string>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Quick Tunnel unavailable")), 45000); tunnel.stderr.on("data", data => { const match = data.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (match) { clearTimeout(timer); resolve(match[0]); } }); });
 process.env.PAPERCLIP_SOURCING_CAPTURE_URL = publicUrl;
}
const info = { apiUrl, captureUrl: process.env.PAPERCLIP_SOURCING_CAPTURE_URL, url: `http://127.0.0.1:6017/tmp/chrome-capture/preview.html?company=${f.companyId}&project=${f.projectId}`, companyId: f.companyId, projectId: f.projectId };
await writeFile("tmp/chrome-capture/preview-info.json", JSON.stringify(info)); console.log("CAPTURE_PREVIEW", JSON.stringify(info));
let closing = false;
async function close() { if (closing) return; closing = true; tunnel?.kill("SIGTERM"); await vite.close(); await Promise.all([new Promise(r => server.close(r)), new Promise(r => ingressServer.close(r))]); await f.close(); process.exit(0); }
process.on("SIGINT", close); process.on("SIGTERM", close);
