import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { base, getConfig } from './common.mjs';

const config = getConfig();
if (!config.secureTunnelEnabled) {
  console.error('Secure MCP Tunnel is disabled. Enable it in the LOCAL RDC-X dashboard first.');
  process.exit(1);
}

const tunnelId = String(process.env.CONTROL_PLANE_TUNNEL_ID || '').trim();
const apiKey = String(process.env.CONTROL_PLANE_API_KEY || '').trim();
if (!/^tunnel_[0-9a-f]{32}$/.test(tunnelId)) {
  console.error('CONTROL_PLANE_TUNNEL_ID is missing or invalid. Expected tunnel_ followed by 32 lowercase hex characters.');
  console.error('Create/inspect it at https://platform.openai.com/settings/organization/tunnels');
  process.exit(1);
}
if (!apiKey) {
  console.error('CONTROL_PLANE_API_KEY is missing. Create a restricted Runtime API key with Tunnels Read + Use.');
  console.error('Runtime API keys: https://platform.openai.com/settings/organization/api-keys');
  process.exit(1);
}

const localUrl = `http://127.0.0.1:${config.tunnelPort}/mcp`;
const healthUrl = `http://127.0.0.1:${config.tunnelPort}/health`;
try {
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const health = await response.json();
  if (!health.enabled) throw new Error('Secure MCP Tunnel listener is disabled.');
} catch (error) {
  console.error('RDC-X Secure MCP Tunnel listener is not ready: ' + error.message);
  console.error('Run Start.cmd first, then enable Secure MCP Tunnel in the local dashboard.');
  process.exit(1);
}

const configured = process.env.TUNNEL_CLIENT_PATH?.trim();
const bundled = path.join(base, 'tools', process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client');
const executable = configured || (fs.existsSync(bundled) ? bundled : 'tunnel-client');

console.log('Starting OpenAI Secure MCP Tunnel for RDC-X.');
console.log('Local MCP target: ' + localUrl);
console.log('Tunnel ID: ' + tunnelId);
console.log('The runtime API key is read from CONTROL_PLANE_API_KEY and is never printed or stored by RDC-X.');
console.log('Keep this window open. Ctrl+C stops the tunnel runtime.');

const args = [
  'run',
  `--control-plane.tunnel-id=${tunnelId}`,
  '--control-plane.api-key=env:CONTROL_PLANE_API_KEY',
  `--mcp.server-url=${localUrl}`,
  '--health.listen-addr=127.0.0.1:47834',
  '--open-web-ui',
  '--log.level=info',
  '--log.format=struct-text'
];

const child = spawn(executable, args, {
  cwd: base,
  stdio: 'inherit',
  env: process.env,
  windowsHide: false
});
child.on('error', error => {
  console.error('Unable to start tunnel-client: ' + error.message);
  console.error('Install/download the official tunnel-client, put it in F:\\rdc_x\\tools\\tunnel-client.exe, add it to PATH, or set TUNNEL_CLIENT_PATH.');
  process.exitCode = 1;
});
child.on('exit', code => {
  process.exitCode = code ?? 1;
});
