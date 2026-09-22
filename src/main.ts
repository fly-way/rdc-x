import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { RDCX_VERSION } from './version.js';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const app = createApp(base);
  await app.listen();
  console.log(`RDC-X ${RDCX_VERSION} | ${app.state.config.name}`);
  console.log(`OAuth MCP: http://127.0.0.1:${app.state.config.mcpPort}/mcp`);
  console.log(`Dashboard: http://127.0.0.1:${app.state.config.adminPort}`);
  console.log(`Secure Tunnel MCP: http://127.0.0.1:${app.state.config.tunnelPort}/mcp`);
  console.log('Use Start-All.cmd for the normal Windows startup flow.');
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => { void app.stop().then(() => process.exit(0)); });
} catch (error: any) {
  console.error(`Startup failed: ${error.message}`);
  process.exitCode = 1;
}
