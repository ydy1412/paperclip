import { readFile, realpath, writeFile, lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const prefix = 'paperclipai.plugin-sourcing-processing:';

export function assertImageGeometry(input, dimensions) {
  const within = (r, bounds) => ['x','y','width','height'].every(k => Number.isInteger(r?.[k]))
    && r.width > 0 && r.height > 0 && r.x >= bounds.x && r.y >= bounds.y
    && r.x + r.width <= bounds.x + bounds.width && r.y + r.height <= bounds.y + bounds.height;
  if (!Number.isInteger(dimensions?.width) || !Number.isInteger(dimensions?.height)) throw Error('image_dimensions_not_verified');
  const original = { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
  if (input.crop && !within(input.crop, original)) throw Error('image_crop_out_of_bounds: re-read original dimensions and choose a new rectangle');
  for (const region of input.cleanupRegions ?? [])
    if (!within(region, input.crop ?? original)) throw Error('image_cleanup_out_of_bounds: use original coordinates inside the retained crop');
}

const bodyData = response => {
  const value = response.result?.data ?? JSON.parse(response.result?.content ?? '{}');
  return value.data ?? value;
};

export async function main(args, env = process.env) {
  const required = ['PAPERCLIP_API_URL', 'PAPERCLIP_API_KEY', 'PAPERCLIP_AGENT_ID', 'PAPERCLIP_COMPANY_ID', 'PAPERCLIP_RUN_ID'];
  if (required.some(key => !env[key])) throw new Error('injected_run_context_missing');
  const [mode, name, inputFile, ...extra] = args;
  if (extra.length || !['list', 'call'].includes(mode) || (mode === 'list' && name) || (mode === 'call' && (!name || !inputFile))) {
    throw new Error('usage: plugin-tools.mjs list | call <tool-name> <parameters.json>');
  }
  const base = env.PAPERCLIP_API_URL.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_api_url');
  async function request(path, body) {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: 'Bearer ' + env.PAPERCLIP_API_KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(150000),
    });
    if (!response.ok) throw new Error(`plugin_request_failed: HTTP ${response.status}; re-read before retrying a write`);
    return response.json();
  }
  const discovered = await request('/plugins/tools');
  if (!Array.isArray(discovered)) throw new Error('invalid_tool_discovery_response');
  const tools = discovered.filter(tool => typeof tool.name === 'string' && tool.name.startsWith(prefix));
  if (mode === 'list') return tools;
  const tool = name.includes(':') ? name : prefix + name;
  if (!tools.some(item => item.name === tool)) throw new Error('tool_not_available_for_current_run');
  const parameters = JSON.parse(await readFile(inputFile, 'utf8'));
  if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object' || typeof parameters.projectId !== 'string' || !parameters.projectId) {
    throw new Error('parameters_require_projectId');
  }
  if (['companyId', 'agentId', 'runId', 'runContext'].some(key => Object.hasOwn(parameters, key))) throw new Error('identity_must_come_from_injected_run');
  if (tool === prefix + 'get-product-image') {
    if (typeof parameters.assetId !== 'string' || !/^[a-f0-9]{32}$/.test(parameters.assetId)) throw new Error('image_parameters_require_assetId');
    if (!env.PAPERCLIP_RUN_SCRATCH_DIR) throw new Error('image_scratch_context_missing');
  }
  const execute = (selectedTool, selectedParameters) => request('/plugins/tools/execute', {
    tool: selectedTool, parameters: selectedParameters, runContext: {
      companyId: env.PAPERCLIP_COMPANY_ID, agentId: env.PAPERCLIP_AGENT_ID,
      runId: env.PAPERCLIP_RUN_ID, projectId: selectedParameters.projectId,
    },
  });
  if (tool === prefix + 'process-product-image') {
    for (const required of ['get-managed-product', 'inspect-product-image'])
      if (!tools.some(item => item.name === prefix + required)) throw Error('image_preflight_tools_missing');
    const product = bodyData(await execute(prefix + 'get-managed-product', {
      projectId: parameters.projectId, productId: parameters.productId,
    }));
    // The server checks revision after its idempotent receipt lookup. A retry
    // of a successful request intentionally carries the original revision.
    const refs = [product.mainImage, ...product.skus.map(s => s.image)];
    const ownedImagePrefix = `/api/companies/${env.PAPERCLIP_COMPANY_ID}/sourcing/projects/${parameters.projectId}/images/${parameters.productId}/`;
    if (!refs.includes(parameters.imageUrl) && !String(product.description).includes(parameters.imageUrl)
        && !refs.some(u => typeof u === 'string' && u.startsWith(ownedImagePrefix))
        && !String(product.description).includes(ownedImagePrefix))
      throw Error('image_not_linked_to_current_product: save the selected original URL in main/SKU/HTML, then re-read revision');
    const dimensions = bodyData(await execute(prefix + 'inspect-product-image', {
      projectId: parameters.projectId, productId: parameters.productId, imageUrl: parameters.imageUrl,
    }));
    assertImageGeometry(parameters, dimensions);
  }
  const response = await execute(tool, parameters);
  if (tool === prefix + 'get-product-image') {
    const data = response.result?.data;
    if (data?.contentType !== 'image/png' || typeof data.base64 !== 'string' || data.base64.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.base64)) throw new Error('invalid_image_response');
    const bytes = Buffer.from(data.base64, 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('invalid_png_signature');
    const directory = await realpath(env.PAPERCLIP_RUN_SCRATCH_DIR);
    const filePath = join(directory, parameters.assetId + '.png');
    try { await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if ((await lstat(filePath)).isSymbolicLink()) throw new Error('image_path_is_symlink'); if (!(await readFile(filePath)).equals(bytes)) throw new Error('existing_image_changed'); }
    return { filePath, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
  return response;
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  try {
    const result = await main(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result, null, 2).replaceAll(process.env.PAPERCLIP_API_KEY, '[redacted]') + '\n');
  } catch (error) {
    const message = String(error.message).replaceAll(process.env.PAPERCLIP_API_KEY || '\u0000', '[redacted]');
    process.stderr.write(message + '\n'); process.exitCode = 1;
  }
}
