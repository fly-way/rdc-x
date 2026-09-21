import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { base, getConfig, adminApi } from './common.mjs';
try { await adminApi('/state'); } catch { console.error('Run Start.cmd before starting the tunnel.'); process.exit(1); }
const c = getConfig();
const bundled = path.join(base, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const executable = fs.existsSync(bundled) ? bundled : 'cloudflared';
console.log('Starting a PUBLIC, temporary HTTPS tunnel to the OAuth-protected MCP port only.');
console.log('The local dashboard is NOT forwarded. Keep this window open; Ctrl+C closes the tunnel.');
const child = spawn(executable, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${c.mcpPort}`, '--protocol', 'http2'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let configured = false; let tail = ''; let setup = Promise.resolve();
const output = chunk => {
  const line = chunk.toString(); process.stdout.write(line); tail = (tail + line).slice(-16000);
  const match = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !configured) {
    configured = true;
    setup = adminApi('/config', { publicUrl: match[0] }).then(() => console.log(`\nChatGPT MCP URL: ${match[0]}/mcp\nAuthentication: OAuth\nApprove the matching pairing code in the LOCAL dashboard.`)).catch(e => console.error('Could not update public URL: ' + e.message));
  }
};
child.stdout.on('data', output); child.stderr.on('data', output);
child.on('error', e => { console.error('cloudflared not found or failed: ' + e.message + '\nInstall using: winget install --id Cloudflare.cloudflared --exact'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('close', async code => {
  await setup;
  if (configured) { try { await adminApi('/config', { publicUrl: `http://127.0.0.1:${c.mcpPort}` }); } catch {} }
  console.log('Tunnel closed. Old authorizations are revoked when the service is reachable.'); process.exitCode = code && code !== 130 ? 1 : 0;
});
