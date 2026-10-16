import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectProfile, describeStyle, main as profileMain } from '../skills/sourcing-reference-processing/scripts/reference-profile.mjs';
import { audit, auditText, main as verifyMain } from '../skills/sourcing-reference-processing/scripts/verify-result.mjs';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const id = n => n.toString(16).padStart(32, '0');
const listing = (n, title, categoryCode = '10') => ({ id: id(n), revision: 1, title, categoryCode,
  description: '<h2>옵션 설명</h2><h2>상세 페이지</h2>',
  skus: [{ id: '1', name: '123456789_화이트', options: [{ name: '색상', value: '화이트' }, { name: '크기', value: '' }] }],
  listings: [{ remoteProductId: String(n) }] });

test('scans sequential pages, finds later synonym hits and does not pick unrelated category matches', async () => {
  const rows = [...Array.from({ length: 20 }, (_, n) => listing(n + 1, '다른 상품')), listing(21, '레인보우 장스탠드 조명')];
  const calls = [];
  const out = await collectProfile({ projectId: 'project', queries: ['장스탠드', '램프'], categoryCode: '10' }, async (name, input) => {
    calls.push([name, input.page ?? input.productId]);
    return name === 'list-managed-products' ? rows.slice((input.page - 1) * 20, input.page * 20) : rows.find(r => r.id === input.productId);
  });
  assert.equal(out.catalogComplete, true); assert.equal(out.scannedProducts, 21);
  assert.deepEqual(calls, [['list-managed-products', 1], ['list-managed-products', 2], ['get-managed-product', id(21)]]);
  assert.deepEqual(out.references.map(r => r.productId), [id(21)]);
  assert.deepEqual(out.references[0].style.warnings, ['internal_id_prefix', 'empty_option_value']);
  assert.equal(out.references[0].style.displaySamples[0], '화이트');
  assert.equal(rows[20].skus[0].name, '123456789_화이트');
});

test('reports bounded scan as incomplete and never invents a reference', async () => {
  const out = await collectProfile({ projectId: 'p', queries: ['램프'], maxPages: 1 }, async () =>
    Array.from({ length: 20 }, (_, n) => listing(n + 1, '수납장')));
  assert.equal(out.catalogComplete, false); assert.equal(out.selection, 'no_relevant_reference');
  assert.deepEqual(out.references, []);
});

test('rejects duplicate pages and changed detail revisions', async () => {
  await assert.rejects(collectProfile({ projectId: 'p', queries: ['램프'] }, async () =>
    Array.from({ length: 20 }, (_, n) => listing(n + 1, '램프'))), /reference_catalog_changed/);
  await assert.rejects(collectProfile({ projectId: 'p', queries: ['램프'] }, async name =>
    name === 'list-managed-products' ? [listing(1, '램프')] : { ...listing(1, '램프'), revision: 2 }), /reference_changed/);
});

test('explicit reference must be a current uploaded product', async () => {
  const selected = listing(1, '특별한 이름');
  const result = await collectProfile({ projectId: 'p', queries: [], referenceIds: [selected.id] }, async name =>
    name === 'list-managed-products' ? [selected] : selected);
  assert.deepEqual(result.references[0].reasons, ['explicit_reference']);
  await assert.rejects(collectProfile({ projectId: 'p', queries: [], referenceIds: [id(2)] }, async () => [selected]), /reference_not_in_uploads/);
  await assert.rejects(collectProfile({ projectId: 'p', queries: ['램프'] }, async () => [{ ...selected, listings: [] }]), /invalid_uploaded_reference/);
});

test('summarizes repeated sections and empty axes without copying whole HTML', () => {
  const r = listing(1, '작업대 업소용 선반'); r.description += '<h2>옵션 설명</h2><img src="example">';
  const out = describeStyle(r);
  assert.deepEqual(out.optionAxes, ['색상']); assert.equal(out.imageCount, 1);
  assert.ok(out.warnings.includes('duplicate_option_section'));
  assert.equal(out.description, undefined);
});

const source = { provider: 'taobao', productId: 'raw', sourceHash: 'hash',
  images: [{ src: 'https://example.com/a.png' }],
  skus: ['빨강', '파랑'].map((value, n) => ({ skuId: String(n), options: [{ name: '颜色', value }], images: ['https://example.com/a.png'] })) };
const product = () => ({ id: id(20), revision: 3, sourceProvider: 'taobao', sourceProductId: 'raw',
  title: '실내 조명 장스탠드', description: '<h2>옵션 안내</h2><p>확인된 한국어 설명</p>', categoryCode: '10',
  mainImage: 'https://example.com/a.png', skus: ['빨강', '파랑'].map((value, n) =>
    ({ id: String(n), name: value + ' 조명', salePrice: null, image: 'https://example.com/a.png', options: [{ name: '색상', value }] })) });
