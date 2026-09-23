import { buildStartupDiagnostics } from './startup-diagnostics.js';

export type RuntimeDiagnosticsInput = {
  paused: boolean;
  secureTunnelEnabled: boolean;
  tunnelLive: boolean;
  tunnelReady: boolean;
  tunnelProcessRunning: boolean;
  tunnelLastError?: string | null;
  mcpPort: number;
  tunnelPort: number;
  adminPort: number;
  authorizationCount: number;
};

export function buildRuntimeDiagnostics(input: RuntimeDiagnosticsInput) {
  const startup = buildStartupDiagnostics(input);

  return {
    ...startup,
    tunnel: {
      live: input.tunnelLive,
      ready: input.tunnelReady,
      processRunning: input.tunnelProcessRunning,
      lastError: input.tunnelLastError ?? null
    },
    recommendation: startup.ok
      ? 'RDC-X local runtime checks passed.'
      : 'Check failed components before debugging ChatGPT MCP connectivity.'
  };
}
