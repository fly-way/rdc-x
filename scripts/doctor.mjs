import fs from 'node:fs';
import path from 'node:path';
import { base, data, getConfig, adminApi } from './common.mjs';
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
  const remote = await fetch(`http://127.0.0.1:${c.mcpPort}/api/state`); check('Admin not exposed on MCP port', remote.status === 404);
  console.log('Endpoint: ' + admin.endpoint);
  console.log(admin.hasPublicUrl ? 'HTTPS origin configured; verify tunnel connectivity separately.' : 'Local-only. ChatGPT linking needs an HTTPS route or a configured Secure MCP Tunnel.');
} catch (e) { check('Runtime checks', false, e.message); }
process.exitCode = failures ? 1 : 0;
