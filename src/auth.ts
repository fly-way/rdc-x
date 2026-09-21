import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { random, digest, sameSecret, writeJson, type State } from './state.js';

type Client = { client_id: string; client_name: string; redirect_uris: string[]; token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic'; secretHash?: string };
type Grant = { clientId: string; grantId: string; scopes: string[]; resource: string; expiresAt: number };
type Pair = { id: string; pin: string; client: Client; redirect: string; challenge: string; state: string; scopes: string[]; resource: string; expiresAt: number; status: 'pending' | 'approved' | 'rejected'; code?: string };
type Code = { clientId: string; redirect: string; challenge: string; scopes: string[]; resource: string; expiresAt: number };
export const scopeNames = ['rdc.read', 'rdc.write', 'rdc.exec'];
const esc = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
class OAuthError extends Error { constructor(readonly code: string, message: string) { super(message); } }
export class Auth {
  clients = new Map<string, Client>();
  access = new Map<string, Grant>();
  refresh = new Map<string, Grant>();
  usedRefresh = new Map<string, { grantId: string; expiresAt: number }>();
  pairs = new Map<string, Pair>();
  codes = new Map<string, Code>();
  file: string;
  constructor(private state: State) {
    this.file = path.join(state.dataDir, 'oauth.json');
    if (fs.existsSync(this.file)) {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.clients = new Map(value.clients ?? []); this.access = new Map(value.access ?? []);
      this.refresh = new Map(value.refresh ?? []); this.usedRefresh = new Map(value.usedRefresh ?? []);
    }
    this.prune();
  }
  get origin() { return new URL(this.state.config.publicUrl).origin; }
  get resource() { return `${this.origin}/mcp`; }
  prune() {
    for (const map of [this.access, this.refresh, this.usedRefresh, this.codes, this.pairs]) {
      for (const [key, item] of map) if (item.expiresAt < Date.now()) map.delete(key);
    }
  }
  save() { this.prune(); writeJson(this.file, { clients: [...this.clients], access: [...this.access], refresh: [...this.refresh], usedRefresh: [...this.usedRefresh] }); }
  verify(token: string): Grant {
    const grant = this.access.get(digest(token));
    if (!grant || grant.expiresAt < Date.now() || grant.resource !== this.resource) throw new Error('Invalid or expired access token.');
    return grant;
  }
  redirectAllowed(value: string) {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === 'https:' && this.state.config.oauthRedirectHosts.includes(url.hostname)) return true;
    return this.state.config.allowLoopbackOAuth && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  }
  private scopes(value: string) {
    const list = value.split(' ').filter(Boolean);
    if (!list.length || list.some(s => !scopeNames.includes(s))) throw new OAuthError('invalid_scope', 'Unsupported scope.');
    return [...new Set(list)];
  }
  private authenticate(req: Request) {
    let id = String(req.body?.client_id ?? ''); let secret = String(req.body?.client_secret ?? '');
    let method = secret ? 'client_secret_post' : 'none';
    if (req.headers.authorization?.startsWith('Basic ')) {
      const pair = Buffer.from(req.headers.authorization.slice(6), 'base64').toString(); const colon = pair.indexOf(':');
      id = decodeURIComponent(pair.slice(0, colon)); secret = decodeURIComponent(pair.slice(colon + 1)); method = 'client_secret_basic';
    }
    const client = this.clients.get(id);
    if (!client || method !== client.token_endpoint_auth_method || (client.secretHash && !sameSecret(digest(secret), client.secretHash)))
      throw new OAuthError('invalid_client', 'Invalid client authentication.');
    return client;
  }
  private issue(clientId: string, scopes: string[], resource: string, grantId = random(16)) {
    this.prune();
    if (this.refresh.size >= 1000 || this.access.size >= 2000) throw new OAuthError('temporarily_unavailable', 'Token capacity reached.');
    const accessToken = random(); const refreshToken = random();
    this.access.set(digest(accessToken), { clientId, scopes, resource, grantId, expiresAt: Date.now() + 3600000 });
    this.refresh.set(digest(refreshToken), { clientId, scopes, resource, grantId, expiresAt: Date.now() + 30 * 86400000 });
    this.save();
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken, scope: scopes.join(' '), resource };
  }
  decide(id: string, approved: boolean) {
    this.prune(); this.state.assertRunning();
    const pair = this.pairs.get(id);
    if (!pair || pair.status !== 'pending') throw new Error('Pairing request is no longer pending.');
    pair.status = approved ? 'approved' : 'rejected';
    if (approved) {
      pair.code = random();
      this.codes.set(digest(pair.code), { clientId: pair.client.client_id, redirect: pair.redirect, challenge: pair.challenge,
        scopes: pair.scopes, resource: pair.resource, expiresAt: Date.now() + 120000 });
    }
    this.state.audit('oauth_pairing', pair.status, { client: pair.client.client_name, redirect: pair.redirect });
  }
  listPairs() { this.prune(); return [...this.pairs.values()].filter(p => p.status === 'pending').map(({ id, pin, client, redirect, scopes, expiresAt }) => ({ id, pin, name: client.client_name, redirect, scopes, expiresAt })); }
  listAuthorizations() {
    this.prune();
    const byGrant = new Map<string, { grantId:string; clientId:string; clientName:string; scopes:string[]; expiresAt:number }>();
    for (const grant of [...this.access.values(), ...this.refresh.values()]) {
      const current = byGrant.get(grant.grantId);
      const item = { grantId: grant.grantId, clientId: grant.clientId, clientName: this.clients.get(grant.clientId)?.client_name ?? 'Unknown client', scopes: grant.scopes, expiresAt: grant.expiresAt };
      if (!current || item.expiresAt > current.expiresAt) byGrant.set(grant.grantId, item);
    }
    return [...byGrant.values()];
  }
  revokeAll() {
    this.access.clear(); this.refresh.clear(); this.usedRefresh.clear(); this.codes.clear(); this.pairs.clear();
    this.save(); this.state.audit('oauth', 'all_tokens_revoked');
  }
  mount(app: Express) {
    const endpoint = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
      try { return handler(req, res); }
      catch (e: any) { return res.status(e.code === 'invalid_client' ? 401 : 400).json({ error: e.code ?? 'invalid_request', error_description: e.message }); }
    };
    const metadata = () => ({ issuer: this.origin, authorization_endpoint: `${this.origin}/authorize`, token_endpoint: `${this.origin}/token`,
      registration_endpoint: `${this.origin}/register`, revocation_endpoint: `${this.origin}/revoke`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'], scopes_supported: scopeNames });
    app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json(metadata()));
    app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => res.json({
      resource: this.resource, authorization_servers: [this.origin], bearer_methods_supported: ['header'], scopes_supported: scopeNames, resource_name: 'RDC-X Personal Computer' }));
    app.post('/register', endpoint((req, res) => {
      this.prune();
      if (this.clients.size >= 100) throw new Error('Client registration capacity reached.');
      const body = z.object({ client_name: z.string().max(100).default('MCP client'), redirect_uris: z.array(z.string().url()).min(1).max(10),
        token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).default('none') }).parse(req.body);
      if (!body.redirect_uris.every(uri => this.redirectAllowed(uri))) throw new OAuthError('invalid_redirect_uri', 'Redirect hostname is not allowed by the owner.');
      const secret = body.token_endpoint_auth_method === 'none' ? undefined : random();
      const client: Client = { ...body, client_id: random(24), ...(secret ? { secretHash: digest(secret) } : {}) };
      this.clients.set(client.client_id, client); this.save();
      const { secretHash, ...publicClient } = client;
      res.status(201).json({ ...publicClient, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000), grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    }));
    app.get('/authorize', endpoint((req, res) => {
      this.state.assertRunning(); this.prune();
      const q = z.object({ response_type: z.literal('code'), client_id: z.string(), redirect_uri: z.string().url(),
        code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256'),
        state: z.string().max(2048).default(''), scope: z.string().default(scopeNames.join(' ')), resource: z.string().default(this.resource) }).parse(req.query);
      const client = this.clients.get(q.client_id);
      if (!client || !client.redirect_uris.includes(q.redirect_uri) || !this.redirectAllowed(q.redirect_uri)) throw new Error('Unknown client or invalid redirect.');
      if (q.resource !== this.resource) throw new OAuthError('invalid_target', 'Invalid resource audience.');
      if (this.pairs.size >= 30) throw new Error('Too many pending pairing requests.');
      const pair: Pair = { id: random(24), pin: String(crypto.randomInt(100000, 1000000)), client, redirect: q.redirect_uri,
        challenge: q.code_challenge, state: q.state, scopes: this.scopes(q.scope), resource: q.resource, expiresAt: Date.now() + 600000, status: 'pending' };
      this.pairs.set(pair.id, pair); res.redirect(303, `/oauth/wait/${pair.id}`);
    }));
    app.get('/oauth/wait/:id', endpoint((req, res) => {
      this.prune(); const pair = this.pairs.get(String(req.params.id));
      if (!pair) return res.status(410).send('Pairing expired. Return to ChatGPT and connect again.');
      if (pair.status !== 'pending') {
        const target = new URL(pair.redirect);
        if (pair.status === 'approved') target.searchParams.set('code', pair.code!); else target.searchParams.set('error', 'access_denied');
        if (pair.state) target.searchParams.set('state', pair.state);
        this.pairs.delete(pair.id); return res.redirect(303, target.href);
      }
      res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="3"><title>RDC-X pairing</title><body><h1>RDC-X \u8fde\u63a5\u6388\u6743</h1><p>\u8bf7\u5728\u6388\u6743\u7535\u8111\u7684\u672c\u673a\u63a7\u5236\u9762\u677f\u4e2d\u6838\u5bf9\u5e76\u6279\u51c6\u8fde\u63a5\u3002</p><h2>${pair.pin}</h2><p>Client: ${esc(pair.client.client_name)}</p><p>Redirect: ${esc(pair.redirect)}</p><p>Scopes: ${esc(pair.scopes.join(', '))}</p><p>Approve only if you initiated this connection. This page will return to ChatGPT automatically.</p></body></html>`);
    }));
    app.post('/token', endpoint((req, res) => {
      const client = this.authenticate(req); const body = req.body ?? {};
      if (body.grant_type === 'authorization_code') {
        const key = digest(String(body.code ?? '')); const code = this.codes.get(key); this.codes.delete(key);
        const verifier = String(body.code_verifier ?? '');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        if (!code || code.expiresAt < Date.now() || code.clientId !== client.client_id || code.redirect !== body.redirect_uri
          || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !sameSecret(challenge, code.challenge)
          || (body.resource !== undefined && body.resource !== code.resource) || code.resource !== this.resource)
          throw new OAuthError('invalid_grant', 'Invalid, expired, reused or mismatched authorization code.');
        this.state.audit('oauth_token', 'issued', { clientId: client.client_id });
        return res.json(this.issue(client.client_id, code.scopes, code.resource));
      }
      if (body.grant_type === 'refresh_token') {
        const key = digest(String(body.refresh_token ?? '')); const token = this.refresh.get(key);
        if (!token) {
          const used = this.usedRefresh.get(key);
          if (used) {
            for (const map of [this.access, this.refresh]) for (const [hash, grant] of map) if (grant.grantId === used.grantId) map.delete(hash);
            this.save();
          }
          throw new OAuthError('invalid_grant', 'Invalid or reused refresh token.');
        }
        if (token.clientId !== client.client_id || token.expiresAt < Date.now() || token.resource !== this.resource || (body.resource && body.resource !== token.resource))
          throw new OAuthError('invalid_grant', 'Refresh token binding mismatch.');
        const scopes = body.scope ? this.scopes(String(body.scope)) : token.scopes;
        if (scopes.some(scope => !token.scopes.includes(scope))) throw new OAuthError('invalid_scope', 'Scopes cannot be expanded.');
        this.refresh.delete(key); this.usedRefresh.set(key, { grantId: token.grantId, expiresAt: token.expiresAt });
        return res.json(this.issue(client.client_id, scopes, token.resource, token.grantId));
      }
      throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
    }));
    app.post('/revoke', endpoint((req, res) => {
      const client = this.authenticate(req); const hash = digest(String(req.body?.token ?? ''));
      const token = this.access.get(hash) ?? this.refresh.get(hash);
      if (token?.clientId === client.client_id) {
        for (const map of [this.access, this.refresh]) for (const [key, grant] of map) if (grant.grantId === token.grantId) map.delete(key);
        this.save();
      }
      res.status(200).end();
    }));
  }
}