const review = () => ({ productId: id(20), revision: 3, sourceProvider: 'taobao', sourceProductId: 'raw', sourceHash: 'hash',
  originalSkuPrices: { '0': null, '1': null }, categoryMatchesAllSkus: true, categoryEvidence: '실제 메타데이터와 전체 옵션 대조', blockingProcessingIssues: [],
  referenceStyle: { references: [{ productId: id(1), revision: 1, reason: '동일 용도의 조명 상품' }], appliedRules: ['상품 종류와 확인된 용도를 앞에 배치'] },
  images: [{ url: 'https://example.com/a.png', sourceImageUrl: 'https://example.com/a.png', width: 1600, height: 1600,
    visualPass: true, noText: true, textReviewPerformed: true, whiteBackgroundPass: true, centeredProductPass: true, completeProductPass: true, notes: '원본과 실제 사진을 대조함' }],
  skuImages: { '0': 'https://example.com/a.png', '1': 'https://example.com/a.png' } });

test('retains valid source combinations and rejects empty/prefixed/collapsed options', () => {
  assert.deepEqual(auditText(product(), source), []);
  const p = product(); p.skus[0].name = '123456789_빨강'; p.skus[0].options.push({ name: '크기', value: '' });
  assert.ok(auditText(p, source).includes('internal_id_in_display_name:0'));
  assert.ok(auditText(p, source).includes('empty_option:0'));
  const merged = product(); merged.skus[1] = { ...merged.skus[1], name: merged.skus[0].name, options: merged.skus[0].options };
  assert.ok(auditText(merged, source).includes('option_distinction_lost:1'));
  const repeated = product(); repeated.description += '<h2>옵션 설명</h2>';
  assert.ok(auditText(repeated, source).includes('duplicate_option_section'));
});

test('completion audit requires reference evidence, white centered product review and preserved prices', () => {
  assert.equal(audit(product(), source, review()).passed, true);
  const noReference = review(); delete noReference.referenceStyle;
  assert.ok(audit(product(), source, noReference).errors.includes('reference_style_review_missing'));
  for (const flag of ['whiteBackgroundPass', 'centeredProductPass', 'completeProductPass']) {
    const r = review(); r.images[0][flag] = false;
    assert.ok(audit(product(), source, r).errors.some(e => e.startsWith('image_presentation_review_failed:')));
  }
  const rectangular = review(); rectangular.images[0].width = 1200;
  assert.equal(audit(product(), source, rectangular).passed, false);
  const changed = product(); changed.skus[0].salePrice = 10000;
  assert.ok(audit(changed, source, review()).errors.includes('price_changed:0'));
  const fallback = review(); fallback.referenceStyle = { references: [], status: 'no_relevant_reference',
    catalogComplete: true, reason: '전체 등록 상품 중 같은 종류가 없음', appliedRules: ['전체 카탈로그의 옵션 표 구성만 적용'] };
  assert.equal(audit(product(), source, fallback).passed, true);
  fallback.referenceStyle.catalogComplete = false;
  assert.equal(audit(product(), source, fallback).passed, false);
});

test('CLI entry points use injected plugin authorization, read-only tools and fresh reference readback', async () => {
  const calls = [];
  let referenceRevision = 1;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-run-key');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/plugins/tools') {
      res.end(JSON.stringify(['list-managed-products', 'get-managed-product', 'get-processing-source'].map(name =>
        ({ name: 'paperclipai.plugin-sourcing-processing:' + name })))); return;
    }
    assert.equal(req.url, '/api/plugins/tools/execute');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)); calls.push(body);
    assert.deepEqual(body.runContext, { companyId: 'company', agentId: 'agent', runId: 'run', projectId: 'project' });
    const reference = { ...listing(1, '조명 램프'), revision: referenceRevision };
    const data = body.tool.endsWith(':list-managed-products') ? [reference] : body.tool.endsWith(':get-processing-source') ? source
      : body.parameters.productId === id(20) ? product() : reference;
    res.end(JSON.stringify({ result: { data } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const scratch = await mkdtemp(join(tmpdir(), 'reference-profile-test-'));
  const env = { PAPERCLIP_API_URL: `http://127.0.0.1:${server.address().port}/api`, PAPERCLIP_API_KEY: 'synthetic-run-key',
    PAPERCLIP_COMPANY_ID: 'company', PAPERCLIP_AGENT_ID: 'agent', PAPERCLIP_RUN_ID: 'run', PAPERCLIP_RUN_SCRATCH_DIR: scratch };
  try {
    const input = join(scratch, 'reference.json'); await writeFile(input, JSON.stringify({ projectId: 'project', queries: ['램프'] }));
    assert.equal((await profileMain(input, env)).references[0].productId, id(1));
    const reviewPath = join(scratch, 'review.json');
    await writeFile(reviewPath, JSON.stringify({ projectId: 'project', accountId: 'account', products: [review()] }));
    assert.equal((await verifyMain(reviewPath, env)).passed, true);
    referenceRevision = 2;
    const stale = await verifyMain(reviewPath, env);
    assert.ok(stale.checks[0].errors.includes('reference_changed_or_not_uploaded:' + id(1)));
    assert.ok(calls.every(c => /:(list-managed-products|get-managed-product|get-processing-source)$/.test(c.tool)));
  } finally {
    await rm(scratch, { recursive: true, force: true });
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
