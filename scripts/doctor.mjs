import fs from 'node:fs';
import path from 'node:path';
import { base, data, getConfig, adminApi } from './common.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
let failures = 0;
const check = (name, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); if (!pass) failures++; };
check('Node >=22', Number(process.versions.node.split('.')[0]) >= 22, process.versions.node);
check('Configuration', fs.existsSync(path.join(data, 'config.json')));
check('Compiled server', fs.existsSync(path.join(base, 'dist', 'main.js')));
try {
  const c = getConfig();
  for (const root of c.roots) check('Allowed directory exists', fs.existsSync(root.path), root.path);
  const health = await fetch(`http://127.0.0.1:${c.mcpPort}/health`, { signal: AbortSignal.timeout(3000) });
  check('Local MCP listener', health.ok);
  const rejected = await fetch(`http://127.0.0.1:${c.mcpPort}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('Unauthenticated MCP denied', rejected.status === 401);
  const admin = await adminApi('/state'); check('Local admin authentication', !!admin.config);
  const tunnelHealth = await fetch(`http://127.0.0.1:${c.tunnelPort}/health`, { signal: AbortSignal.timeout(3000) });
  check('Secure MCP Tunnel listener', tunnelHealth.ok, `127.0.0.1:${c.tunnelPort}`);
  const remote = await fetch(`http://127.0.0.1:${c.mcpPort}/api/state`); check('Admin not exposed on MCP port', remote.status === 404);
  const client = new Client({ name: 'rdcx-doctor', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${c.tunnelPort}/mcp`)));
    const toolList = (await client.listTools()).tools;
    check('Native MCP tool count', toolList.length >= 90, String(toolList.length));
    const names = new Set(toolList.map(tool => tool.name));
    for (const name of ['get_capabilities','copy_path','start_process','desktop_screenshot_region','pdf_extract_pages','unity_get_serialized_properties'])
      check('Native tool present', names.has(name), name);
    const processTool = toolList.find(tool => tool.name === 'start_process');
    const processSchema = processTool?.inputSchema ?? {};
    check('Native start_process schema', !!processSchema.properties?.timeoutSeconds && !processSchema.properties?.timeout_ms);
  } finally {
    await client.close().catch(() => {});
  }
  console.log('Endpoint: ' + admin.endpoint);
  console.log(admin.hasPublicUrl ? 'Public HTTPS origin configured.' : 'Public MCP is local-only.');
  console.log(c.secureTunnelEnabled ? `Secure MCP Tunnel target enabled: http://127.0.0.1:${c.tunnelPort}/mcp` : 'Secure MCP Tunnel target is not configured yet. Run Start-All.cmd and enter credentials on the Connections page.');
  if (admin.secureTunnel?.configured) {
    check('Secure MCP Tunnel credentials stored', admin.secureTunnel.hasApiKey && !!admin.secureTunnel.tunnelId);
    console.log('Managed tunnel-client: ' + (admin.secureTunnel.ready ? 'ready' : admin.secureTunnel.live ? 'live, not ready' : 'not running'));
  }
} catch (e) { check('Runtime checks', false, e.message); }
process.exitCode = failures ? 1 : 0;
