// Live-equivalent drill: drives the Secure MCP Tunnel endpoint exactly like ChatGPT does,
// on a throwaway instance (random ports, temp directory). It never touches the running
// RDC-X install or its config. Usage: npm run drill
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, port } from '../test/helpers.js';
import { createApp } from '../src/app.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const f = fixture();
const mcpPort = await port();
let adminPort = await port(); while (adminPort === mcpPort) adminPort = await port();
let tunnelPort = await port(); while (tunnelPort === mcpPort || tunnelPort === adminPort) tunnelPort = await port();
f.state.saveConfig({
  ...f.state.config, mcpPort, adminPort, tunnelPort, secureTunnelEnabled: true,
  publicUrl: `http://127.0.0.1:${mcpPort}`
});

const app = createApp(f.base);
await app.listen();
const local = `http://127.0.0.1:${adminPort}`;
const admin = (url: string, body?: unknown) => fetch(local + url, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-RDC-Admin': f.key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body)
});

const client = new Client({ name: 'live-drill', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${tunnelPort}/mcp`)));

const results: { step: string; ok: boolean; detail: string }[] = [];
async function call(step: string, name: string, args: Record<string, unknown> = {}) {
  const started = Date.now();
  try {
    const result: any = await client.callTool({ name, arguments: args });
    const text = String(result.content?.[0]?.text ?? '');
    if (result.isError) { results.push({ step, ok: false, detail: text.slice(0, 160) }); return null; }
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch {}
    results.push({ step, ok: true, detail: `${Date.now() - started}ms` });
    return parsed;
  } catch (error: any) {
    results.push({ step, ok: false, detail: String(error.message).slice(0, 160) });
    return null;
  }
}
const expectFail = async (step: string, name: string, args: Record<string, unknown>) => {
  const value = await call(step, name, args);
  results[results.length - 1] = value === null
    ? { step, ok: true, detail: 'rejected as expected' }
    : { step, ok: false, detail: 'expected failure but succeeded' };
};

const workspace = f.workspace;
const abs = (name: string) => path.join(workspace, name);

await call('ping', 'ping');
await call('who_am_i', 'who_am_i');
await call('get_capabilities', 'get_capabilities');
const tools = (await client.listTools()).tools;

await call('list_directory', 'list_directory', { path: workspace });
await call('write_file', 'write_file', { path: abs('drill.txt'), content: 'alpha\nTODO beta\ngamma', mode: 'create' });
await call('read_file', 'read_file', { path: abs('drill.txt') });
await call('read_multiple_files', 'read_multiple_files', { paths: [abs('drill.txt')] });
await call('get_file_info', 'get_file_info', { path: abs('drill.txt') });
await call('hash_file', 'hash_file', { path: abs('drill.txt') });
await call('edit_block', 'edit_block', { path: abs('drill.txt'), oldText: 'TODO beta', newText: 'done beta', expectedReplacements: 1 });
await call('create_directory', 'create_directory', { path: abs('nested/deep') });
await call('copy_path', 'copy_path', { source: abs('drill.txt'), destination: abs('nested/copy.txt') });
await call('move_path', 'move_path', { source: abs('nested/copy.txt'), destination: abs('nested/moved.txt') });
const trashed: any = await call('delete_path', 'delete_path', { path: abs('nested/moved.txt') });
const recovery: any = await call('list_recovery_items', 'list_recovery_items', {});
if (trashed?.trashId)
  await call('restore_recovery_item', 'restore_recovery_item', { trashId: trashed.trashId, destination: abs('restored.txt') });

const search: any = await call('start_search', 'start_search', {
  path: workspace, pattern: 'done beta', type: 'content', mode: 'literal', maxResults: 10, timeoutSeconds: 10
});
if (search?.searchId) {
  await call('wait_search', 'wait_search', { searchId: search.searchId, timeoutMs: 10000 });
  await call('get_more_search_results', 'get_more_search_results', { searchId: search.searchId });
}

const started: any = await call('start_process', 'start_process', { command: 'Write-Output drill-process-ok', cwd: workspace, timeoutSeconds: 20 });
if (started?.sessionId) {
  await call('wait_process', 'wait_process', { sessionId: started.sessionId, timeoutMs: 10000 });
  await call('read_process_output', 'read_process_output', { sessionId: started.sessionId });
  await call('list_sessions', 'list_sessions', {});
  await call('force_terminate', 'force_terminate', { sessionId: started.sessionId });
}

await call('write_pdf', 'write_pdf', { path: abs('drill.pdf'), text: '# RDC-X drill\nSecond line.', title: 'Drill' });
await call('read_pdf', 'read_pdf', { path: abs('drill.pdf') });
await call('write_docx', 'write_docx', { path: abs('drill.docx'), markdown: '# Title\nhello world' });
await call('read_docx', 'read_docx', { path: abs('drill.docx') });
await call('edit_docx_text', 'edit_docx_text', { path: abs('drill.docx'), oldText: 'hello world', newText: 'hello drill' });
await call('read_docx (after edit)', 'read_docx', { path: abs('drill.docx') });
await call('write_excel', 'write_excel', { path: abs('drill.xlsx'), rows: [['name', 'qty'], ['bolt', 7]], sheet: 'Parts' });
await call('read_excel', 'read_excel', { path: abs('drill.xlsx') });

await call('get_system_info', 'get_system_info');
await call('run_diagnostics', 'run_diagnostics');
await call('list_processes', 'list_processes', { limit: 5 });
await call('list_displays', 'list_displays');
const config: any = await call('get_config', 'get_config');

const strict: any = await call('set_config_value (must ask)', 'set_config_value', { key: 'networkFetchEnabled', value: true });
if (strict?.status === 'approval_required') {
  await admin('/api/approvals/' + strict.requestId, { approve: true });
  await call('get_request_result', 'get_request_result', { requestId: strict.requestId });
}

await fs.writeFile(path.join(f.outside, 'secret.txt'), 'outside');
await expectFail('read outside root (must fail)', 'read_file', { path: path.join(f.outside, 'secret.txt') });
await expectFail('traversal (must fail)', 'read_file', { path: '../outside/secret.txt' });

await call('get_usage_stats', 'get_usage_stats');
await call('get_recent_tool_calls', 'get_recent_tool_calls', { limit: 5 });

console.log('\ntool count            :', tools.length);
console.log('session approval mode :', config?.sessionApprovalMode);
console.log('policy                :', JSON.stringify({
  terminal: config?.terminalEnabled, desktop: config?.desktopControlEnabled,
  process: config?.systemProcessControlEnabled, network: config?.networkFetchEnabled,
  writeApproval: config?.requireWriteApproval, rootAccess: config?.rootAccess
}));
console.log('recovery items        :', Array.isArray(recovery?.items) ? recovery.items.length : recovery);
console.log('');
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.step.padEnd(32)} ${item.detail}`);
const failed = results.filter(item => !item.ok);
console.log(`\ntotal ${results.length}, passed ${results.length - failed.length}, failed ${failed.length}`);

await client.close();
await app.stop();
f.clean();
await new Promise(resolve => setTimeout(resolve, 600));
process.exit(failed.length ? 1 : 0);
