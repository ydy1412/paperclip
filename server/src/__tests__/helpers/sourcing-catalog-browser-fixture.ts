import express from "express";
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startProcessingFixture } from "./sourcing-processing-fixture.js";
import { sourcingCatalogRoutes } from "../../routes/sourcing-catalog.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { boardMutationGuard } from "../../middleware/board-mutation-guard.js";

// Run with tsx; this fixture owns only synthetic databases and loopback listeners.
const fixture = await startProcessingFixture("catalog-browser");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const vite = await createServer({ root: path.join(root, "ui"), server: { middlewareMode: true }, appType: "custom" });
const app = express(); app.use(express.json());
app.use((req, _res, next) => { req.actor = { type: "board", userId: "fixture-operator", source: "local_implicit", companyIds: [fixture.companyId] }; next(); });
app.use("/api", boardMutationGuard()); app.use("/api", sourcingCatalogRoutes(fixture.db, { processingPort: Number(new URL(fixture.url).port) }));
app.get("/api/plugins", (_req, res) => res.json([]));
app.use(errorHandler);
app.get("/", async (_req, res) => res.type("html").send(await vite.transformIndexHtml("/", '<html><head><title>Catalog fixture</title></head><body><div id="root"></div><script type="module" src="/src/components/SourcingCatalog.browser-fixture.tsx"></script></body></html>')));
app.use(vite.middlewares);
const server = app.listen(0, "127.0.0.1", () => { const address = server.address(); if (address && typeof address !== "string") console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}/?company=${fixture.companyId}&project=${fixture.projectId}` })); });
process.stdin.resume();
let closing = false;
async function close() { if (closing) return; closing = true; await new Promise<void>(resolve => server.close(() => resolve())); await vite.close(); await fixture.close(); process.exit(0); }
process.stdin.on("data", () => void close()); process.on("SIGTERM", () => void close()); process.on("SIGINT", () => void close());
