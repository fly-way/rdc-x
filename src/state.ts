import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { z } from 'zod';

export const configSchema = z.object({
  name: z.string().min(1).max(80).default(os.hostname()),
  deviceId: z.string().uuid(),
  mcpPort: z.number().int().min(1024).max(65535).default(47831),
  adminPort: z.number().int().min(1024).max(65535).default(47832),
  tunnelPort: z.number().int().min(1024).max(65535).default(47833),
  publicUrl: z.string().url().default('http://127.0.0.1:47831'),
  roots: z.array(z.object({ path: z.string().min(1), write: z.boolean() })).max(20),
  requireWriteApproval: z.boolean().default(true),
  terminalEnabled: z.boolean().default(false),
  systemProcessControlEnabled: z.boolean().default(false),
  desktopControlEnabled: z.boolean().default(false),
  networkFetchEnabled: z.boolean().default(false),
  secureTunnelEnabled: z.boolean().default(false),
  commandPolicyMode: z.enum(['off','blocklist','allowlist']).default('blocklist'),
  blockedCommandPatterns: z.array(z.string().min(1).max(300)).max(100).default([]),
  allowedCommandPatterns: z.array(z.string().min(1).max(300)).max(100).default([]),
  maxFileBytes: z.number().int().min(1024).max(8 * 1024 * 1024).default(2 * 1024 * 1024),
  maxProcessSeconds: z.number().int().min(5).max(3600).default(600),
  oauthRedirectHosts: z.array(z.string().min(1)).min(1).max(20)
    .default(['chatgpt.com', 'chat.openai.com']),
  allowLoopbackOAuth: z.boolean().default(false)
});
export type Config = z.infer<typeof configSchema>;
export const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const digest = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
export const sameSecret = (a: string, b: string) => crypto.timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export function writeJson(file: string, value: unknown) {
  const temp = `${file}.${random(6)}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export type Audit = { time: string; action: string; outcome: string; owner?: string; detail?: unknown };
export class State {
  config: Config;
  paused = false;
  adminToken: string;
  dataDir: string;
  started = Date.now();
  auditTail: Audit[] = [];
  constructor(readonly base: string) {
    this.dataDir = path.join(base, '.rdc');
    this.config = configSchema.parse(JSON.parse(fs.readFileSync(path.join(this.dataDir, 'config.json'), 'utf8')));
    this.adminToken = fs.readFileSync(path.join(this.dataDir, 'admin-token.txt'), 'utf8').trim();
    if (this.adminToken.length < 32) throw new Error('Invalid admin token; rerun setup.');
    this.validate(this.config);
    const auditFile = path.join(this.dataDir, 'audit.jsonl');
    if (fs.existsSync(auditFile)) {
      this.auditTail = fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).slice(-200)
        .flatMap(line => { try { return [JSON.parse(line) as Audit]; } catch { return []; } });
    }
  }
  validate(c: Config) {
    const u = new URL(c.publicUrl);
    if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== ''))
      throw new Error('publicUrl must be an origin, without path/query/credentials.');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)))
      throw new Error('Remote URL requires HTTPS.');
    const ports = new Set([c.mcpPort, c.adminPort, c.tunnelPort]);
    if (ports.size !== 3) throw new Error('MCP, admin and Secure MCP Tunnel ports must all differ.');
    for (const root of c.roots) {
      if (!path.isAbsolute(root.path))
        throw new Error('Each allowed root must be an absolute directory path.');
      if (!fs.existsSync(root.path))
        throw new Error(`Authorized root does not exist: ${root.path}`);
      if (!fs.statSync(root.path).isDirectory())
        throw new Error(`Authorized root is not a directory: ${root.path}`);
    }
    for (const host of c.oauthRedirectHosts) {
      if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('OAuth hosts must be exact hostnames, not URLs or wildcards.');
    }
  }
  saveConfig(value: unknown) {
    const next = configSchema.parse(value);
    this.validate(next);
    this.config = next;
    writeJson(path.join(this.dataDir, 'config.json'), next);
    this.audit('configuration', 'updated');
  }
  audit(action: string, outcome: string, detail?: unknown, owner?: string) {
    const event = { time: new Date().toISOString(), action, outcome, detail, owner };
    const target = path.join(this.dataDir, 'audit.jsonl');
    if (fs.existsSync(target) && fs.statSync(target).size > 5 * 1024 * 1024) {
      fs.renameSync(target, `${target}.previous`);
    }
    fs.appendFileSync(target, JSON.stringify(event) + '\n', { mode: 0o600 });
    this.auditTail.push(event);
    if (this.auditTail.length > 200) this.auditTail.shift();
  }
  assertRunning() { if (this.paused) throw new Error('Remote access is paused by the computer owner.'); }
  publicConfig() { return { ...this.config, paused: this.paused, uptimeSeconds: Math.floor((Date.now() - this.started) / 1000) }; }
}
