import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

await test('setup protects private files without breaking access and preserves existing secrets', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rdcx-setup-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'scripts'));
  const script = path.join(base, 'scripts', 'setup.mjs');
  fs.copyFileSync(new URL('../scripts/setup.mjs', import.meta.url), script);
  const run = () => spawnSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const first = run(); assert.equal(first.status, 0, first.stderr);
  const configPath = path.join(base, '.rdc', 'config.json');
  const keyPath = path.join(base, '.rdc', 'admin-token.txt');
  const config = fs.readFileSync(configPath, 'utf8'); const key = fs.readFileSync(keyPath, 'utf8');
  assert.equal(JSON.parse(config).terminalEnabled, false);
  assert.equal(JSON.parse(config).requireWriteApproval, true);
  assert.equal(JSON.parse(config).roots[0].path, path.join(base, 'workspace'));
  assert.equal(key.length, 43);
  const second = run(); assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(configPath, 'utf8'), config);
  assert.equal(fs.readFileSync(keyPath, 'utf8'), key);
});
