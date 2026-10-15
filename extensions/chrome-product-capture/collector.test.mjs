import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { collectCurrentProduct } from "./collector.js";
import { parseConnection, sendSnapshot } from "./connection.js";
const require = createRequire(new URL("../../ui/package.json", import.meta.url));
const { JSDOM } = require("jsdom");
function page(html, url = "https://item.taobao.com/item.htm?id=987654321") {
  const dom = new JSDOM(html, { url }); globalThis.document = dom.window.document; globalThis.location = dom.window.location; delete globalThis.__INIT_DATA__; return dom;
}
const item = { item: { itemId: "987654321", title: "브라우저 검증용 수납함", images: ["//img.alicdn.com/main.jpg"] },
  skuBase: { props: [{ pid: "1", name: "颜色分类", values: [{ vid: "2", name: "蓝色", image: "//img.alicdn.com/blue.jpg" }] }], skus: [{ skuId: "123", propPath: "1:2" }] },
  skuCore: { sku2info: { "123": { price: { priceText: "15.99" }, quantity: "8" } } } };
test("reads current DOM and exact SKU data without requesting pages or exposing private fields", () => {
  const dom = page('<title>商品详情</title><div id="description"><img src="https://img.alicdn.com/detail.jpg"></div>');
  globalThis.__INIT_DATA__ = { data: { ...item, token: "never-copy", userInfo: { phone: "private" } } };
  const snapshot = collectCurrentProduct(); assert.equal(snapshot.title, item.item.title); assert.equal(snapshot.skus[0].originalPriceMinor, 1599);
  assert.equal(snapshot.skus[0].reportedQuantity, 8); assert.equal(snapshot.skus[0].options[0].value, "蓝色");
  assert.equal(snapshot.images.length, 2); assert.equal(snapshot.url, "https://item.taobao.com/item.htm?id=987654321");
  assert.equal(JSON.stringify(snapshot).includes("never-copy"), false); assert.equal(JSON.stringify(snapshot).includes("private"), false); dom.window.close();
});
test("missing or partial option data stays missing and ranges are never turned into exact prices", () => {
  const dom = page('<meta property="og:title" content="합성 검증용 상품"><meta property="og:image" content="https://img.alicdn.com/main.jpg">');
  let snapshot = collectCurrentProduct(); assert.deepEqual(snapshot.skus, []);
  globalThis.__INIT_DATA__ = structuredClone(item); globalThis.__INIT_DATA__.skuCore.sku2info["123"].price.priceText = "15-20";
  snapshot = collectCurrentProduct(); assert.equal(snapshot.skus[0].originalPriceMinor, null);
  globalThis.__INIT_DATA__.skuBase.skus.push({ skuId: "456", propPath: "1:unknown" });
  assert.deepEqual(collectCurrentProduct().skus, []); dom.window.close();
});
test("rejects search, unsafe host and verification pages rather than navigating", () => {
  for (const url of ["https://s.taobao.com/search?q=desk", "https://item.taobao.com.evil/item.htm?id=987654321", "http://item.taobao.com/item.htm?id=987654321"]) {
    const dom = page("<h1>irrelevant</h1>", url); assert.throws(collectCurrentProduct); dom.window.close();
  }
  const dom = page('<title>验证身份</title><meta property="og:title" content="anything">'); assert.throws(collectCurrentProduct, /인증/); dom.window.close();
});
test("never mixes a recommended product's SKU or gallery with the current product", () => {
  const dom = page('<meta property="og:title" content="현재 상품"><div class="gallery"><img src="https://img.alicdn.com/recommendation.jpg"></div>');
  const recommended = structuredClone(item); recommended.item.itemId = "9999"; recommended.skuBase.skus[0].skuId = "999";
  globalThis.__INIT_DATA__ = { recommendation: recommended, current: item };
  const snapshot = collectCurrentProduct(); assert.equal(snapshot.skus[0].skuId, "123");
  assert.deepEqual(snapshot.images.map(i => i.src), ["https://img.alicdn.com/main.jpg"]); dom.window.close();
});
test("connection and transport pin origin, omit cookies, reject redirects and reuse the exact retry payload", async () => {
  const config = { serverUrl: "https://capture.example", token: `dvc_${"a".repeat(43)}`, connectionId: "11111111-1111-4111-8111-111111111111" };
  const connection = parseConnection(JSON.stringify(config));
  assert.throws(() => parseConnection({ ...config, serverUrl: "https://capture.example/path" }));
  assert.throws(() => parseConnection({ ...config, serverUrl: "http://public.example" }));
  const pending = { request: { requestId: "same-request", snapshot: { title: "captured once" } } }; const calls = [];
  const fetcher = async (url, init) => { calls.push([url, init]); return Response.json({ status: "stored", missingFields: [] }); };
  await sendSnapshot(connection, pending, fetcher); await sendSnapshot(connection, pending, fetcher);
  assert.equal(calls[0][0], "https://capture.example/api/sourcing-capture"); assert.equal(calls[0][1].credentials, "omit");
  assert.equal(calls[0][1].redirect, "error"); assert.equal(calls[0][1].body, calls[1][1].body);
  await assert.rejects(sendSnapshot(connection, pending, async () => new Response("", { status: 401 })), /연결/);
});
