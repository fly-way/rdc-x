import http from 'node:http';

export type McpSelfTestResult = {
  ok: boolean;
  endpoint: string;
  checks: Array<{
    id: string;
    ok: boolean;
    detail: string;
  }>;
  generatedAt: string;
};

function requestJson(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += String(chunk));
      res.on('end', () => {
        let body: unknown = data;
        try { body = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

/**
 * Lightweight local diagnostic. This intentionally checks the local listener,
 * not OpenAI connectivity, so failures can be separated from tunnel issues.
 */
export async function runMcpSelfTest(endpoint = 'http://127.0.0.1:47833/health'): Promise<McpSelfTestResult> {
  const checks: McpSelfTestResult['checks'] = [];

  try {
    const result = await requestJson(endpoint);
    checks.push({
      id: 'mcp_health_endpoint',
      ok: result.status === 200,
      detail: result.status === 200 ? 'Local MCP listener responded' : `HTTP ${result.status}`
    });
  } catch (error) {
    checks.push({
      id: 'mcp_health_endpoint',
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  return {
    ok: checks.every(item => item.ok),
    endpoint,
    checks,
    generatedAt: new Date().toISOString()
  };
}
