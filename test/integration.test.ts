import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fixture, port } from './helpers.js';
import { createApp } from '../src/app.js';

await test('HTTP, OAuth and real MCP SDK integration', async t => {
  const f = fixture(); const mcpPort = await port(); let adminPort = await port(); while (adminPort === mcpPort) adminPort = await port(); let tunnelPort = await port(); while (tunnelPort === mcpPort || tunnelPort === adminPort) tunnelPort = await port();
  f.state.saveConfig({ ...f.state.config, mcpPort, adminPort, tunnelPort, secureTunnelEnabled: true, publicUrl: `http://127.0.0.1:${mcpPort}` });
  const app = createApp(f.base); await app.listen();
  const origin = `http://127.0.0.1:${mcpPort}`; const local = `http://127.0.0.1:${adminPort}`; const tunnel = `http://127.0.0.1:${tunnelPort}`;
  t.after(async () => { await app.stop(); f.clean(); });
  const post = (url: string, body: unknown, key?: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-RDC-Admin': key } : {}) }, body: JSON.stringify(body) });
  async function exchange(clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) {
    return fetch(origin + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: 'http://127.0.0.1:9876/callback', resource: origin + '/mcp', ...extra }) });
  }
  async function pairing(scope = 'rdc.read rdc.write rdc.exec') {
    const registered = await post(origin + '/register', { client_name: 'Integration test client', redirect_uris: ['http://127.0.0.1:9876/callback'], token_endpoint_auth_method: 'none' });
    assert.equal(registered.status, 201); const client = await registered.json();
    const verifier = crypto.randomBytes(32).toString('base64url'); const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_challenge: challenge, code_challenge_method: 'S256', state: 'test-state', scope, resource: origin + '/mcp' });
    const authorized = await fetch(origin + '/authorize?' + query, { redirect: 'manual' }); assert.equal(authorized.status, 303);
    const wait = authorized.headers.get('location')!; const id = wait.split('/').pop()!;
    return { client, verifier, wait, id };
  }
  async function approved(scope?: string) {
    const p = await pairing(scope);
    const before = await fetch(origin + p.wait); assert.match(await before.text(), /RDC-X/);
    const approved = await post(local + '/api/pairings/' + p.id, { approve: true }, f.key); assert.equal(approved.status, 200);
    const redirect = await fetch(origin + p.wait, { redirect: 'manual' }); assert.equal(redirect.status, 303);
    const target = new URL(redirect.headers.get('location')!); assert.equal(target.searchParams.get('state'), 'test-state');
    return { ...p, code: target.searchParams.get('code')! };
  }
  async function tokens(scope?: string) { const p = await approved(scope); const result = await exchange(p.client.client_id, p.code, p.verifier); assert.equal(result.status, 200); return { ...p, token: await result.json() }; }
  let full: Awaited<ReturnType<typeof tokens>>;
  await t.test('unauthenticated MCP is denied and advertises resource metadata', async () => {
    const result = await post(origin + '/mcp', {}); assert.equal(result.status, 401); assert.match(result.headers.get('www-authenticate')!, /oauth-protected-resource\/mcp/);
    const metadata = await (await fetch(origin + '/.well-known/oauth-protected-resource/mcp')).json(); assert.equal(metadata.resource, origin + '/mcp');
  });
  await t.test('admin requires separate key and is absent from public port', async () => {
    assert.equal((await fetch(local + '/api/state')).status, 401);
    assert.equal((await fetch(origin + '/api/state')).status, 404);
    assert.equal((await fetch(local + '/api/state', { headers: { 'X-RDC-Admin': f.key, Origin: 'https://attacker.invalid' } })).status, 403);
    // Fetch normalizes Host in recent Node releases; send the wire header explicitly.
    const rawStatus = (url: string) => new Promise<number>(function(resolve, reject) {
      const request = http.get(url, { headers: { Host: 'attacker.invalid' } }, response => {
        response.resume(); resolve(response.statusCode!);
      });
      request.on('error', reject); request.setTimeout(3000, () => request.destroy(new Error('Timeout')));
    });
    assert.equal(await rawStatus(origin + '/health'), 403);
    assert.equal(await rawStatus(local + '/api/state'), 403);
  });
  await t.test('Dashboard bootstrap starts locked and requires a fresh Runtime API Key', async () => {
    const bootstrap = await fetch(local + '/api/bootstrap', { headers: { 'X-RDC-Admin': f.key } });
    assert.equal(bootstrap.status, 200);
    const state = await bootstrap.json();
    assert.equal(state.dashboardUnlocked, false);
    assert.equal(state.ready, false);

    const missingKey = await post(local + '/api/bootstrap/connect', {
      tunnelId: 'tunnel_0123456789abcdef0123456789abcdef',
      runtimeApiKey: ''
    }, f.key);
    assert.equal(missingKey.status, 400);
    assert.match(String((await missingKey.json()).error), /Runtime API Key is required/i);
  });

  await t.test('unknown redirect hosts and plain PKCE are rejected', async () => {
    assert.equal((await post(origin + '/register', { redirect_uris: ['https://attacker.invalid/callback'] })).status, 400);
    assert.equal((await fetch(origin + '/authorize?response_type=code&code_challenge_method=plain')).status, 400);
  });
  await t.test('local pairing, S256 exchange and one-use code', async () => {
    full = await tokens(); assert.equal(full.token.token_type, 'Bearer');
    assert.equal((await exchange(full.client.client_id, full.code, full.verifier)).status, 400);
  });
  await t.test('wrong PKCE verifier cannot exchange a locally approved code', async () => {
    const p = await approved(); assert.equal((await exchange(p.client.client_id, p.code, 'x'.repeat(43))).status, 400);
  });
  await t.test('authorization code is bound to resource audience', async () => {
    const p = await approved(); assert.equal((await exchange(p.client.client_id, p.code, p.verifier, { resource: 'https://attacker.invalid/mcp' })).status, 400);
  });
  await t.test('rejected pairing returns access_denied without code', async () => {
    const p = await pairing(); await post(local + '/api/pairings/' + p.id, { approve: false }, f.key);
    const result = await fetch(origin + p.wait, { redirect: 'manual' });
    const target = new URL(result.headers.get('location')!); assert.equal(target.searchParams.get('error'), 'access_denied'); assert.equal(target.searchParams.get('code'), null);
  });
  await t.test('SDK initializes, discovers expanded tools and completes approved write', async () => {
    const client = new Client({ name: 'rdcx-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + full.token.access_token } } }));
    try {
      const tools = (await client.listTools()).tools;
      assert.ok(tools.length >= 95);
      for (const name of ['who_am_i','get_capabilities','set_config_value','hash_file','copy_path','move_path','delete_path','restore_recovery_item','read_pdf','pdf_extract_pages','pdf_insert_pdf','edit_docx_text','read_url','wait_search','wait_process','run_diagnostics','list_processes','list_displays','get_window_info','desktop_screenshot_region','mouse_scroll','unity_get_hierarchy','unity_set_transform','unity_get_serialized_properties','unity_set_serialized_property','unity_find_assets','unity_instantiate_prefab','unity_save_prefab'])
        assert.ok(tools.some(tool => tool.name === name), 'missing tool: ' + name);
      const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
      const processSchema:any = byName.start_process.inputSchema;
      assert.deepEqual(processSchema.required, ['command']);
      assert.ok(processSchema.properties.cwd);
      assert.ok(processSchema.properties.timeoutSeconds);
      assert.ok(processSchema.properties.shell);
      assert.equal('timeout_ms' in processSchema.properties, false);
      const searchSchema:any = byName.start_search.inputSchema;
      assert.ok(searchSchema.properties.mode);
      assert.ok(searchSchema.properties.filePatterns);
      assert.equal('searchType' in searchSchema.properties, false);
      const ping: any = await client.callTool({ name: 'ping', arguments: {} });
      const pingValue = JSON.parse(ping.content[0].text);
      assert.equal(pingValue.status, 'online');
      assert.equal(pingValue.toolSchemaVersion, 2);
      const write: any = await client.callTool({ name: 'write_file', arguments: { path: 'sdk-test.txt', content: 'written via approved MCP', mode: 'create' } });
      const pending = JSON.parse(write.content[0].text); assert.equal(pending.status, 'approval_required');
      await assert.rejects(() => app.files.info('sdk-test.txt'));
      await post(local + '/api/approvals/' + pending.requestId, { approve: true }, f.key);
      const result: any = await client.callTool({ name: 'get_request_result', arguments: { requestId: pending.requestId } }); assert.equal(JSON.parse(result.content[0].text).status, 'completed');
      assert.equal((await app.files.text('sdk-test.txt')).text, 'written via approved MCP');
      assert.equal((await client.listTools()).tools.some(tool => tool.name === 'approve'), false);
    } finally { await client.close(); }
  });
  await t.test('loopback Secure MCP Tunnel endpoint works without OAuth but keeps local approval', async () => {
    const client = new Client({ name: 'secure-tunnel-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(tunnel + '/mcp')));
    try {
      const tools = (await client.listTools()).tools;
      assert.ok(tools.some(tool => tool.name === 'desktop_screenshot'));
      const ping: any = await client.callTool({ name: 'ping', arguments: {} });
      assert.equal(JSON.parse(ping.content[0].text).status, 'online');
      const write: any = await client.callTool({ name: 'write_file', arguments: { path: 'tunnel-test.txt', content: 'secure tunnel', mode: 'create' } });
      const pending = JSON.parse(write.content[0].text);
      assert.equal(pending.status, 'approval_required');
      await post(local + '/api/approvals/' + pending.requestId, { approve: true }, f.key);
      const result: any = await client.callTool({ name: 'get_request_result', arguments: { requestId: pending.requestId } });
      assert.equal(JSON.parse(result.content[0].text).status, 'completed');
      assert.equal((await app.files.text('tunnel-test.txt')).text, 'secure tunnel');
    } finally { await client.close(); }
  });
  await t.test('Secure MCP Tunnel session can be locally switched to trusted mode', async () => {
    const changed = await post(local + '/api/tunnel/approval-mode', { mode: 'trusted' }, f.key);
    assert.equal(changed.status, 200);
    const client = new Client({ name: 'secure-tunnel-trusted-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(tunnel + '/mcp')));
    try {
      const write: any = await client.callTool({ name: 'write_file', arguments: { path: 'tunnel-trusted.txt', content: 'trusted', mode: 'create' } });
      assert.equal(JSON.parse(write.content[0].text).path.endsWith('tunnel-trusted.txt'), true);

      app.state.config.terminalEnabled = true;
      const started: any = await client.callTool({ name: 'start_process', arguments: { command: "Write-Output 'native-process-ok'", timeoutSeconds: 10 } });
      assert.equal(started.isError, undefined, started.content?.[0]?.text);
      const session = JSON.parse(started.content[0].text);
      assert.equal(typeof session.sessionId, 'string', started.content?.[0]?.text);
      const waited: any = await client.callTool({ name: 'wait_process', arguments: { sessionId: session.sessionId, timeoutMs: 10000, offset: 0, length: 20000 } });
      const waitedSnapshot = JSON.parse(waited.content[0].text);
      assert.notEqual(waitedSnapshot.state, 'running');
      assert.match(waitedSnapshot.output ?? '', /native-process-ok/);

      const hash: any = await client.callTool({ name: 'hash_file', arguments: { path: 'tunnel-trusted.txt', algorithm: 'sha256', maxBytes: 1024 } });
      assert.match(JSON.parse(hash.content[0].text).digest, /^[a-f0-9]{64}$/);

      const diagnostics: any = await client.callTool({ name: 'run_diagnostics', arguments: {} });
      const diagnosticValue = JSON.parse(diagnostics.content[0].text);
      assert.equal(diagnosticValue.toolSchemaVersion, 2);
      assert.equal(diagnosticValue.roots[0].exists, true);

      const strictConfig: any = await client.callTool({ name: 'set_config_value', arguments: { key: 'networkFetchEnabled', value: true } });
      const strictPending = JSON.parse(strictConfig.content[0].text);
      assert.equal(strictPending.status, 'approval_required');
      await post(local + '/api/approvals/' + strictPending.requestId, { approve: true }, f.key);
      const strictResult: any = await client.callTool({ name: 'get_request_result', arguments: { requestId: strictPending.requestId } });
      assert.equal(JSON.parse(strictResult.content[0].text).status, 'completed');
      const configAfter: any = await client.callTool({ name: 'get_config', arguments: {} });
      assert.equal(JSON.parse(configAfter.content[0].text).sessionApprovalMode, 'default');
    } finally {
      await client.close();
      await post(local + '/api/tunnel/approval-mode', { mode: 'default' }, f.key);
    }
  });
  await t.test('read-only scope cannot write', async () => {
    const readOnly = await tokens('rdc.read'); const client = new Client({ name: 'readonly-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + readOnly.token.access_token } } }));
    try { const result = await client.callTool({ name: 'write_file', arguments: { path: 'denied.txt', content: 'x' } }); assert.equal(result.isError, true); }
    finally { await client.close(); }
  });
  await t.test('refresh rotates; replay revokes the grant family', async () => {
    const p = await tokens();
    const refresh = (value: string) => fetch(origin + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: p.client.client_id, refresh_token: value, resource: origin + '/mcp' }) });
    const result = await refresh(p.token.refresh_token); assert.equal(result.status, 200); const rotated = await result.json();
    assert.notEqual(rotated.refresh_token, p.token.refresh_token);
    assert.equal((await refresh(p.token.refresh_token)).status, 400);
    const replayed = await fetch(origin + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + rotated.access_token, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(replayed.status, 401);
  });
  await t.test('pause blocks valid tokens and revoke invalidates them', async () => {
    await post(local + '/api/pause', { paused: true }, f.key);
    assert.equal((await fetch(origin + '/mcp', { headers: { Authorization: 'Bearer ' + full.token.access_token } })).status, 503);
    await post(local + '/api/pause', { paused: false }, f.key);
    await post(local + '/api/revoke', {}, f.key);
    assert.equal((await fetch(origin + '/mcp', { headers: { Authorization: 'Bearer ' + full.token.access_token } })).status, 401);
  });
});
