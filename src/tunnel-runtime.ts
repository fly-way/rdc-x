import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { State } from './state.js';

const TUNNEL_ID_RE = /^tunnel_[0-9a-f]{32}$/;
const HEALTH_PORT = 47834;

type StoredTunnelSettings = {
  tunnelId: string;
};

function powershellPath() {
  if (process.platform !== 'win32') return '';
  const preferred = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  return fs.existsSync(preferred) ? preferred : 'powershell.exe';
}

function encodePowerShell(script: string) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function protectSecret(secret: string) {
  if (process.platform !== 'win32') {
    throw new Error('Persistent Runtime API key storage currently requires Windows DPAPI.');
  }
  const script = [
    '$plain=[Console]::In.ReadToEnd();',
    '$bytes=[System.Text.Encoding]::UTF8.GetBytes($plain);',
    '$protected=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Console]::Out.Write([Convert]::ToBase64String($protected));'
  ].join(' ');
  const result = spawnSync(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)], {
    input: secret,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000
  });
  if (result.status !== 0 || !String(result.stdout ?? '').trim()) {
    throw new Error('Could not protect Runtime API key with Windows DPAPI: ' + String(result.stderr ?? '').trim());
  }
  return String(result.stdout).trim();
}

export function unprotectSecret(ciphertext: string) {
  if (process.platform !== 'win32') {
    throw new Error('Persistent Runtime API key storage currently requires Windows DPAPI.');
  }
  const script = [
    '$cipher=[Console]::In.ReadToEnd();',
    '$bytes=[Convert]::FromBase64String($cipher);',
    '$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain));'
  ].join(' ');
  const result = spawnSync(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)], {
    input: ciphertext,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000
  });
  if (result.status !== 0) {
    throw new Error('Could not unlock Runtime API key with Windows DPAPI for the current Windows user.');
  }
  return String(result.stdout ?? '');
}

export class TunnelRuntime {
  private child?: ChildProcess;
  private lastError = '';
  private readonly settingsPath: string;
  private readonly secretPath: string;
  private readonly logPath: string;

  constructor(private state: State, private base: string) {
    this.settingsPath = path.join(state.dataDir, 'secure-tunnel.json');
    this.secretPath = path.join(state.dataDir, 'secure-tunnel-key.dpapi');
    this.logPath = path.join(state.dataDir, 'secure-tunnel.log');
  }

  private settings(): StoredTunnelSettings | undefined {
    if (!fs.existsSync(this.settingsPath)) return undefined;
    try {
      const value = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
      return typeof value?.tunnelId === 'string' ? { tunnelId: value.tunnelId } : undefined;
    } catch {
      return undefined;
    }
  }

  private getKey() {
    if (!fs.existsSync(this.secretPath)) return '';
    return unprotectSecret(fs.readFileSync(this.secretPath, 'utf8').trim());
  }

