import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fixture } from './helpers.js';
import { FileService } from '../src/files.js';
import { Approvals } from '../src/approvals.js';
import { configSchema } from '../src/state.js';

await test('access policy defaults enable every local capability', async t => {
  await t.test('new configurations enable terminal, process, desktop and network access', () => {
    const parsed = configSchema.parse({ deviceId: crypto.randomUUID(), roots: [] });
    assert.equal(parsed.terminalEnabled, true);
    assert.equal(parsed.systemProcessControlEnabled, true);
    assert.equal(parsed.desktopControlEnabled, true);
    assert.equal(parsed.networkFetchEnabled, true);
    assert.equal(parsed.requireWriteApproval, true);
    assert.equal(parsed.rootAccess, 'selected');
  });

  await t.test('sessions are trusted by default and can be switched back to per-action approval', async () => {
    const f = fixture();
    try {
      const approvals = new Approvals(f.state);
      assert.equal(approvals.mode('grant-a'), 'trusted');
      let ran = 0;
      assert.equal(await approvals.run('grant-a', 'write_file', {}, async () => ++ran, true), 1);

      approvals.setMode('grant-a', 'default');
      assert.equal(approvals.mode('grant-a'), 'default');
      const pending: any = await approvals.run('grant-a', 'write_file', {}, async () => ++ran, true);
      assert.equal(pending.status, 'approval_required');
      assert.equal(ran, 1);

      // Remote policy changes stay approval-gated even in a trusted session.
      approvals.setMode('grant-a', 'trusted');
      const strict: any = await approvals.run('grant-a', 'set_config_value', { key: 'roots' }, async () => ++ran, true, false);
      assert.equal(strict.status, 'approval_required');
      assert.equal(ran, 1);

      approvals.resetSessionTrust();
      assert.equal(approvals.mode('grant-a'), 'trusted');
    } finally { f.clean(); }
  });
});

await test('directory authorization mode selects between all directories and chosen roots', async t => {
  const f = fixture();
  try {
    const files = new FileService(f.state);
    await fs.writeFile(path.join(f.outside, 'outside.txt'), 'outside');
    await fs.writeFile(path.join(f.workspace, '.env'), 'SECRET=x');

    await t.test('selected mode rejects paths outside the authorized roots', async () => {
      assert.equal(f.state.config.rootAccess, 'selected');
      await assert.rejects(() => files.guard.resolve(f.outside));
      await assert.rejects(() => files.guard.resolve('outside.txt'));
    });

    await t.test('all mode reaches any absolute directory but keeps protected paths closed', async () => {
      f.state.config.rootAccess = 'all';
      assert.equal((await files.text(path.join(f.outside, 'outside.txt'))).text, 'outside');
      await assert.rejects(() => files.guard.resolve(path.join(f.outside, '.env')));
      await assert.rejects(() => files.guard.resolve(path.join(f.base, '.rdc', 'admin-token.txt')));
      await assert.rejects(() => files.guard.resolve('CON'));
      await assert.rejects(() => files.guard.resolve('\\\\localhost\\share\\x'));
    });

    await t.test('all mode does not depend on the root list', async () => {
      const roots = f.state.config.roots;
      f.state.config.roots = [];
      assert.equal((await files.text(path.join(f.outside, 'outside.txt'))).text, 'outside');
      f.state.config.roots = roots;
    });

    await t.test('missing directories only fail validation in selected mode', () => {
      const missing = [{ path: path.join(f.root, 'does-not-exist'), write: true }];
      assert.doesNotThrow(() => f.state.validate({ ...f.state.config, rootAccess: 'all', roots: missing }));
      assert.throws(() => f.state.validate({ ...f.state.config, rootAccess: 'selected', roots: missing }), /does not exist/i);
    });

    await t.test('relative paths still resolve when all mode has no root list', async () => {
      const roots = f.state.config.roots;
      f.state.config.roots = [];
      const resolved = await files.guard.resolve('.');
      assert.equal(path.isAbsolute(resolved), true);
      f.state.config.roots = roots;
    });
  } finally { f.clean(); }
});
