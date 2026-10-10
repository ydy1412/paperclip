// Disposable synthetic browser verification; never uses the operating DB/account.
import express from "express";
import { createServer } from "../../ui/node_modules/vite/dist/node/index.js";
import { writeFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { startProcessingFixture } from "../src/__tests__/helpers/sourcing-processing-fixture.js";
const scratch = process.env.PAPERCLIP_RUN_SCRATCH_DIR;
if (!scratch) throw new Error("PAPERCLIP_RUN_SCRATCH_DIR required");
const f = await startProcessingFixture();
const previewRoot = path.join(scratch, "processing-browser"); mkdirSync(previewRoot, { recursive: true });
if (!existsSync(path.join(previewRoot, "node_modules"))) symlinkSync(path.join(process.cwd(), "ui/node_modules"), path.join(previewRoot, "node_modules"));
const entry = path.join(previewRoot, "entry.tsx");
writeFileSync(entry, `import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {SourcingProcessing} from '${process.cwd()}/ui/src/components/SourcingProcessing.tsx';
import '${process.cwd()}/ui/src/index.css';
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><main className="p-6"><h1 className="text-xl font-semibold">Synthetic product processing verification</h1><SourcingProcessing companyId="${f.companyId}" projectId="${f.projectId}"/></main></QueryClientProvider>);`);
const vite = await createServer({ configFile: "ui/vite.config.ts", root: "ui", server: { middlewareMode: true, proxy: {}, fs: { allow: [process.cwd(), scratch] } } });
const app = express(); app.use(express.json());
app.get("/api/plugins", (_req, res) => res.json([f.plugin]));
app.post("/api/plugins/:id/data/:key", async (req, res) => {
  try {
    if (req.params.id !== f.plugin.id || req.body.companyId !== f.companyId || req.body.params.projectId !== f.projectId) { res.sendStatus(403); return; }
    // Accounts are read from the actual fixture SQLite through its authenticated API.
    if (req.params.key === "accounts") {
      const response = await fetch(`${f.url}/accounts`, { headers: { Authorization: `Bearer ${"s".repeat(40)}` } });
      res.json({ data: await response.json() }); return;
    }
    res.json({ data: await f.data(req.body.params, req.params.key) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Fixture request failed" }); }
});
app.post("/api/plugins/:id/actions/:key", async (req, res) => {
  try {
    if (req.params.id !== f.plugin.id || req.params.key !== "processing-draft" || req.body.companyId !== f.companyId || req.body.params.projectId !== f.projectId) { res.sendStatus(403); return; }
    res.json({ data: await f.action(req.body.params) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Fixture request failed" }); }
});
app.get("/", async (_req, res) => res.type("html").send(await vite.transformIndexHtml("/", `<html><head><title>Processing synthetic verification</title></head><body><div id="root"></div><script type="module" src="/@fs/${entry}"></script></body></html>`)));
app.use(vite.middlewares);
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address(); if (address && typeof address !== "string") {
    writeFileSync(path.join(scratch, "processing-preview.json"), JSON.stringify({ url: `http://127.0.0.1:${address.port}`, productId: f.productId, accountId: f.accountId }));
    console.log(`Synthetic preview http://127.0.0.1:${address.port}`);
  }
});
let closing = false;
async function close() { if (closing) return; closing = true; server.close(); await vite.close(); await f.close(); process.exit(0); }
process.on("SIGTERM", close); process.on("SIGINT", close);
