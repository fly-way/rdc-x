import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, eventually } from './helpers.js';
import { FileService } from '../src/files.js';
import { Approvals } from '../src/approvals.js';
import { ProcessService } from '../src/processes.js';
import { SearchService } from '../src/search.js';

await test('filesystem and consent boundaries', async t => {
  const f = fixture(); const files = new FileService(f.state); const approvals = new Approvals(f.state);
  t.after(() => f.clean());
  await t.test('authorized text read and negative line offset', async () => {
    await fs.writeFile(path.join(f.workspace, 'hello.txt'), 'alpha\nbeta\ngamma');
    const result = await files.read('hello.txt', -2, 1); assert.deepEqual(result.lines, ['beta']); assert.equal(result.totalLines, 3);
  });
  await t.test('dot relative path resolves to the first authorized root', async () => {
    assert.equal(await files.guard.resolve('.'), path.resolve(f.workspace));
  });
  await t.test('sibling-directory access and traversal fail closed', async () => {
    await assert.rejects(() => files.guard.resolve(f.outside));
    await assert.rejects(() => files.guard.resolve('../outside'));
  });
  await t.test('empty roots deny access', async () => {
    const roots = f.state.config.roots; f.state.config.roots = [];
    await assert.rejects(() => files.read('hello.txt')); f.state.config.roots = roots;
  });
  await t.test('authorized application source is accessible while runtime credentials stay protected', async () => {
    f.state.config.roots.push({ path: f.base, write: true });
    await assert.rejects(() => files.guard.resolve(path.join(f.base, '.rdc', 'admin-token.txt')));
    await fs.writeFile(path.join(f.base, 'source.txt'), 'editable');
    assert.equal((await files.text(path.join(f.base, 'source.txt'))).text, 'editable');
    await files.write(path.join(f.base, 'source.txt'), 'updated', 'overwrite');
    assert.equal((await files.text(path.join(f.base, 'source.txt'))).text, 'updated');
    await fs.writeFile(path.join(f.workspace, '.env'), 'SECRET=example');
    await assert.rejects(() => files.read('.env'));
    f.state.config.roots.pop();
  });
  await t.test('junction/symlink escape is denied', async () => {
    await fs.writeFile(path.join(f.outside, 'outside.txt'), 'not authorized');
    const link = path.join(f.workspace, 'link'); await fs.symlink(f.outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => files.read(path.join(link, 'outside.txt')));
    await fs.unlink(link);
  });
  await t.test('hard-link escape is denied', async () => {
    const target = path.join(f.workspace, 'hardlink.txt'); await fs.link(path.join(f.outside, 'outside.txt'), target);
    await assert.rejects(() => files.read(target)); await fs.unlink(target);
  });
  await t.test('Windows ADS and device paths are denied', { skip: process.platform !== 'win32' }, async () => {
    for (const name of ['hello.txt:hidden', 'CON', 'NUL.txt', '\\\\localhost\\share\\x', 'hello.txt.']) await assert.rejects(() => files.guard.resolve(name, true, true));
  });
  await t.test('read-only root rejects file mutations', async () => {
    f.state.config.roots[0]!.write = false; await assert.rejects(() => files.write('denied.txt', 'x', 'create')); f.state.config.roots[0]!.write = true;
  });
  await t.test('approval does not run until local decision and runs only once', async () => {
    let count = 0; const result: any = await approvals.run('owner', 'test', { value: 1 }, async () => ({ count: ++count }));
    assert.equal(count, 0); assert.equal(result.status, 'approval_required');
    assert.throws(() => approvals.result(result.requestId, 'other'));
    await approvals.decide(result.requestId, true); assert.equal(count, 1);
    await assert.rejects(() => approvals.decide(result.requestId, true)); assert.equal(count, 1);
    assert.equal(approvals.result(result.requestId, 'owner').status, 'completed');
  });
  await t.test('rejected and expired requests never execute', async () => {
    let count = 0;
    for (const expired of [false, true]) {
      const a: any = await approvals.run('owner', 'test', {}, async () => ++count);
      if (expired) { approvals.items.get(a.requestId)!.expiresAt = Date.now() - 1; await assert.rejects(() => approvals.decide(a.requestId, true)); }
      else await approvals.decide(a.requestId, false);
    }
    assert.equal(count, 0);
  });
  await t.test('create refuses overwrite; edit matches exactly and backs up', async () => {
    await files.write('edit.txt', 'one two one', 'create');
    await assert.rejects(() => files.write('edit.txt', 'bad', 'create'));
    await assert.rejects(() => files.edit('edit.txt', 'one', 'new', 1));
    assert.equal((await files.text('edit.txt')).text, 'one two one');
    await files.edit('edit.txt', 'one', 'new', 2); assert.equal((await files.text('edit.txt')).text, 'new two new');
    assert.ok((await fs.readdir(path.join(f.base, '.rdc', 'backups'))).length >= 1);
  });
  await t.test('copy/move handle directory trees and soft delete can restore', async () => {
    await files.write('from.txt', 'recover me', 'create'); await files.write('to.txt', 'keep me', 'create');
    await assert.rejects(() => files.move('from.txt', 'to.txt'));
    assert.equal((await files.text('to.txt')).text, 'keep me');
    await files.copy('from.txt', 'copied.txt');
    assert.equal((await files.text('copied.txt')).text, 'recover me');

    await files.mkdir('tree/sub');
    await files.write('tree/sub/a.txt', 'A', 'create');
    await files.copy('tree', 'tree-copy');
    assert.equal((await files.text('tree-copy/sub/a.txt')).text, 'A');
    await files.move('tree-copy', 'tree-moved');
    assert.equal((await files.text('tree-moved/sub/a.txt')).text, 'A');

    const deleted = await files.trash('tree-moved');
    await assert.rejects(() => files.info('tree-moved'));
    assert.ok((await files.listTrash()).items.some((x:any) => x.trashId === deleted.trashId));
    await files.restoreTrash(deleted.trashId, 'tree-restored');
    assert.equal((await files.text('tree-restored/sub/a.txt')).text, 'A');
  });
  await t.test('literal search completes and enforces owner isolation', async () => {
    const search = new SearchService(files); const job = await search.start('owner', {
      path: f.workspace, pattern: 'g.mm.', type: 'content', mode: 'regex', ignoreCase: true,
      filePatterns: ['*.txt'], includeHidden: false, includeGenerated: false, contextLines: 1,
      maxDepth: 12, maxResults: 20, timeoutSeconds: 10
    });
    await eventually(() => search.get(job.searchId, 'owner').status !== 'running');
    assert.ok(search.get(job.searchId, 'owner').totalResults >= 1); assert.throws(() => search.get(job.searchId, 'other'));
  });
  await t.test('directory tree operations cannot smuggle protected files', async () => {
    await files.mkdir('protected-tree');
    await fs.writeFile(path.join(f.workspace, 'protected-tree', '.env'), 'SECRET=inside-tree');
    await assert.rejects(() => files.copy('protected-tree', 'protected-copy'), /protected credentials/i);
    await assert.rejects(() => files.move('protected-tree', 'protected-moved'), /protected credentials/i);
    await assert.rejects(() => files.trash('protected-tree'), /protected credentials/i);
    assert.equal(await fs.readFile(path.join(f.workspace, 'protected-tree', '.env'), 'utf8'), 'SECRET=inside-tree');
  });
  await t.test('file size and binary limits are enforced', async () => {
    await fs.writeFile(path.join(f.workspace, 'binary.dat'), Buffer.from([65, 0, 66])); await assert.rejects(() => files.read('binary.dat'));
    const previous = f.state.config.maxFileBytes; f.state.config.maxFileBytes = 2;
    await assert.rejects(() => files.read('hello.txt')); f.state.config.maxFileBytes = previous;
  });
  await t.test('terminal default is disabled', async () => {
    const terminal = new ProcessService(f.state, files.guard); await assert.rejects(() => terminal.start('owner', 'echo test', f.workspace, 5));
  });
  await t.test('terminal command policy blocks and allowlists before execution', async () => {
    f.state.config.terminalEnabled = true;
    const terminal = new ProcessService(f.state, files.guard);
    const ok = process.platform === 'win32' ? "Write-Output 'policy-ok'" : "printf 'policy-ok'";
    const blocked = process.platform === 'win32' ? "Write-Output 'policy-blocked'" : "printf 'policy-blocked'";
    try {
      f.state.config.commandPolicyMode = 'blocklist';
      f.state.config.blockedCommandPatterns = ['*policy-blocked*'];
      await assert.rejects(() => terminal.start('owner', blocked, f.workspace, 5), /blocked by local policy/i);
      assert.equal(terminal.sessions.size, 0);

      f.state.config.commandPolicyMode = 'allowlist';
      f.state.config.blockedCommandPatterns = [];
      f.state.config.allowedCommandPatterns = [ok];
      await assert.rejects(() => terminal.start('owner', blocked, f.workspace, 5), /not allowed by the local command allowlist/i);

      const session = await terminal.start('owner', ok, f.workspace, 20);
      await eventually(() => terminal.read(session.sessionId, 'owner').state !== 'running', 20000);
      assert.match(terminal.read(session.sessionId, 'owner').output, /policy-ok/);
    } finally {
      await terminal.stopAll();
      f.state.config.terminalEnabled = false;
      f.state.config.commandPolicyMode = 'blocklist';
      f.state.config.blockedCommandPatterns = [];
      f.state.config.allowedCommandPatterns = [];
    }
  });
  await t.test('terminal output, ownership and process-tree stop', async () => {
    f.state.config.terminalEnabled = true; const terminal = new ProcessService(f.state, files.guard);
    try {
      const session = await terminal.start('owner', process.platform === 'win32' ? "Write-Output 'rdcx-process-ok'" : "printf 'rdcx-process-ok'", f.workspace, 20);
      await eventually(() => terminal.read(session.sessionId, 'owner').state !== 'running', 20000);
      assert.match(terminal.read(session.sessionId, 'owner').output, /rdcx-process-ok/);
      assert.throws(() => terminal.read(session.sessionId, 'other'));
      const long = await terminal.start('owner', process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30', f.workspace, 30);
      await terminal.stop(long.sessionId, 'owner'); assert.equal(terminal.read(long.sessionId, 'owner').state, 'stopped');
    } finally { await terminal.stopAll(); f.state.config.terminalEnabled = false; }
  });
});
