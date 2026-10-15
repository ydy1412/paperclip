import path from "node:path";
import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config";

export default defineConfig(env => mergeConfig(baseConfig(env), {
  build: {
    outDir: path.resolve(import.meta.dirname, "../tmp/dobi-orders/browser-dist"),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(import.meta.dirname, "dobi-orders-browser.html") },
  },
}));
