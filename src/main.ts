import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const app = createApp(base);
  await app.listen();
  console.log(`RDC-X 0.1.0 | ${app.state.config.name}`);
  console.log(`MCP: http://127.0.0.1:${app.state.config.mcpPort}/mcp (OAuth required)`);
  console.log(`Dashboard: http://127.0.0.1:${app.state.config.adminPort}`);
  console.log(`Secure tunnel MCP: http://127.0.0.1:${app.state.config.tunnelPort}/mcp (${app.state.config.secureTunnelEnabled ? 'enabled' : 'disabled'})`);
  console.log('Use Dashboard.cmd to open the authenticated local dashboard.');
  console.log('No public tunnel is enabled automatically. Secure MCP Tunnel uses outbound-only tunnel-client when you run Start-Secure-Tunnel.cmd.');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.stop().then(() => process.exit(0)); });
} catch (error: any) {
  console.error(`Startup failed: ${error.message}`);
  process.exitCode = 1;
}