  private executable() {
    const configured = process.env.TUNNEL_CLIENT_PATH?.trim();
    if (configured) return configured;
    const bundled = path.join(this.base, 'tools', process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client');
    return fs.existsSync(bundled) ? bundled : 'tunnel-client';
  }

  async status() {
    const settings = this.settings();
    let live = false;
    let ready = false;
    try {
      const health = await fetch(`http://127.0.0.1:${HEALTH_PORT}/healthz`, { signal: AbortSignal.timeout(700) });
      live = health.ok;
    } catch {}
    try {
      const response = await fetch(`http://127.0.0.1:${HEALTH_PORT}/readyz`, { signal: AbortSignal.timeout(700) });
      ready = response.ok;
    } catch {}
    return {
      configured: !!settings && fs.existsSync(this.secretPath),
      tunnelId: settings?.tunnelId ?? '',
      hasApiKey: fs.existsSync(this.secretPath),
      processRunning: !!this.child && this.child.exitCode === null,
      live,
      ready,
      uiUrl: `http://127.0.0.1:${HEALTH_PORT}/ui`,
      endpoint: `http://127.0.0.1:${this.state.config.tunnelPort}/mcp`,
      lastError: this.lastError
    };
  }

  async configure(tunnelId: string, runtimeApiKey?: string) {
    const id = tunnelId.trim();
    if (!TUNNEL_ID_RE.test(id)) {
      throw new Error('Tunnel ID must be tunnel_ followed by 32 lowercase hexadecimal characters.');
    }
    fs.writeFileSync(this.settingsPath, JSON.stringify({ tunnelId: id }, null, 2), { mode: 0o600 });
    if (runtimeApiKey !== undefined && runtimeApiKey.trim()) {
      const protectedValue = protectSecret(runtimeApiKey.trim());
      fs.writeFileSync(this.secretPath, protectedValue, { mode: 0o600 });
    }
    if (!fs.existsSync(this.secretPath)) {
      throw new Error('Runtime API Key is required the first time this computer is configured.');
    }
    if (!this.state.config.secureTunnelEnabled) {
      this.state.saveConfig({ ...this.state.config, secureTunnelEnabled: true });
    }
    this.state.audit('secure_tunnel_config', 'updated', { tunnelId: id, apiKeyStored: true });
    await this.restart();
    return this.status();
  }

  async forgetKey() {
    await this.stop();
    if (fs.existsSync(this.secretPath)) fs.rmSync(this.secretPath, { force: true });
    this.state.audit('secure_tunnel_key', 'forgotten');
    return this.status();
  }

  async autoStart() {
    const settings = this.settings();
    if (!this.state.config.secureTunnelEnabled || !settings || !fs.existsSync(this.secretPath)) return this.status();
    return this.start();
  }

  async start() {
    const settings = this.settings();
    if (!settings || !TUNNEL_ID_RE.test(settings.tunnelId)) {
      throw new Error('Secure MCP Tunnel is not configured. Enter a Tunnel ID in the local dashboard.');
    }
    if (!fs.existsSync(this.secretPath)) {
      throw new Error('Runtime API Key is not stored. Enter it in the local dashboard.');
    }
    if (!this.state.config.secureTunnelEnabled) {
      this.state.saveConfig({ ...this.state.config, secureTunnelEnabled: true });
    }
    if (this.child && this.child.exitCode === null) return this.status();

    const before = await this.status();
    if (before.live && !before.processRunning) {
      this.lastError = 'Another tunnel-client is already using 127.0.0.1:47834. Close the old tunnel-client window before RDC-X starts its managed runtime.';
      return this.status();
    }

    const apiKey = this.getKey();
    if (!apiKey) throw new Error('Stored Runtime API Key could not be unlocked.');
    fs.mkdirSync(this.state.dataDir, { recursive: true });
    const out = fs.openSync(this.logPath, 'a');
    const executable = this.executable();
    const args = [
      'run',
      `--control-plane.tunnel-id=${settings.tunnelId}`,
      '--control-plane.api-key=env:CONTROL_PLANE_API_KEY',
      `--mcp.server-url=http://127.0.0.1:${this.state.config.tunnelPort}/mcp`,
      `--health.listen-addr=127.0.0.1:${HEALTH_PORT}`,
      '--log.level=info',
      '--log.format=struct-text'
    ];

    this.lastError = '';
    try {
      const child = spawn(executable, args, {
        cwd: this.base,
        stdio: ['ignore', out, out],
        env: { ...process.env, CONTROL_PLANE_API_KEY: apiKey },
        windowsHide: true
      });
      this.child = child;
      child.once('error', error => {
        this.lastError = 'Unable to start tunnel-client: ' + error.message;
        this.state.audit('secure_tunnel_runtime', 'failed', { error: this.lastError });
      });
      child.once('exit', code => {
        if (this.child === child) this.child = undefined;
        if (code && code !== 0) this.lastError = `tunnel-client exited with code ${code}. See .rdc/secure-tunnel.log`;
        this.state.audit('secure_tunnel_runtime', code === 0 ? 'stopped' : 'exited', { code });
      });
      child.unref();
      this.state.audit('secure_tunnel_runtime', 'started', { tunnelId: settings.tunnelId });
    } finally {
      fs.closeSync(out);
    }
    return this.status();
  }

  async stop() {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = undefined;
      return this.status();
    }
    await new Promise<void>(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      child.once('exit', finish);
      try { child.kill(); } catch { finish(); }
      setTimeout(finish, 5000).unref();
    });
    if (this.child === child) this.child = undefined;
    this.state.audit('secure_tunnel_runtime', 'stopped');
    return this.status();
  }

  async restart() {
    await this.stop();
    return this.start();
  }
}
