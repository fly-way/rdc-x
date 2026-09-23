import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, port } from './helpers.js';
import { createApp } from '../src/app.js';

await test('native folder picker API is local-admin only', async t => {
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
  t.after(async () => { await app.stop(); f.clean(); });

  const local = `http://127.0.0.1:${adminPort}`;
  const call = (url: string, body?: unknown, withKey = true) => fetch(local + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(withKey ? { 'X-RDC-Admin': f.key } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  await t.test('picker endpoints require the local admin key', async () => {
    assert.equal((await call('/api/folder-pick', { title: 'x' }, false)).status, 401);
    assert.equal((await call('/api/folder-pick/anything', undefined, false)).status, 401);
  });

  await t.test('unknown picker requests are reported, not invented', async () => {
    assert.equal((await call('/api/folder-pick/unknown-id')).status, 404);
    const cancel = await call('/api/folder-pick/unknown-id/cancel', {});
    assert.equal(cancel.status, 200);
  });

  await t.test('dashboard state carries the directory authorization mode', async () => {
    const state: any = await (await call('/api/state')).json();
    assert.equal(state.config.rootAccess, 'selected');

    const saved = await call('/api/config', { ...f.state.config, rootAccess: 'all' });
    assert.equal(saved.status, 200);
    const after: any = await (await call('/api/state')).json();
    assert.equal(after.config.rootAccess, 'all');
  });
});
