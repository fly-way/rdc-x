import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import type { Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { State, sameSecret } from './state.js';
import { FileService } from './files.js';
import { Approvals } from './approvals.js';
import { ProcessService } from './processes.js';
import { SearchService } from './search.js';
import { Auth } from './auth.js';
import { DocumentService } from './documents.js';
import { SystemService } from './system.js';
import { DesktopService } from './desktop.js';
import { UnityService } from './unity.js';
import { NetworkService } from './network.js';
import { createMcp } from './tools.js';
import { TunnelRuntime } from './tunnel-runtime.js';

const SECURE_TUNNEL_OWNER = 'secure-mcp-tunnel';
const FULL_SCOPES = ['rdc.read', 'rdc.write', 'rdc.exec'];

export function createApp(base: string) {
  const state = new State(base); const auth = new Auth(state);
  const files = new FileService(state); const approvals = new Approvals(state);
  const processes = new ProcessService(state, files.guard); const searches = new SearchService(files);
  const documents = new DocumentService(state, files.guard); const system = new SystemService();
  const desktop = new DesktopService(state); const unity = new UnityService(state, files.guard); const network = new NetworkService();
  const services = { state, files, approvals, processes, searches, documents, system, desktop, unity, network };
  const tunnelRuntime = new TunnelRuntime(state, base);
  const mcp = express(); const admin = express(); const tunnelMcp = express();
  let servers: Server[] = []; let active = 0;
  const mcpPort = state.config.mcpPort; const adminPort = state.config.adminPort; const tunnelPort = state.config.tunnelPort;

  for (const app of [mcp, admin, tunnelMcp]) {
    app.disable('x-powered-by');
    app.use((_req, res, next) => {
      res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
      });
      next();
    });
  }

  // Public/OAuth MCP listener. It is still loopback-bound; a reverse proxy may forward it.
  mcp.use((req, res, next) => {
    const hosts = [new URL(state.config.publicUrl).host, `127.0.0.1:${mcpPort}`, `localhost:${mcpPort}`];
    if (!req.headers.host || !hosts.includes(req.headers.host)) return res.status(403).json({ error: 'Untrusted Host header.' });
    const origin = req.headers.origin;
    if (origin && ![auth.origin, 'https://chatgpt.com', 'https://chat.openai.com'].includes(origin)) return res.status(403).json({ error: 'Untrusted Origin.' });
    if (origin) res.set({
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
      'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Session-Id',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Dedicated Secure MCP Tunnel listener. This port is loopback-only and must never be exposed by Cloudflare/reverse proxies.
  tunnelMcp.use((req, res, next) => {
    const hosts = [`127.0.0.1:${tunnelPort}`, `localhost:${tunnelPort}`];
    if (!req.headers.host || !hosts.includes(req.headers.host)) return res.status(403).json({ error: 'Secure tunnel listener is loopback-only.' });
    if (req.headers.origin && ![`http://127.0.0.1:${tunnelPort}`, `http://localhost:${tunnelPort}`].includes(req.headers.origin))
      return res.status(403).json({ error: 'Secure tunnel listener rejects browser origins.' });
    next();
  });

  let windowStart = Date.now(); let requests = 0;
  const rateLimit = (_req: Request, res: Response, next: NextFunction) => {
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); requests = 0; }
    if (++requests > 900) return res.status(429).set('Retry-After', '60').json({ error: 'Request rate limit exceeded.' });
    next();
  };
  mcp.use(rateLimit); tunnelMcp.use(rateLimit);

  mcp.use(express.json({ limit: '6mb' }), express.urlencoded({ extended: false, limit: '32kb' }));
  tunnelMcp.use(express.json({ limit: '6mb' }));

  async function handleMcp(req: Request, res: Response, owner: string, scopes: string[], authMode: 'oauth' | 'tunnel') {
    if (state.paused) return res.status(503).json({ error: 'Remote access is paused.' });
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();
    if (active >= 12) return res.status(429).json({ error: 'Too many concurrent MCP requests.' });
    active++;
    const server = createMcp(services, owner, scopes, authMode);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e: any) {
      state.audit(authMode === 'tunnel' ? 'secure_tunnel_mcp_transport' : 'mcp_transport', 'failed', { error: String(e.message).slice(0, 300) }, owner);
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
    } finally {
      active--;
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  }

  mcp.get('/health', (_req, res) => res.json({ name: 'RDC-X', version: '0.2.0', status: state.paused ? 'paused' : 'running' }));
  auth.mount(mcp);
  mcp.all('/mcp', async (req, res) => {
    let grant;
    try {
      const header = req.headers.authorization ?? '';
      if (!header.startsWith('Bearer ')) throw new Error('Missing bearer token.');
      grant = auth.verify(header.slice(7));
    } catch {
      return res.status(401)
        .set('WWW-Authenticate', `Bearer resource_metadata="${auth.origin}/.well-known/oauth-protected-resource/mcp", scope="rdc.read rdc.write rdc.exec"`)
        .json({ error: 'unauthorized' });
    }
    return handleMcp(req, res, grant.grantId, grant.scopes, 'oauth');
  });

  tunnelMcp.get('/health', (_req, res) => res.json({
    name: 'RDC-X Secure MCP Tunnel listener',
    version: '0.2.0',
    enabled: state.config.secureTunnelEnabled,
    status: state.paused ? 'paused' : 'running'
  }));
  tunnelMcp.all('/mcp', async (req, res) => {
    if (!state.config.secureTunnelEnabled) {
      return res.status(503).json({ error: 'Secure MCP Tunnel listener is disabled in the local dashboard.' });
    }
    return handleMcp(req, res, SECURE_TUNNEL_OWNER, FULL_SCOPES, 'tunnel');
  });

  admin.use((req, res, next) => {
    const allowedHosts = [`127.0.0.1:${adminPort}`, `localhost:${adminPort}`];
    const origin = req.headers.origin;
    if (!req.headers.host || !allowedHosts.includes(req.headers.host) || (origin && !allowedHosts.map(h => `http://${h}`).includes(origin)))
      return res.status(403).json({ error: 'Local dashboard origin required.' });
    next();
  });
  admin.use(express.json({ limit: '256kb' }));
  admin.use('/api', (req, res, next) => {
    const token = req.headers['x-rdc-admin'];
    if (typeof token !== 'string' || !sameSecret(token, state.adminToken))
      return res.status(401).json({ error: 'Local admin key required. Run Start-All.cmd on this computer.' });
    next();
  });
  admin.get('/api/state', async (_req, res) => {
    const runtime = await tunnelRuntime.status();
    res.json({
      config: state.publicConfig(),
      pairings: auth.listPairs(),
      approvals: approvals.list(),
      sessions: processes.list(),
      audit: [...state.auditTail].reverse(),
      authorizations: auth.listAuthorizations().map(a => ({ ...a, approvalMode: approvals.mode(a.grantId) })),
      authorizationCount: auth.listAuthorizations().length,
      endpoint: auth.resource,
      hasPublicUrl: new URL(state.config.publicUrl).protocol === 'https:',
      secureTunnel: {
        ...runtime,
        enabled: state.config.secureTunnelEnabled,
        port: tunnelPort,
        approvalMode: approvals.mode(SECURE_TUNNEL_OWNER)
      }
    });
  });
  admin.post('/api/pairings/:id', (req, res) => {
    if (typeof req.body?.approve !== 'boolean') throw new Error('approve must be boolean.');
    auth.decide(String(req.params.id), req.body.approve);
    res.json({ ok: true });
  });
  admin.post('/api/approvals/:id', async (req, res) => {
    if (typeof req.body?.approve !== 'boolean') throw new Error('approve must be boolean.');
    await approvals.decide(String(req.params.id), req.body.approve);
    res.json({ ok: true });
  });
  admin.post('/api/authorizations/:id/approval-mode', (req, res) => {
    const mode = req.body?.mode;
    if (mode !== 'default' && mode !== 'trusted') throw new Error('mode must be default or trusted.');
    const id = String(req.params.id);
    if (!auth.listAuthorizations().some(a => a.grantId === id)) throw new Error('Authorization not found.');
    res.json(approvals.setMode(id, mode));
  });
  admin.post('/api/tunnel/approval-mode', (req, res) => {
    const mode = req.body?.mode;
    if (mode !== 'default' && mode !== 'trusted') throw new Error('mode must be default or trusted.');
    res.json(approvals.setMode(SECURE_TUNNEL_OWNER, mode));
  });
  admin.post('/api/tunnel/configure', async (req, res) => {
    const tunnelId = typeof req.body?.tunnelId === 'string' ? req.body.tunnelId : '';
    const runtimeApiKey = typeof req.body?.runtimeApiKey === 'string' ? req.body.runtimeApiKey : undefined;
    res.json(await tunnelRuntime.configure(tunnelId, runtimeApiKey));
  });
  admin.post('/api/tunnel/start', async (_req, res) => {
    res.json(await tunnelRuntime.start());
  });
  admin.post('/api/tunnel/stop', async (_req, res) => {
    res.json(await tunnelRuntime.stop());
  });
  admin.post('/api/tunnel/forget-key', async (_req, res) => {
    res.json(await tunnelRuntime.forgetKey());
  });
  admin.post('/api/config', async (req, res) => {
    const next = {
      ...state.config,
      ...req.body,
      deviceId: state.config.deviceId,
      mcpPort,
      adminPort,
      tunnelPort
    };
    const oldOrigin = auth.origin;
    state.saveConfig(next);
    approvals.cancelAll();
    if (auth.origin !== oldOrigin) {
      auth.revokeAll();
      approvals.resetSessionTrust();
    }
    if (!state.config.terminalEnabled) await processes.stopAll();
    res.json({ ok: true });
  });
  admin.post('/api/pause', async (req, res) => {
    if (typeof req.body?.paused !== 'boolean') throw new Error('paused must be boolean.');
    state.paused = req.body.paused;
    if (state.paused) {
      approvals.cancelAll();
      searches.stopAll();
      await processes.stopAll();
    }
    state.audit('remote_access', state.paused ? 'paused' : 'resumed');
    res.json({ ok: true, paused: state.paused });
  });
  admin.post('/api/revoke', async (_req, res) => {
    approvals.cancelAll();
    approvals.resetSessionTrust();
    searches.stopAll();
    await processes.stopAll();
    auth.revokeAll();
    res.json({ ok: true });
  });
  admin.post('/api/clients/reset', async (_req, res) => {
    approvals.cancelAll();
    approvals.resetSessionTrust();
    searches.stopAll();
    await processes.stopAll();
    auth.revokeAll();
    auth.clients.clear();
    auth.save();
    res.json({ ok: true });
  });
  admin.post('/api/sessions/:id/stop', async (req, res) => {
    const item = processes.sessions.get(String(req.params.id));
    if (!item) throw new Error('Session not found.');
    await processes.stop(item.id, item.owner);
    res.json({ ok: true });
  });
  admin.post('/api/shutdown', (_req, res) => {
    res.json({ ok: true });
    setTimeout(() => { void stop(); }, 100).unref();
  });

  admin.use(express.static(path.join(base, 'public'), { dotfiles: 'deny', etag: false }));
  for (const app of [mcp, admin, tunnelMcp]) {
    app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
    app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
      if (!res.headersSent) res.status(error.status ?? 400).json({ error: String(error.message).slice(0, 500) });
    });
  }

  async function stop() {
    state.paused = true;
    approvals.cancelAll();
    searches.stopAll();
    await processes.stopAll();
    await tunnelRuntime.stop();
    await Promise.all(servers.map(s => new Promise<void>(resolve => {
      s.close(() => resolve());
      s.closeAllConnections();
    })));
    servers = [];
    state.audit('server', 'stopped');
  }

  return {
    ...services,
    auth,
    mcp,
    admin,
    tunnelMcp,
    tunnelRuntime,
    stop,
    async listen() {
      const listen = (app: express.Express, port: number) => new Promise<Server>((resolve, reject) => {
        const server = app.listen(port, '127.0.0.1', () => resolve(server));
        server.on('error', reject);
        server.requestTimeout = 30000;
        server.headersTimeout = 10000;
      });
      try {
        servers.push(await listen(mcp, mcpPort));
        servers.push(await listen(admin, adminPort));
        servers.push(await listen(tunnelMcp, tunnelPort));
      } catch (error) {
        await stop();
        throw error;
      }
      state.audit('server', 'started', { mcpPort, adminPort, tunnelPort });
      void tunnelRuntime.autoStart().catch(error => state.audit('secure_tunnel_runtime', 'failed', { error: String(error?.message ?? error).slice(0, 500) }));
      return servers;
    }
  };
}
