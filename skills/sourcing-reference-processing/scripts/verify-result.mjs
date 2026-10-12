import { readFile, realpath, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { main as plugin } from './plugin-tools.mjs';

const url = value => String(value ?? '').replace(/^\/\//, 'https://').replaceAll('&amp;', '&');
const numbers = value => String(value ?? '').match(/\d+(?:[.,]\d+)?/g) ?? [];
const chinese = /[\u3400-\u9fff]/u;

// Structural checks complement actual before/after image inspection; they cannot judge pixels.
export function audit(product, source, review) {
  const errors = [];
  const require = (ok, code) => { if (!ok) errors.push(code); };
  require(product.id === review.productId && product.revision === review.revision, 'revision_or_product_changed');
  require(product.sourceProvider === source.provider && product.sourceProductId === source.productId
    && source.provider === review.sourceProvider && source.productId === review.sourceProductId
    && source.sourceHash === review.sourceHash, 'source_identity_or_hash_changed');
  const originalIds = (source.skus ?? []).map(s => s.skuId);
  require(originalIds.length > 0 && Boolean(product.mainImage), 'sku_or_main_image_missing');
  require(JSON.stringify(product.skus.map(s => s.id)) === JSON.stringify(originalIds), 'sku_identity_or_order_changed');
  require(review.originalSkuPrices && JSON.stringify(Object.keys(review.originalSkuPrices).sort()) === JSON.stringify([...originalIds].sort()), 'original_prices_missing');
  for (const sku of product.skus) {
    require(sku.salePrice === review.originalSkuPrices?.[sku.id], 'price_changed:' + sku.id);
    const raw = source.skus.find(s => s.skuId === sku.id);
    const text = [sku.name, ...sku.options.map(o => o.name + ' ' + o.value)].join(' ');
    require(!chinese.test(text) && /[가-힣]/u.test(sku.name), 'unprocessed_sku_text:' + sku.id);
    for (const n of numbers(raw?.options?.map(o => o.value).join(' ')))
      require(numbers(text).includes(n), 'sku_number_missing:' + sku.id + ':' + n);
  }
  require(/[가-힣]/u.test(product.title) && !chinese.test(product.title), 'unprocessed_title');
  require(!chinese.test(String(product.description).replace(/<[^>]*>/g, '')), 'unprocessed_description');
  require(/[가-힣]/u.test(String(product.description).replace(/<[^>]*>/g, '')), 'description_missing');
  require(!/<script|\son[a-z]+\s*=|<iframe\b|<form\b/i.test(product.description), 'unsafe_html');
  require(/^\d+$/.test(product.categoryCode), 'category_missing');
  require(review.categoryMatchesAllSkus === true && typeof review.categoryEvidence === 'string'
    && review.categoryEvidence.trim().length >= 5, 'category_review_missing');
  require(Array.isArray(review.blockingProcessingIssues) && review.blockingProcessingIssues.length === 0, 'processing_blockers_remaining');

  const sourceUrls = new Set((source.images ?? []).flatMap(i => [url(i.src), url(i.lazySrc)]).filter(Boolean));
  for (const sku of source.skus ?? []) for (const image of sku.images ?? []) sourceUrls.add(url(typeof image === 'string' ? image : image.src));
  const used = new Set([product.mainImage, ...product.skus.map(s => s.image),
    ...[...String(product.description).matchAll(/(?:src|data-src)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1])].filter(Boolean).map(url));
  const images = Array.isArray(review.images) ? review.images : [];
  require(new Set(images.map(i => url(i.url))).size === images.length, 'duplicate_image_reviews');
  for (const image of used) {
    const evidence = images.find(i => url(i.url) === image);
    require(Boolean(evidence), 'image_review_missing:' + image);
    if (!evidence) continue;
    require(evidence.visualPass === true && typeof evidence.notes === 'string' && evidence.notes.trim().length >= 5, 'image_review_failed:' + image);
    require(evidence.noText === true && evidence.textReviewPerformed === true, 'image_text_review_failed:' + image);
    require(sourceUrls.has(url(evidence.sourceImageUrl)), 'image_source_not_verified:' + image);
    require(Number.isInteger(evidence.width) && evidence.width > 0 && Number.isInteger(evidence.height) && evidence.height > 0, 'image_dimensions_missing:' + image);
    if (!sourceUrls.has(image)) require(image.endsWith('/images/' + product.id + '/' + evidence.assetId + '.png'), 'unverified_derivative:' + image);
  }
  for (const sku of product.skus) {
    const image = url(review.skuImages?.[sku.id]);
    const raw = source.skus.find(s => s.skuId === sku.id);
    require(!(raw?.images?.length > 0) || Boolean(sku.image), 'source_sku_image_dropped:' + sku.id);
    require(used.has(image) && (sku.image ? image === url(sku.image) : true), 'sku_image_review_missing:' + sku.id);
  }
  return { productId: product.id, revision: product.revision, imageCount: used.size, skuCount: product.skus.length,
    passed: errors.length === 0, errors, pixelReviewRequired: true };
}

function data(response) {
  const body = response.result?.data ?? JSON.parse(response.result?.content ?? '{}');
  return body.data ?? body;
}

export async function main(file, env = process.env) {
  if (!file || !env.PAPERCLIP_RUN_SCRATCH_DIR) throw Error('review_file_and_run_scratch_required');
  const review = JSON.parse(await readFile(file, 'utf8'));
  if (!review.projectId || !review.accountId || !Array.isArray(review.products) || !review.products.length)
    throw Error('invalid_review_scope');
  const scratch = await realpath(env.PAPERCLIP_RUN_SCRATCH_DIR);
  async function call(name, parameters) {
    const input = join(scratch, 'verify-input-' + randomUUID() + '.json');
    await writeFile(input, JSON.stringify(parameters), { flag: 'wx', mode: 0o600 });
    try { return data(await plugin(['call', name, input], env)); }
    finally { await unlink(input); }
  }
  const checks = [];
  for (const p of review.products) {
    const product = await call('get-managed-product', { projectId: review.projectId, productId: p.productId });
    const source = await call('get-processing-source', { projectId: review.projectId, accountId: review.accountId,
      sourceProvider: p.sourceProvider, productId: p.sourceProductId });
    checks.push(audit(product, source, p));
  }
  return { passed: checks.every(c => c.passed), pixelReviewRequired: true, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  try {
    const result = await main(process.argv[2]);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(String(error.message).replaceAll(process.env.PAPERCLIP_API_KEY || '\u0000', '[redacted]') + '\n');
    process.exitCode = 1;
  }
}
