import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { main as plugin } from './plugin-tools.mjs';

const unique = values => [...new Set(values)];
const text = value => String(value ?? '').normalize('NFKC').toLowerCase().trim();
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

// Imported listing names can contain a collector ID. Strip it for display samples only.
export const displayName = value => String(value ?? '').replace(/^\d{7,}_/, '').trim();
export function describeStyle(product) {
  const skus = product.skus ?? [];
  const options = skus.flatMap(s => s.options ?? []);
  const description = String(product.description ?? '');
  const warnings = [];
  if (skus.some(s => /^\d{7,}_/.test(s.name))) warnings.push('internal_id_prefix');
  if (options.some(o => !String(o.value ?? '').trim())) warnings.push('empty_option_value');
  if ((description.match(/옵션\s*설명/g) ?? []).length > 1) warnings.push('duplicate_option_section');
  return {
    titleCharacters: product.title.length,
    titleTerms: product.title.split(/\s+/).filter(Boolean),
    optionAxes: unique(options.filter(o => String(o.value ?? '').trim()).map(o => o.name)),
    displaySamples: unique(skus.map(s => displayName(s.name))).slice(0, 3),
    hasOptionSection: /옵션\s*(설명|안내)/.test(description),
    hasDetailSection: /상세\s*(페이지|이미지|설명)/.test(description),
    imageCount: (description.match(/<img\b/gi) ?? []).length,
    warnings,
  };
}

function validate(input) {
  if (!input || typeof input.projectId !== 'string' || !input.projectId
      || !Array.isArray(input.queries) || input.queries.length > 12
      || input.queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 40)
      || (input.referenceIds !== undefined && (!Array.isArray(input.referenceIds)
        || input.referenceIds.length > 3 || input.referenceIds.some(id => !/^[a-f0-9]{32}$/.test(id))))
      || (!input.queries.length && !input.referenceIds?.length)
      || (input.categoryCode !== undefined && !/^\d{1,30}$/.test(input.categoryCode))
      || (input.maxPages !== undefined && (!Number.isInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 1000)))
    throw Error('invalid_reference_profile_input');
}

export async function collectProfile(input, call) {
  validate(input);
  const products = new Map();
  let complete = false, pagesRead = 0;
  // Full local catalogue scan: AND-search would miss synonyms in the reference titles.
  // Requests are awaited; no browser navigation, supplier scraping or product writes.
  for (let page = 1; page <= (input.maxPages ?? 100); page++) {
    const rows = await call('list-managed-products', { projectId: input.projectId, view: 'uploads', page });
    if (!Array.isArray(rows)) throw Error('invalid_reference_page');
    pagesRead++;
    for (const p of rows) {
      if (!p || !/^[a-f0-9]{32}$/.test(p.id) || !Number.isInteger(p.revision)
          || !p.listings?.some(l => l.remoteProductId)) throw Error('invalid_uploaded_reference');
      if (products.has(p.id)) throw Error('reference_catalog_changed: retry the read after catalogue updates settle');
      products.set(p.id, p);
    }
    if (rows.length < 20) { complete = true; break; }
  }
  const terms = unique(input.queries.flatMap(q => text(q).split(/\s+/)).filter(Boolean));
  const explicit = unique(input.referenceIds ?? []);
  if (explicit.some(id => !products.has(id))) throw Error(complete ? 'reference_not_in_uploads' : 'reference_not_in_scanned_pages');
  const ranked = [...products.values()].map(p => {
    const matches = terms.filter(term => text(p.title).includes(term));
    const sameCategory = Boolean(input.categoryCode && p.categoryCode === input.categoryCode);
    return { p, matches, sameCategory, explicit: explicit.includes(p.id),
      score: matches.reduce((n, term) => n + Math.min(term.length, 6), 0) + (matches.length && sameCategory ? 2 : 0) };
  }).filter(r => r.explicit || r.matches.length)
    .sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.score - a.score || a.p.id.localeCompare(b.p.id));
  const references = [];
  for (const row of ranked.slice(0, 3)) {
    const p = await call('get-managed-product', { projectId: input.projectId, productId: row.p.id });
    if (p.id !== row.p.id || p.revision !== row.p.revision || !p.listings?.some(l => l.remoteProductId))
      throw Error('reference_changed: restart the read before using this reference');
    references.push({ productId: p.id, revision: p.revision, title: p.title, categoryCode: p.categoryCode,
      contentHash: createHash('sha256').update(JSON.stringify([p.title, p.description, p.skus])).digest('hex'),
      reasons: [...(row.explicit ? ['explicit_reference'] : []), ...row.matches.map(t => 'title:' + t),
        ...(row.sameCategory ? ['same_category_hint_only'] : [])],
      style: describeStyle(p) });
  }
  return { projectId: input.projectId, queries: input.queries, pagesRead, scannedProducts: products.size,
    catalogComplete: complete, selection: references.length ? 'candidates_require_product_type_review' : 'no_relevant_reference',
    catalogueStyle: { medianTitleCharacters: median([...products.values()].map(p => p.title.length)),
      optionSectionProducts: [...products.values()].filter(p => /옵션\s*(설명|안내)/.test(p.description)).length },
    references, transfer: 'Style only. Verify product type and use target source facts, images, SKU IDs and prices. Category is a hint, never evidence.' };
}

export async function main(file, env = process.env) {
  const input = JSON.parse(await readFile(file, 'utf8'));
  // The tool helper retains injected run authorization and the existing plugin boundaries.
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  if (!env.PAPERCLIP_RUN_SCRATCH_DIR) throw Error('run_scratch_required');
  const directory = await mkdtemp(join(await realpath(env.PAPERCLIP_RUN_SCRATCH_DIR), 'reference-profile-'));
  try {
    return await collectProfile(input, async (name, parameters) => {
      const path = join(directory, 'parameters.json');
      await writeFile(path, JSON.stringify(parameters), { mode: 0o600 });
      const response = await plugin(['call', name, path], env);
      const data = response.result?.data ?? JSON.parse(response.result?.content ?? '{}');
      return data.data ?? data;
    });
  } finally { await rm(directory, { recursive: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(await main(process.argv[2]), null, 2) + '\n'); }
  catch (error) {
    process.stderr.write(String(error.message).replaceAll(process.env.PAPERCLIP_API_KEY || '\u0000', '[redacted]') + '\n');
    process.exitCode = 1;
  }
}
