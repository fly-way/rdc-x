import { runMcpSelfTest } from './mcp-self-test.js';
import { buildStartupDiagnostics } from './startup-diagnostics.js';

export type DiagnosticStatus = 'ok' | 'error' | 'unknown';

export type DiagnosticCheck = {
  id: string;
  name: string;
  status: DiagnosticStatus;
  detail: string;
  statusCode?: number;
};

export type DiagnosticLayer = {
  id: 'rdcx' | 'tunnel' | 'mcp' | 'openai_upstream';
  name: string;
  status: DiagnosticStatus;
  detail: string;
};

export type McpRequestRecord = {
  time: string;
  listener: 'oauth' | 'tunnel';
  request: string;
  statusCode: number;
  error: string | null;
  durationMs: number;
};

export class McpRequestHistory {
  private readonly entries: McpRequestRecord[] = [];

  constructor(private readonly limit = 25) {}

  add(record: McpRequestRecord) {
    this.entries.push({ ...record, error: record.error?.slice(0, 240) ?? null });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  list() {
    return this.entries.slice().reverse();
  }
}

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

export type DiagnosticsReport = {
  ok: boolean;
  status: 'healthy' | 'degraded';
  checks: DiagnosticCheck[];
  layers: DiagnosticLayer[];
  recentRequests: McpRequestRecord[];
  metrics: {
    authorizationCount: number;
    toolCount: number;
  };
  generatedAt: string;
};

const asCheck = (check: {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
  statusCode?: number;
}): DiagnosticCheck => {
  const { ok, ...detail } = check;
  return { ...detail, status: ok ? 'ok' : 'error' };
};

export async function buildDiagnosticsReport(input: RuntimeDiagnosticsInput, options: {
  probeToken: string;
  recentRequests?: McpRequestRecord[];
}): Promise<DiagnosticsReport> {
  const startup = buildStartupDiagnostics(input);
  const backend = startup.checks.find(check => check.id === 'rdcx_process');
  const selfTest = await runMcpSelfTest({ port: input.tunnelPort, probeToken: options.probeToken });
  const mcpChecks = Object.fromEntries(selfTest.checks.map(check => [check.id, check]));
  const tunnelClientOk = input.tunnelProcessRunning || input.tunnelLive;

  const checks: DiagnosticCheck[] = [
    {
      id: 'rdcx_backend',
      name: 'RDC-X Backend',
      status: 'ok',
      detail: `${backend?.detail ?? 'Backend loaded'}${input.paused ? ' · remote access paused' : ''}`
    },
    {
      id: 'dashboard_api',
      name: 'Dashboard API',
      status: 'ok',
      detail: `Authenticated API available on 127.0.0.1:${input.adminPort}`
    },
    asCheck(mcpChecks.mcp_listener ?? {
      id: 'mcp_listener', name: 'MCP Listener', ok: false, detail: 'MCP listener check did not run'
    }),
    {
      id: 'tunnel_client',
      name: 'Tunnel Client',
      status: tunnelClientOk ? 'ok' : 'error',
      detail: input.tunnelProcessRunning
        ? 'Managed tunnel-client process is running'
        : input.tunnelLive
          ? 'A tunnel-client is responding on the local health port'
          : input.tunnelLastError || 'tunnel-client is not running'
    },
    {
      id: 'secure_tunnel',
      name: 'Secure Tunnel',
      status: input.secureTunnelEnabled && input.tunnelReady ? 'ok' : 'error',
      detail: !input.secureTunnelEnabled
        ? 'Secure MCP Tunnel is disabled'
        : input.tunnelReady
          ? 'OpenAI control plane reports Ready'
          : input.tunnelLive
            ? 'tunnel-client is live but the control plane is not Ready'
            : input.tunnelLastError || 'Tunnel health endpoint is offline'
    },
    asCheck(mcpChecks.mcp_initialize ?? {
      id: 'mcp_initialize', name: 'MCP Initialize', ok: false, detail: 'Initialize check did not run'
    }),
    asCheck(mcpChecks.tools_list ?? {
      id: 'tools_list', name: 'Tools/List', ok: false, detail: 'Tools/List check did not run'
    })
  ];

  const check = (id: string) => checks.find(item => item.id === id)?.status === 'ok';
  const rdcxOk = check('rdcx_backend') && check('dashboard_api');
  const tunnelOk = tunnelClientOk && input.tunnelLive;
  const mcpOk = check('mcp_listener') && check('mcp_initialize') && check('tools_list');

  const layers: DiagnosticLayer[] = [
    {
      id: 'rdcx',
      name: 'RDC-X',
      status: rdcxOk ? 'ok' : 'error',
      detail: rdcxOk ? 'Backend and Dashboard API are responding' : 'Backend or Dashboard API failed'
    },
    {
      id: 'tunnel',
      name: 'Tunnel',
      status: tunnelOk ? 'ok' : 'error',
      detail: tunnelOk ? 'tunnel-client is running and locally healthy' : 'tunnel-client is not locally healthy'
    },
    {
      id: 'mcp',
      name: 'MCP',
      status: mcpOk ? 'ok' : 'error',
      detail: mcpOk ? 'Health, initialize and tools/list passed' : 'A local MCP self-test failed'
    },
    {
      id: 'openai_upstream',
      name: 'OpenAI upstream',
      status: input.tunnelReady ? 'ok' : 'error',
      detail: input.tunnelReady
        ? 'Secure MCP Tunnel reports Ready'
        : input.tunnelLive
          ? 'Local tunnel is healthy, but the OpenAI control plane is not Ready'
          : 'Upstream cannot be reached until the local tunnel is healthy'
    }
  ];

  const ok = checks.every(item => item.status === 'ok');
  return {
    ok,
    status: ok ? 'healthy' : 'degraded',
    checks,
    layers,
    recentRequests: options.recentRequests ?? [],
    metrics: {
      authorizationCount: input.authorizationCount,
      toolCount: selfTest.toolCount
    },
    generatedAt: new Date().toISOString()
  };
}
