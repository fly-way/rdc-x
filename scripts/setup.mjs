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
  const config = { name: os.hostname(), deviceId: crypto.randomUUID(), mcpPort: 47831, adminPort: 47832, tunnelPort: 47833,
    publicUrl: 'http://127.0.0.1:47831', roots: [{ path: path.join(base, 'workspace'), write: true }],
    requireWriteApproval: true, terminalEnabled: true, systemProcessControlEnabled: true, desktopControlEnabled: true,
    networkFetchEnabled: true, secureTunnelEnabled: false, maxFileBytes: 2097152, maxProcessSeconds: 600,
    policyDefaultsApplied: true,
    oauthRedirectHosts: ['chatgpt.com', 'chat.openai.com'], allowLoopbackOAuth: false };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
if (fs.existsSync(configPath)) {
  const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let changed = false;
  for (const [key, value] of Object.entries({ tunnelPort: 47833, secureTunnelEnabled: false })) {
    if (!(key in existing)) { existing[key] = value; changed = true; }
  }

  // One-time default policy: every local capability is enabled by default. After this runs
  // once, the owner's dashboard choices are preserved exactly as they are.
  if (existing.policyDefaultsApplied !== true) {
    for (const [key, value] of Object.entries({
      requireWriteApproval: true, terminalEnabled: true, systemProcessControlEnabled: true,
      desktopControlEnabled: true, networkFetchEnabled: true
    })) existing[key] = value;
    existing.policyDefaultsApplied = true;
    changed = true;
    console.log('Access policy defaults applied: file write approval, terminal, process, desktop and network access are enabled.');
  }

  // If RDC-X was moved/renamed, migrate only the default workspace root from
  // the previous install directory. User-added roots are never silently changed.
  const currentWorkspace = path.join(base, 'workspace');
  const installStem = value => path.basename(path.normalize(value)).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (Array.isArray(existing.roots)) {
    existing.roots = existing.roots.map(root => {
      if (!root || typeof root.path !== 'string' || fs.existsSync(root.path)) return root;
      const oldRoot = path.normalize(root.path);
      const oldParent = path.dirname(oldRoot);
      const looksLikeDefaultWorkspace =
        path.basename(oldRoot).toLowerCase() === 'workspace' &&
        installStem(oldParent) === installStem(base);
      if (!looksLikeDefaultWorkspace) return root;
      changed = true;
      console.log(`Migrating default workspace root: ${root.path} -> ${currentWorkspace}`);
      return { ...root, path: currentWorkspace };
    });
  }

  if (changed) fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
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
