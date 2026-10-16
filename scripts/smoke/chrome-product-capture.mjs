// Opt-in MV3 runtime test against the disposable capture preview fixture.
// The test copy pregrants only its fixture origins; the shipped manifest stays activeTab-only.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readZipArchive } from "../../packages/shared/dist/portability-zip.js";
const info = JSON.parse(await readFile(process.env.DOVIX_CAPTURE_FIXTURE_INFO ?? "tmp/chrome-capture/preview-info.json", "utf8"));
assert.equal(new URL(info.apiUrl).hostname, "127.0.0.1", "Only a disposable loopback fixture may issue test credentials");
const base = `${info.apiUrl}/api/companies/${info.companyId}/sourcing/projects/${info.projectId}/capture-connections`;
const issued = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "격리된 확장 검사" }) });
assert.equal(issued.status, 201); const connection = await issued.json();
const setup = { serverUrl: info.captureUrl, connectionId: connection.id, token: connection.token, projectName: "격리된 확장 검사" };
const productId = String(Date.now());
const directory = await mkdtemp(path.join(os.tmpdir(), "dovix-capture-extension-"));
let context;
try {
 const downloadUrl = new URL("/downloads/dovix-chrome-product-capture.zip", info.url);
 const archiveResponse = await fetch(downloadUrl); assert.equal(archiveResponse.status, 200);
 assert.match(archiveResponse.headers.get("content-type"), /application\/zip/);
 const shipped = await readZipArchive(new Uint8Array(await archiveResponse.arrayBuffer()));
 assert.equal(shipped.rootPath, "dovix-chrome-product-capture"); assert.equal(Object.keys(shipped.files).length, 10);
 const extension = path.join(directory, "extension"); await mkdir(extension);
 for (const [name, contents] of Object.entries(shipped.files)) {
  assert.equal(typeof contents, "string"); assert.equal(name, path.basename(name));
  assert.equal(contents, await readFile(path.join("extensions/chrome-product-capture", name), "utf8"));
  await writeFile(path.join(extension, name), contents);
 }
 const manifestPath = path.join(extension, "manifest.json"); const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
 const origin = new URL(info.captureUrl); manifest.host_permissions = ["https://item.taobao.com/*", `${origin.protocol}//${origin.hostname}/*`];
 await writeFile(manifestPath, JSON.stringify(manifest));
 context = await chromium.launchPersistentContext(path.join(directory, "profile"), { channel: "chromium", executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
 let [worker] = context.serviceWorkers(); worker ??= await context.waitForEvent("serviceworker");
 const runtimeErrors = [];
 context.on("page", page => page.on("pageerror", error => runtimeErrors.push(error.message)));
 const photo = await readFile(path.resolve(process.env.AUTO_SOURCING_PROJECT_ROOT ?? "../auto-sourcing", "tests/AutoSourcing.Tests/Fixtures/product-image.png"));
 await context.route("https://img.alicdn.com/capture-test.jpg", route => route.fulfill({ contentType: "image/png", body: photo }));
 const extensionId = new URL(worker.url()).host;
 const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
 await options.locator("#connection").fill(JSON.stringify(setup)); await options.getByRole("button", { name: "연결하기", exact: true }).click();
 await options.locator("#status").filter({ hasText: "연결했습니다" }).waitFor();
 assert.equal(await options.locator("#connection").inputValue(), "");
 let productNavigations = 0;
 const state = { item: { itemId: productId, title: `수집 검증용 파란 수납함 ${productId}`, images: ["https://img.alicdn.com/capture-test.jpg"] }, skuBase: { props: [{ pid: "1", name: "颜色分类", values: [{ vid: "2", name: "蓝色" }] }], skus: [{ skuId: "456", propPath: "1:2" }] }, skuCore: { sku2info: { "456": { price: { priceText: "25.50" }, quantity: "4" } } } };
 await context.route("https://item.taobao.com/**", async route => { productNavigations++; assert.equal(route.request().url(), `https://item.taobao.com/item.htm?id=${productId}`); await route.fulfill({ contentType: "text/html", body: `<meta charset="utf-8"><title>격리된 상품 상세 시험</title><h1>${state.item.title}</h1><img alt="검증용 원본 이미지" src="https://img.alicdn.com/capture-test.jpg"><script>window.__INIT_DATA__=${JSON.stringify(state)}</script>` }); });
 const product = await context.newPage(); await product.goto(`https://item.taobao.com/item.htm?id=${productId}`);
 async function popup() {
  await product.bringToFront();
  const opened = context.waitForEvent("page");
  await worker.evaluate(url => chrome.tabs.create({ url, active: false }), `chrome-extension://${extensionId}/popup.html`);
  const page = await opened; await page.waitForLoadState(); return page;
 }
 let p = await popup(); await p.locator("#status").filter({ hasText: "가공 전 상품에 저장했습니다" }).waitFor({ timeout: 45000 });
 await mkdir("tmp/chrome-capture", { recursive: true }); await p.screenshot({ path: "tmp/chrome-capture/extension-success.png", fullPage: true }); await p.close();
 p = await popup(); await p.locator("#status").filter({ hasText: "이미 저장된 상품" }).waitFor({ timeout: 45000 }); await p.close();
 await worker.evaluate(value => chrome.storage.local.set({ connection: value }), { ...setup, token: `dvc_${"b".repeat(43)}` });
 p = await popup(); await p.locator("#status").filter({ hasText: "만료되었거나 해제" }).waitFor({ timeout: 45000 });
 const pending = await worker.evaluate(async () => (await chrome.storage.local.get("pending")).pending);
 assert.ok(pending.request.requestId); assert.equal(pending.request.snapshot.skus[0].originalPriceMinor, 2550); assert.equal(pending.request.snapshot.skus[0].options[0].value, "蓝色"); assert.equal(pending.request.snapshot.title, state.item.title);
 await worker.evaluate(value => chrome.storage.local.set({ connection: value }), setup);
 await product.evaluate(() => { window.__INIT_DATA__.item.title = "재시도 때 다시 읽으면 안 됨"; });
 await p.getByRole("button", { name: "같은 상품 재시도" }).click(); await p.locator("#status").filter({ hasText: "이미 저장된 상품" }).waitFor({ timeout: 45000 });
 assert.match(await p.locator("#details").textContent(), /수집 검증용 파란 수납함/);
 assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("pending")).pending), undefined);
 assert.equal((await product.content()).includes(connection.token), false); await p.close();
 const workspace = await fetch(`${info.apiUrl}/api/companies/${info.companyId}/sourcing/projects/${info.projectId}/catalog`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "workspace" }) });
 assert.equal(workspace.status, 200); const rows = await workspace.json();
 const row = rows.find(r => r.source?.sourceProductId === productId); assert.equal(row?.stage, "unprocessed"); assert.equal(row.source.optionCount, 1);
 assert.equal(row.mainImage, state.item.images[0]);
 const workspacePage = await context.newPage(); await workspacePage.goto(info.url);
 const downloadReady = workspacePage.waitForEvent("download");
 await workspacePage.getByRole("link", { name: "확장 파일 받기" }).click();
 const download = await downloadReady;
 assert.equal(download.suggestedFilename(), "dovix-chrome-product-capture.zip");
 const browserArchive = await readZipArchive(new Uint8Array(await readFile(await download.path())));
 assert.deepEqual(browserArchive.files, shipped.files);
 await workspacePage.screenshot({ path: "tmp/chrome-capture/settings.png", fullPage: true });
 await workspacePage.getByRole("button", { name: "소싱 상품", exact: true }).click();
 await workspacePage.locator('[aria-label="소싱 상품 목록"] button').filter({ hasText: state.item.title }).click();
 const originalImage = workspacePage.locator('img[alt="상품 대표 이미지"]');
 await expect.poll(() => originalImage.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
 assert.equal(await originalImage.getAttribute("src"), state.item.images[0]);
 assert.match(await workspacePage.locator('[aria-label="가공 전 상품 정보"]').textContent(), /추가 확인: 상세 이미지/);
 await workspacePage.screenshot({ path: "tmp/chrome-capture/source.png", fullPage: true }); await workspacePage.close();
 await fetch(`${base}/${connection.id}`, { method: "DELETE" });
 p = await popup(); await p.locator("#status").filter({ hasText: "만료되었거나 해제" }).waitFor({ timeout: 45000 });
 assert.equal(productNavigations, 1, "No extra product navigation, collection or retry page request is allowed");
 assert.deepEqual(runtimeErrors, []);
 const report = { runtime: "real MV3 Chromium with pregranted disposable origins", currentTab: "intercepted synthetic Taobao page; no live Taobao access", transport: origin.hostname.endsWith("trycloudflare.com") ? "actual Quick Tunnel -> Dovix PostgreSQL -> native HTTP/SQLite" : "configured capture receiver", browserDownloadVerified: true, loadedFromDownloadedArchive: true, setup: true, exactPriceAndOptions: true, unprocessedReadback: true, capturedImageLoadedInUi: true, duplicate: true, failedSnapshotRetry: true, revocation: true, runtimeErrors, productNavigations, nativePermissionPrompt: "manual; not covered by pregranted fixture" };
 await writeFile("tmp/chrome-capture/extension-report.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
 await context?.close(); await fetch(`${base}/${connection.id}`, { method: "DELETE" }); await rm(directory, { recursive: true, force: true });
}
