// @vitest-environment node
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { readZipArchive } from "../../../packages/shared/src/portability-zip";
import { createProductCaptureArchive } from "./vite-product-capture";

it("ships an installable source-only archive with the original least-privilege manifest", async () => {
  const directory = fileURLToPath(new URL("../../../extensions/chrome-product-capture/", import.meta.url));
  const archive = await readZipArchive(await createProductCaptureArchive(directory));
  expect(archive.rootPath).toBe("dovix-chrome-product-capture");
  const manifest = JSON.parse(archive.files["manifest.json"] as string);
  expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
  expect(manifest.host_permissions).toBeUndefined();
  for (const name of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, "collector.js", "connection.js", "options.js", "popup.js", "styles.css", "README.md"]) {
    expect(archive.files[name]).toBe(await readFile(path.join(directory, name), "utf8"));
  }
  expect(Object.keys(archive.files)).toHaveLength(10);
  expect(Object.keys(archive.files).some(name => /test|fixture|\.env|profile|setup\.json/.test(name))).toBe(false);
});
