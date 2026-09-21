import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import { State } from '../src/state.js';
export function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdcx-test-'));
  const base = path.join(root, 'app'); const workspace = path.join(base, 'workspace'); const outside = path.join(root, 'outside');
  for (const dir of [workspace, outside, path.join(base, '.rdc')]) fs.mkdirSync(dir, { recursive: true });
  const config = { deviceId: crypto.randomUUID(), roots: [{ path: workspace, write: true }], allowLoopbackOAuth: true };
  fs.writeFileSync(path.join(base, '.rdc', 'config.json'), JSON.stringify(config));
  const key = crypto.randomBytes(32).toString('base64url'); fs.writeFileSync(path.join(base, '.rdc', 'admin-token.txt'), key);
  const state = new State(base);
  return { root, base, workspace, outside, key, state, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}
export async function port() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const value = (server.address() as net.AddressInfo).port; server.close(() => resolve(value)); });
  });
}
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function eventually(check: () => boolean | Promise<boolean>, timeout = 5000) {
  const start = Date.now(); while (!(await check())) { if (Date.now() - start > timeout) throw new Error('Condition timed out.'); await delay(30); }
}
