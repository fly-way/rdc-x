import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(base, '.rdc');
for (const dir of [data, path.join(data, 'backups'), path.join(data, 'trash'), path.join(base, 'workspace')]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const configPath = path.join(data, 'config.json');
if (!fs.existsSync(configPath)) {
  const config = { name: os.hostname(), deviceId: crypto.randomUUID(), mcpPort: 47831, adminPort: 47832,
    publicUrl: 'http://127.0.0.1:47831', roots: [{ path: path.join(base, 'workspace'), write: true }],
    requireWriteApproval: true, terminalEnabled: false, maxFileBytes: 2097152, maxProcessSeconds: 600,
    oauthRedirectHosts: ['chatgpt.com', 'chat.openai.com'], allowLoopbackOAuth: false };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
const token = path.join(data, 'admin-token.txt');
if (!fs.existsSync(token)) fs.writeFileSync(token, crypto.randomBytes(32).toString('base64url'), { mode: 0o600 });
if (process.platform === 'win32') {
  const who = spawnSync('whoami.exe', ['/user'], { encoding: 'utf8', windowsHide: true });
  const sid = who.stdout?.match(/S-1-5-(?:\d+-)*\d+/)?.[0];
  if (!sid) throw new Error('Cannot resolve Windows SID to protect .rdc.');
  const result = spawnSync('icacls.exe', [data, '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '/inheritance:r', '/Q'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Cannot protect .rdc ACL. Check filesystem support and local permissions.');
  // Restrict the parent, then inherit its restricted ACL on every child.
  // Removing inheritance recursively would leave files with empty ACLs.
  const children = spawnSync('icacls.exe', [path.join(data, '*'), '/reset', '/T', '/Q'], { encoding: 'utf8', windowsHide: true });
  if (children.status !== 0) throw new Error('Cannot apply private-directory inheritance.');
  fs.readFileSync(configPath, 'utf8');
  fs.readFileSync(token, 'utf8');
} else fs.chmodSync(data, 0o700);
const welcome = path.join(base, 'workspace', 'WELCOME.txt');
if (!fs.existsSync(welcome)) fs.writeFileSync(welcome, 'RDC-X workspace\nOnly this directory is initially authorized.\nAdd your project folders using the LOCAL dashboard.\n');
console.log('Setup complete. Existing policy and secrets were preserved.');
console.log('No firewall, auto-start, public tunnel or paid service has been enabled.');
