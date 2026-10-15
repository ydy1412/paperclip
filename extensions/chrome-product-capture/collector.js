// Self-contained: Chrome serializes this function into the current main frame.
// It only reads the document and named product-state objects. Never fetch or navigate.
export function collectCurrentProduct() {
  const page = new URL(location.href);
  if (page.protocol !== "https:" || !["item.taobao.com"].includes(page.hostname) || !/^\d{1,30}$/.test(page.searchParams.get("id") || ""))
    throw new Error("타오바오 상품 상세 페이지에서 눌러 주세요.");
  if (/验证身份|访问受限|验证码|账号.*限制|安全验证/.test(document.title)) throw new Error("현재 페이지의 인증을 먼저 완료해 주세요.");
  const productId = page.searchParams.get("id");
  const image = value => {
    if (typeof value !== "string" || value.length > 4096) return null;
    try { const u = new URL(value.startsWith("//") ? `https:${value}` : value, page); return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && ["alicdn.com", "tbcdn.cn", "taobaocdn.com"].some(h => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u.href : null; } catch { return null; }
  };
  const images = [], seenImages = new Set();
  function addImage(role, value) { const src = image(typeof value === "object" ? value?.url ?? value?.src : value); if (src && !seenImages.has(`${role}:${src}`) && images.length < 201) { seenImages.add(`${role}:${src}`); images.push({ role, src }); } }
  const roots = [];
  for (const name of ["__INIT_DATA__", "__INITIAL_STATE__", "__GLOBAL_DATA__", "__ICE_APP_CONTEXT__", "__NEXT_DATA__", "g_config", "Hub"]) {
    try { const value = globalThis[name]; if (value && typeof value === "object") roots.push(value); } catch { /* A page-owned getter is not trusted. */ }
  }
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"],script[type="application/json"],script#__NEXT_DATA__')].slice(0, 30)) {
    if (script.textContent.length > 1_000_000) continue;
    try { roots.push(JSON.parse(script.textContent)); } catch { /* Non-JSON state is not evaluated. */ }
  }
  const nodes = [], seen = new Set();
  function visit(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 10 || seen.has(value) || nodes.length >= 15000) return;
    seen.add(value); nodes.push(value);
    for (const key of Object.keys(value).slice(0, 400)) { try { visit(value[key], depth + 1); } catch { /* Ignore inaccessible page state. */ } }
  }
  roots.forEach(r => visit(r));
  const matchesIdentity = value => String(value?.itemId ?? value?.itemNumId ?? value?.productId ?? value?.id ?? "") === productId;
  const productRoot = nodes.find(n => n.skuBase && [n.item, n.itemInfo, n].some(matchesIdentity));
  const item = [productRoot?.item, productRoot?.itemInfo, productRoot].find(n => matchesIdentity(n) && (n.title || n.itemTitle)) ?? nodes.find(n => matchesIdentity(n) && (n.title || n.itemTitle));
  const products = nodes.filter(n => (n["@type"] === "Product" || n["@type"]?.includes?.("Product")) && n.name);
  const ld = products.find(n => n.url ? (() => { try { return new URL(n.url, page).searchParams.get("id") === productId; } catch { return false; } })() : products.length === 1);
  const text = selector => document.querySelector(selector)?.textContent?.trim();
  const title = String(item?.title ?? item?.itemTitle ?? ld?.name ?? text('[data-title] h1, h1[class*="title"], h1[class*="Title"], #J_Title h3, .tb-main-title') ?? document.querySelector('meta[property="og:title"]')?.content ?? "").trim();
  if (!title || title.length > 500) throw new Error("상품명을 읽지 못했습니다. 상품 상세 화면이 열린 상태인지 확인해 주세요.");
  for (const src of [item?.images, item?.pics, item?.image, ld?.image].flat().filter(Boolean).slice(0, 40)) addImage("main", src);
  if (!images.length) {
    addImage("main", document.querySelector('meta[property="og:image"]')?.content);
    for (const img of [...document.querySelectorAll('#J_UlThumb img, #J_ImgBooth, [class*="PicGallery"] img, [class*="picGallery"] img')].slice(0, 40)) addImage("main", img.getAttribute("data-src") || img.currentSrc || img.src);
  }
  for (const img of [...document.querySelectorAll('#J_DivItemDesc img, #description img, [class*="descV8"] img, [class*="Description"] img')].slice(0, 160)) addImage("detail", img.getAttribute("data-src") || img.getAttribute("data-ks-lazyload") || img.currentSrc || img.src);
  function minor(value) {
    if (typeof value === "number") value = String(value);
    if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ""] = value.split("."); const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(n) && n <= 100_000_000_000_000 ? n : null;
  }
  // Only complete, identified SKU combinations are used; an aggregate price is never a fabricated SKU.
  const rawBase = productRoot?.skuBase;
  const base = Array.isArray(rawBase?.skus) && Array.isArray(rawBase?.props) ? rawBase : undefined;
  const core = productRoot?.skuCore;
  const skus = [], skuIds = new Set();
  for (const sku of (Array.isArray(base?.skus) ? base.skus : []).slice(0, 200)) {
    const skuId = String(sku.skuId ?? ""); if (!/^\d{1,100}$/.test(skuId) || skuIds.has(skuId)) continue;
    const options = []; let complete = true;
    for (const pair of String(sku.propPath ?? sku.properties ?? "").split(";").filter(Boolean)) {
      const [pid, vid] = pair.split(":"); const prop = base.props.find(p => String(p.pid) === pid); const value = prop?.values?.find(v => String(v.vid) === vid);
      if (!prop?.name || !value?.name) { complete = false; break; }
      options.push({ propertyId: pid, valueId: vid, name: String(prop.name).slice(0, 200), value: String(value.name).slice(0, 500) });
    }
    if (!complete || options.length > 20 || (!options.length && base.props.length)) continue;
    const info = core?.sku2info?.[skuId] ?? {};
    const priceText = info.price?.priceText ?? info.price?.price;
    const discountText = info.subPrice?.priceText ?? info.promotionPrice?.priceText;
    const optionImages = options.flatMap(o => base.props.find(p => String(p.pid) === o.propertyId)?.values?.filter(v => String(v.vid) === o.valueId).map(v => image(v.image)) ?? []).filter(Boolean).slice(0, 20);
    skuIds.add(skuId);
    skus.push({ skuId, currency: "CNY", originalPriceMinor: minor(priceText), discountedPriceMinor: minor(discountText), originalPriceText: typeof priceText === "string" ? priceText.slice(0, 100) : null, discountedPriceText: typeof discountText === "string" ? discountText.slice(0, 100) : null, stockStatus: null, reportedQuantity: /^\d{1,12}$/.test(String(info.quantity ?? "")) ? Number(info.quantity) : null, moreQuantity: null, dispatchText: null, options, images: optionImages });
  }
  if (Array.isArray(base?.skus) && skus.length !== base.skus.length) skus.length = 0;
  return { provider: "taobao", productId, url: `https://${page.hostname}/item.htm?id=${productId}`, title,
    capturedAt: new Date().toISOString(), description: typeof ld?.description === "string" ? ld.description.slice(0, 50000) : null, skus, images };
}
