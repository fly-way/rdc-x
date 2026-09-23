import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { fixture, port } from './helpers.js';

await test('diagnostics exercise MCP and separate real request history from probes', async t => {
  const f = fixture();
  const mcpPort = await port();
  let adminPort = await port();
  while (adminPort === mcpPort) adminPort = await port();
  let tunnelPort = await port();
  while (tunnelPort === mcpPort || tunnelPort === adminPort) tunnelPort = await port();
  f.state.saveConfig({
    ...f.state.config,
    mcpPort,
    adminPort,
    tunnelPort,
    secureTunnelEnabled: true,
    publicUrl: `http://127.0.0.1:${mcpPort}`
  });

  const app = createApp(f.base);
  await app.listen();
  t.after(async () => { await app.stop(); f.clean(); });

  const adminHeaders = { 'X-RDC-Admin': f.key };
  const diagnosticsUrl = `http://127.0.0.1:${adminPort}/api/diagnostics`;
  const firstResponse = await fetch(diagnosticsUrl, { headers: adminHeaders });
  assert.equal(firstResponse.status, 200);
  const first: any = await firstResponse.json();

  assert.deepEqual(first.checks.map((check: any) => check.name), [
    'RDC-X Backend',
    'Dashboard API',
    'MCP Listener',
    'Tunnel Client',
    'Secure Tunnel',
    'MCP Initialize',
    'Tools/List'
  ]);
  for (const id of ['mcp_listener', 'mcp_initialize', 'tools_list']) {
    assert.equal(first.checks.find((check: any) => check.id === id)?.status, 'ok', id);
  }
  assert.deepEqual(Object.fromEntries(first.layers.map((layer: any) => [layer.id, layer.status])), {
    rdcx: 'ok',
    tunnel: 'error',
    mcp: 'ok',
    openai_upstream: 'error'
  });
  assert.ok(first.metrics.toolCount >= 90);
  assert.deepEqual(first.recentRequests, [], 'self-test probes must not appear as ChatGPT traffic');

  const sseProbe = await fetch(`http://127.0.0.1:${tunnelPort}/mcp`);
  assert.equal(sseProbe.status, 405);
  await sseProbe.body?.cancel();
  const unauthorized = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(unauthorized.status, 401);
  await unauthorized.body?.cancel();

  const second: any = await (await fetch(diagnosticsUrl, { headers: adminHeaders })).json();
  assert.ok(second.recentRequests.some((request: any) =>
    request.request === 'SSE probe' && request.statusCode === 405 && request.error === null));
  assert.ok(second.recentRequests.some((request: any) =>
    request.listener === 'oauth' && request.statusCode === 401 && /authorization/i.test(request.error)));

  // Regression: optional Streamable HTTP SSE probes must never consume the
  // POST execution budget and become the former "SSE probe returned 429".
  for (let offset = 0; offset < 905; offset += 75) {
    const batch = await Promise.all(Array.from({ length: Math.min(75, 905 - offset) }, async () => {
      const response = await fetch(`http://127.0.0.1:${tunnelPort}/mcp`);
      const status = response.status;
      await response.body?.cancel();
      return status;
    }));
    assert.ok(batch.every(status => status === 405));
  }
});
