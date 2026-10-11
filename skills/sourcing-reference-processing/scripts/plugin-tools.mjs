import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const prefix = 'paperclipai.plugin-sourcing-processing:';

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
  const response = await request('/plugins/tools/execute', {
    tool, parameters, runContext: {
      companyId: env.PAPERCLIP_COMPANY_ID, agentId: env.PAPERCLIP_AGENT_ID,
      runId: env.PAPERCLIP_RUN_ID, projectId: parameters.projectId,
    },
  });
  return response;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await main(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result, null, 2).replaceAll(process.env.PAPERCLIP_API_KEY, '[redacted]') + '\n');
  } catch (error) {
    const message = String(error.message).replaceAll(process.env.PAPERCLIP_API_KEY || '\u0000', '[redacted]');
    process.stderr.write(message + '\n'); process.exitCode = 1;
  }
}
