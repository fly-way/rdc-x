import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type McpSelfTestCheck = {
  id: 'mcp_listener' | 'mcp_initialize' | 'tools_list';
  name: string;
  ok: boolean;
  detail: string;
  statusCode?: number;
};

export type McpSelfTestResult = {
  ok: boolean;
  endpoint: string;
  checks: McpSelfTestCheck[];
  toolCount: number;
  generatedAt: string;
};

function errorDetail(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}

function errorStatus(error: unknown) {
  return error instanceof StreamableHTTPError && typeof error.code === 'number' && error.code > 0
    ? error.code
    : undefined;
}

/**
 * Exercises the same stateless Streamable HTTP endpoint used by tunnel-client.
 * The private probe header lets app.ts omit these synthetic requests from the
 * recent ChatGPT request history; it does not grant access to any endpoint.
 */
export async function runMcpSelfTest(options: {
  port: number;
  probeToken: string;
  timeoutMs?: number;
}): Promise<McpSelfTestResult> {
  const endpoint = `http://127.0.0.1:${options.port}`;
  const timeoutMs = options.timeoutMs ?? 2000;
  const headers = { 'X-RDC-Diagnostics-Probe': options.probeToken };
  const checks: McpSelfTestCheck[] = [];
  let toolCount = 0;

  try {
    const response = await fetch(endpoint + '/health', {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    checks.push({
      id: 'mcp_listener',
      name: 'MCP Listener',
      ok: response.ok,
      statusCode: response.status,
      detail: response.ok ? `Listening on 127.0.0.1:${options.port}` : `Health check returned HTTP ${response.status}`
    });
    await response.body?.cancel();
  } catch (error) {
    checks.push({
      id: 'mcp_listener',
      name: 'MCP Listener',
      ok: false,
      detail: errorDetail(error)
    });
  }

  const transport = new StreamableHTTPClientTransport(new URL(endpoint + '/mcp'), {
    requestInit: {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    }
  });
  const client = new Client({ name: 'rdcx-diagnostics', version: '1' });
  let initialized = false;

  try {
    await client.connect(transport);
    initialized = true;
    checks.push({
      id: 'mcp_initialize',
      name: 'MCP Initialize',
      ok: true,
      detail: 'MCP initialize completed'
    });

    const tools = (await client.listTools()).tools;
    toolCount = tools.length;
    checks.push({
      id: 'tools_list',
      name: 'Tools/List',
      ok: tools.length > 0,
      detail: tools.length > 0 ? `${tools.length} tools available` : 'MCP returned an empty tool list'
    });
  } catch (error) {
    const detail = errorDetail(error);
    const statusCode = errorStatus(error);
    if (!initialized) {
      checks.push({
        id: 'mcp_initialize',
        name: 'MCP Initialize',
        ok: false,
        detail,
        ...(statusCode ? { statusCode } : {})
      });
    }
    checks.push({
      id: 'tools_list',
      name: 'Tools/List',
      ok: false,
      detail: initialized ? detail : 'Skipped because MCP initialize failed',
      ...(initialized && statusCode ? { statusCode } : {})
    });
  } finally {
    await client.close().catch(() => {});
  }

  return {
    ok: checks.every(check => check.ok),
    endpoint: endpoint + '/mcp',
    checks,
    toolCount,
    generatedAt: new Date().toISOString()
  };
}
