import { RDCX_VERSION } from './version.js';

export type StartupDiagnostic = {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
};

/**
 * Shared startup health checklist. Dashboard/API layers can expose this result.
 * Keep checks deterministic and local: no credentials or secrets are returned.
 */
export function buildStartupDiagnostics(input: {
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
  const checks: StartupDiagnostic[] = [
    {
      id: 'rdcx_process',
      name: 'RDC-X backend process',
      ok: true,
      detail: `RDC-X ${RDCX_VERSION} backend loaded`
    },
    {
      id: 'service_state',
      name: 'Remote access service state',
      ok: !input.paused,
      detail: input.paused ? 'Remote access is paused' : 'Service is active'
    },
    {
      id: 'secure_tunnel_config',
      name: 'Secure MCP Tunnel enabled',
      ok: input.secureTunnelEnabled,
      detail: input.secureTunnelEnabled ? 'Enabled' : 'Disabled'
    },
    {
      id: 'tunnel_process',
      name: 'tunnel-client process',
      ok: input.tunnelProcessRunning,
      detail: input.tunnelProcessRunning ? 'Running' : 'Not running'
    },
    {
      id: 'tunnel_live',
      name: 'Tunnel control-plane live',
      ok: input.tunnelLive,
      detail: input.tunnelLive ? 'Live' : 'Offline'
    },
    {
      id: 'tunnel_ready',
      name: 'Secure MCP Tunnel ready',
      ok: input.tunnelReady,
      detail: input.tunnelReady ? 'Ready' : 'Waiting'
    },
    {
      id: 'mcp_listener',
      name: 'MCP listener ports',
      ok: input.mcpPort > 0 && input.tunnelPort > 0 && input.adminPort > 0,
      detail: `MCP ${input.mcpPort}, Tunnel ${input.tunnelPort}, Dashboard ${input.adminPort}`
    },
    {
      id: 'authorization',
      name: 'Authorized clients',
      ok: true,
      detail: `${input.authorizationCount} authorization(s)`
    }
  ];

  return {
    ok: checks.every(check => check.ok),
    checks,
    generatedAt: new Date().toISOString()
  };
}
