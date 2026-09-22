import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = path.join(base, 'tools');
const target = path.join(toolsDir, process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client');

if (fs.existsSync(target)) {
  console.log('[RDC-X] tunnel-client already installed: ' + target);
  process.exit(0);
}
if (process.platform !== 'win32') {
  throw new Error('Automatic tunnel-client installation is currently implemented for Windows only.');
}

const arch = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : '';
if (!arch) throw new Error('Unsupported Windows architecture: ' + process.arch);

const headers = {
  'User-Agent': 'rdc-x-tunnel-client-installer',
  Accept: 'application/vnd.github+json'
};
console.log('[RDC-X] tunnel-client is missing. Checking the latest official OpenAI release...');
const meta = await fetch('https://api.github.com/repos/openai/tunnel-client/releases/latest', {
  headers,
  signal: AbortSignal.timeout(20000)
});
if (!meta.ok) throw new Error('Could not read OpenAI tunnel-client release metadata: HTTP ' + meta.status);
const release = await meta.json();
const expectedName = `tunnel-client-${release.tag_name}-windows-${arch}.zip`;
const asset = release.assets?.find(item => item.name === expectedName);
if (!asset) throw new Error('No official release asset found for ' + expectedName);
if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) throw new Error('Official asset has no usable SHA-256 digest.');
if (!asset.browser_download_url?.startsWith('https://github.com/openai/tunnel-client/releases/download/')) {
  throw new Error('Unexpected tunnel-client download URL.');
}

console.log('[RDC-X] Downloading official OpenAI ' + expectedName + '...');
const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error('tunnel-client download failed: HTTP ' + response.status);
const bytes = Buffer.from(await response.arrayBuffer());
if (asset.size && bytes.length !== asset.size) throw new Error('Downloaded tunnel-client archive has an unexpected size.');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
if ('sha256:' + sha256 !== asset.digest) throw new Error('tunnel-client SHA-256 verification failed.');

fs.mkdirSync(toolsDir, { recursive: true });
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-x-tunnel-'));
const zipPath = path.join(tempDir, expectedName);
const extractDir = path.join(tempDir, 'extract');
fs.writeFileSync(zipPath, bytes);
fs.mkdirSync(extractDir);

const ps = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
  `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${extractDir.replaceAll("'", "''")}' -Force`
], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
if (ps.status !== 0) throw new Error('Could not extract tunnel-client: ' + String(ps.stderr ?? '').trim());

const candidates = fs.readdirSync(extractDir, { recursive: true })
  .map(item => path.join(extractDir, String(item)))
  .filter(item => path.basename(item).toLowerCase() === 'tunnel-client.exe' && fs.statSync(item).isFile());
if (candidates.length !== 1) throw new Error('Expected exactly one tunnel-client.exe in the official archive.');
fs.copyFileSync(candidates[0], target);
fs.writeFileSync(path.join(toolsDir, 'tunnel-client-release.json'), JSON.stringify({
  version: release.tag_name,
  asset: expectedName,
  sha256,
  source: asset.browser_download_url
}, null, 2));
fs.rmSync(tempDir, { recursive: true, force: true });

const check = spawnSync(target, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
if (check.status !== 0) throw new Error('Installed tunnel-client did not pass its version check.');
console.log('[RDC-X] Installed: ' + target);
console.log(String(check.stdout || check.stderr || '').trim());
