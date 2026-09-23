import { getConfig, adminApi } from './common.mjs';

console.log('RDC-X Doctor\n');

let backendOk = false;
let backendDetail = '';
let report;
let runtimeError = '';

try {
  const config = getConfig();
  const response = await fetch(`http://127.0.0.1:${config.mcpPort}/health`, {
    signal: AbortSignal.timeout(3000)
  });
  backendOk = response.ok;
  backendDetail = response.ok ? '' : `HTTP ${response.status}`;
  await response.body?.cancel();
} catch (error) {
  backendDetail = error instanceof Error ? error.message : String(error);
}

try {
  report = await adminApi('/diagnostics?refresh=1');
} catch (error) {
  runtimeError = error instanceof Error ? error.message : String(error);
}

const findCheck = id => report?.checks?.find(check => check.id === id);
const findLayer = id => report?.layers?.find(layer => layer.id === id);
const result = (ok, detail = '') => ({ ok: !!ok, detail: ok ? '' : detail || runtimeError || 'Unavailable' });

const dashboard = findCheck('dashboard_api');
const listener = findCheck('mcp_listener');
const initialize = findCheck('mcp_initialize');
const tools = findCheck('tools_list');
const tunnel = findLayer('tunnel');

const rows = [
  ['Backend', result(backendOk, backendDetail)],
  ['Dashboard', result(dashboard?.status === 'ok', dashboard?.detail)],
  ['MCP', result(listener?.status === 'ok' && initialize?.status === 'ok',
    [listener, initialize].find(check => check?.status !== 'ok')?.detail)],
  ['Tunnel', result(tunnel?.status === 'ok', tunnel?.detail)],
  ['Tools', result(tools?.status === 'ok', tools?.detail)]
];

for (const [name, check] of rows) {
  console.log(`[${check.ok ? 'OK' : 'FAIL'}] ${name}${check.detail ? ` — ${check.detail}` : ''}`);
}

if (report?.layers?.length) {
  const layerText = report.layers
    .map(layer => `${layer.name} ${layer.status === 'ok' ? 'OK' : 'FAILED'}`)
    .join(' | ');
  console.log(`\n${layerText}`);
}

const healthy = rows.every(([, check]) => check.ok) && findLayer('openai_upstream')?.status === 'ok';
console.log(`\n${healthy ? 'Healthy' : 'Unhealthy'}`);
process.exitCode = healthy ? 0 : 1;
