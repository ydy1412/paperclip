import express from "express";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createDb, companies, projects, companyMemberships } from "../../packages/db/src/index.js";
import { startEmbeddedPostgresTestDatabase } from "../../packages/db/src/test-embedded-postgres.js";
import { dobiOrderRoutes } from "../src/routes/dobi-orders.js";
import { boardMutationGuard } from "../src/middleware/board-mutation-guard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { createServer: createViteServer } = await import(createRequire(path.join(root, "ui/package.json")).resolve("vite"));
const home = process.env.DOBI_BROWSER_STATE_DIR ?? await mkdtemp(path.join(os.tmpdir(), "dovix-dobi-browser-"));
process.env.PAPERCLIP_HOME = home; process.env.PAPERCLIP_INSTANCE_ID = "dobi-browser";
process.env.PAPERCLIP_SECRETS_MASTER_KEY = ""; process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(home, "master.key");
const database = await startEmbeddedPostgresTestDatabase("dovix-dobi-browser-db-");
const db = createDb(database.connectionString);
const companyId = "11111111-1111-4111-8111-111111111111", projectId = "22222222-2222-4222-8222-222222222222";
await db.insert(companies).values({ id: companyId, name: "Synthetic order company", issuePrefix: "DB" });
await db.insert(projects).values({ id: projectId, companyId, name: "Order browser proof" });
await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "dobi-browser-user", status: "active", membershipRole: "owner" });
const app = express(); app.use(express.json({ limit: "16mb" }));
app.use((req, _res, next) => { req.actor = { type: "board", source: "local_implicit", userId: "dobi-browser-user", companyIds: [companyId] }; next(); });
const routes = dobiOrderRoutes(db, { dataRoot: path.join(home, "orders") });
app.use("/api", routes.bridge, boardMutationGuard(), routes.router);
const vite = await createViteServer({ root: path.join(root, "ui"), configFile: path.join(root, "ui/vite.config.ts"), server: { middlewareMode: true, hmr: false } });
app.use(process.env.DOBI_BROWSER_BUILD === "1" ? express.static(path.join(root, "tmp/dobi-orders/browser-dist")) : vite.middlewares);
const server = app.listen(4331, "127.0.0.1", async () => {
  await writeFile(path.join(root, "tmp/dobi-orders/browser-fixture.json"), JSON.stringify({ home, companyId, projectId, url: "http://127.0.0.1:4331/dobi-orders-browser.html" }, null, 2));
  console.log("Isolated Dovix order UI ready on http://127.0.0.1:4331/dobi-orders-browser.html");
});
async function close() { await new Promise<void>(r => server.close(() => r())); await vite.close(); await routes.close(); await database.cleanup(); process.exit(0); }
process.once("SIGINT", close); process.once("SIGTERM", close);
