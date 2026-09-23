import { runMcpSelfTest } from './mcp-self-test.js';
import { buildStartupDiagnostics } from './startup-diagnostics.js';

export async function buildDiagnosticsReport(input: {
  paused: boolean;
  secureTunnelEnabled: boolean;
  tunnelLive: boolean;
  tunnelReady: boolean;
  tunnelProcessRunning: boolean;
  mcpPort: number;
  tunnelPort: number;
  adminPort: number;
  authorizationCount: number;
}) {
  const startup = buildStartupDiagnostics(input);
  const mcp = await runMcpSelfTest(input.tunnelPort);

  return {
    ok: startup.ok && mcp.ok,
    startup,
    mcp,
    generatedAt: new Date().toISOString()
  };
}
