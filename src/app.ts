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

export function createApp(base: string) {
  const state = new State(base); const auth = new Auth(state);
  const files = new FileService(state); const approvals = new Approvals(state);
  const processes = new ProcessService(state, files.guard); const searches = new SearchService(files);
  const documents = new DocumentService(state, files.guard); const system = new SystemService();
  const desktop = new DesktopService(state); const unity = new UnityService(state, files.guard); const network = new NetworkService();
  const services = { state, files, approvals, processes, searches, documents, system, desktop, unity, network };
  const mcp = express(); const admin = express();
  let servers: Server[] = []; let active = 0;
  const mcpPort = state.config.mcpPort; const adminPort = state.config.adminPort;
  for (const app of [mcp, admin]) {
    app.disable('x-powered-by');
    app.use((_req, res, next) => {
      res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" }); next();
    });
  }
  // Do not trust forwarded headers. The two ports are always bound to loopback.
  mcp.use((req, res, next) => {
    const hosts = [new URL(state.config.publicUrl).host, `127.0.0.1:${mcpPort}`, `localhost:${mcpPort}`];
    if (!req.headers.host || !hosts.includes(req.headers.host)) return res.status(403).json({ error: 'Untrusted Host header.' });
    const origin = req.headers.origin;
    if (origin && ![auth.origin, 'https://chatgpt.com', 'https://chat.openai.com'].includes(origin)) return res.status(403).json({ error: 'Untrusted Origin.' });
    if (origin) res.set({ 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id', 'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Session-Id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  let windowStart = Date.now(); let requests = 0;
  mcp.use((_req, res, next) => {
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); requests = 0; }
    if (++requests > 600) return res.status(429).set('Retry-After', '60').json({ error: 'Request rate limit exceeded.' });
    next();
  });
  mcp.use(express.json({ limit: '6mb' }), express.urlencoded({ extended: false, limit: '32kb' }));
  mcp.get('/health', (_req, res) => res.json({ name: 'RDC-X', version: '0.2.0', status: state.paused ? 'paused' : 'running' }));
  auth.mount(mcp);
  mcp.all('/mcp', async (req, res) => {
    let grant;
    try {
      const header = req.headers.authorization ?? '';
      if (!header.startsWith('Bearer ')) throw new Error('Missing bearer token.');
      grant = auth.verify(header.slice(7));
    } catch {
      return res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${auth.origin}/.well-known/oauth-protected-resource/mcp", scope="rdc.read rdc.write rdc.exec"`).json({ error: 'unauthorized' });
    }
    if (state.paused) return res.status(503).json({ error: 'Remote access is paused.' });
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();
    if (active >= 12) return res.status(429).json({ error: 'Too many concurrent MCP requests.' });
    active++;
    const server = createMcp(services, grant.grantId, grant.scopes);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e: any) {
      state.audit('mcp_transport', 'failed', { error: String(e.message).slice(0, 300) });
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
    } finally {
      active--;
      await transport.close().catch(() => {}); await server.close().catch(() => {});
    }
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
    if (typeof token !== 'string' || !sameSecret(token, state.adminToken)) return res.status(401).json({ error: 'Local admin key required. Open Dashboard.cmd on this computer.' });
    next();
  });
  admin.get('/api/state', (_req, res) => res.json({ config: state.publicConfig(), pairings: auth.listPairs(),
    approvals: approvals.list(), sessions: processes.list(), audit: [...state.auditTail].reverse(),
    authorizations: auth.listAuthorizations().map(a => ({ ...a, approvalMode: approvals.mode(a.grantId) })),
    authorizationCount: auth.listAuthorizations().length,
    endpoint: auth.resource, hasPublicUrl: new URL(state.config.publicUrl).protocol === 'https:' }));
  admin.post('/api/pairings/:id', (req, res) => {
    if (typeof req.body?.approve !== 'boolean') throw new Error('approve must be boolean.');
    auth.decide(String(req.params.id), req.body.approve); res.json({ ok: true });
  });
  admin.post('/api/approvals/:id', async (req, res) => {
    if (typeof req.body?.approve !== 'boolean') throw new Error('approve must be boolean.');
    await approvals.decide(String(req.params.id), req.body.approve); res.json({ ok: true });
  });
  admin.post('/api/authorizations/:id/approval-mode', (req, res) => {
    const mode = req.body?.mode;
    if (mode !== 'default' && mode !== 'trusted') throw new Error('mode must be default or trusted.');
    const id = String(req.params.id);
    if (!auth.listAuthorizations().some(a => a.grantId === id)) throw new Error('Authorization not found.');
    res.json(approvals.setMode(id, mode));
  });
  admin.post('/api/config', async (req, res) => {
    const next = { ...state.config, ...req.body, deviceId: state.config.deviceId, mcpPort, adminPort };
    const oldOrigin = auth.origin;
    state.saveConfig(next); approvals.cancelAll();
    if (auth.origin !== oldOrigin) { auth.revokeAll(); approvals.resetSessionTrust(); }
    if (!state.config.terminalEnabled) await processes.stopAll();
    res.json({ ok: true });
  });
  admin.post('/api/pause', async (req, res) => {
    if (typeof req.body?.paused !== 'boolean') throw new Error('paused must be boolean.');
    state.paused = req.body.paused;
    if (state.paused) { approvals.cancelAll(); searches.stopAll(); await processes.stopAll(); }
    state.audit('remote_access', state.paused ? 'paused' : 'resumed'); res.json({ ok: true, paused: state.paused });
  });
  admin.post('/api/revoke', async (_req, res) => {
    approvals.cancelAll(); approvals.resetSessionTrust(); searches.stopAll(); await processes.stopAll(); auth.revokeAll(); res.json({ ok: true });
  });
  admin.post('/api/clients/reset', async (_req, res) => {
    approvals.cancelAll(); approvals.resetSessionTrust(); searches.stopAll(); await processes.stopAll(); auth.revokeAll(); auth.clients.clear(); auth.save(); res.json({ ok: true });
  });
  admin.post('/api/sessions/:id/stop', async (req, res) => {
    const item = processes.sessions.get(String(req.params.id)); if (!item) throw new Error('Session not found.');
    await processes.stop(item.id, item.owner); res.json({ ok: true });
  });
  admin.post('/api/shutdown', (_req, res) => { res.json({ ok: true }); setTimeout(() => { void stop(); }, 100).unref(); });
  admin.use(express.static(path.join(base, 'public'), { dotfiles: 'deny', etag: false }));
  for (const app of [mcp, admin]) {
    app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
    app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
      if (!res.headersSent) res.status(error.status ?? 400).json({ error: String(error.message).slice(0, 500) });
    });
  }
  async function stop() {
    state.paused = true; approvals.cancelAll(); searches.stopAll(); await processes.stopAll();
    await Promise.all(servers.map(s => new Promise<void>(resolve => { s.close(() => resolve()); s.closeAllConnections(); })));
    servers = []; state.audit('server', 'stopped');
  }
  return { ...services, auth, mcp, admin, stop, async listen() {
    const listen = (app: express.Express, port: number) => new Promise<Server>((resolve, reject) => {
      const server = app.listen(port, '127.0.0.1', () => resolve(server)); server.on('error', reject);
      server.requestTimeout = 30000; server.headersTimeout = 10000;
    });
    try { servers.push(await listen(mcp, mcpPort)); servers.push(await listen(admin, adminPort)); }
    catch (error) { await stop(); throw error; }
    state.audit('server', 'started'); return servers;
  } };
}
