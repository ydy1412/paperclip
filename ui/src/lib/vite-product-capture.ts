import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { createZipArchive } from "./zip";

const downloadPath = "/downloads/dovix-chrome-product-capture.zip";
// Never package arbitrary directory contents: local setup and test data stay out.
const extensionFiles = [
  "manifest.json", "background.js", "collector.js", "connection.js",
  "options.html", "options.js", "popup.html", "popup.js", "styles.css", "README.md",
];

export async function createProductCaptureArchive(directory: string) {
  const entries = await Promise.all(extensionFiles.map(async name => [name, await readFile(path.join(directory, name), "utf8")] as const));
  return createZipArchive(Object.fromEntries(entries), "dovix-chrome-product-capture");
}

export function productCaptureExtensionPlugin(directory: string): Plugin {
  let building = false;
  return {
    name: "dovix-product-capture-download",
    configResolved(config) { building = config.command === "build"; },
    async buildStart() {
      if (!building) return;
      this.emitFile({ type: "asset", fileName: downloadPath.slice(1), source: await createProductCaptureArchive(directory) });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== downloadPath) return next();
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return;
        }
        void createProductCaptureArchive(directory).then(bytes => {
          response.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="dovix-chrome-product-capture.zip"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Length": bytes.length });
          response.end(request.method === "HEAD" ? undefined : bytes);
        }).catch(next);
      });
    },
  };
}
