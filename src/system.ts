import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { State } from './state.js';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const critical = new Set(['system','registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer']);
export class SystemService {
  private async commandAvailable(name: string) {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    try {
      const { stdout } = await execFileAsync(command, [name], { windowsHide: true, timeout: 5000 });
      return { available: true, path: stdout.trim().split(/\r?\n/)[0] || name };
    } catch {
      return { available: false, path: null };
    }
  }

  async diagnostics(state: State, base: string) {
    const roots = await Promise.all(state.config.roots.map(async root => {
      try {
        const stat = await fs.stat(root.path);
        return { path: root.path, write: root.write, exists: true, directory: stat.isDirectory() };
      } catch (e: any) {
        return { path: root.path, write: root.write, exists: false, directory: false, error: String(e.message ?? e) };
      }
    }));

    const commands = process.platform === 'win32'
      ? ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'git.exe']
      : ['sh', 'bash', 'git'];
    const commandChecks = Object.fromEntries(await Promise.all(commands.map(async name => [name, await this.commandAvailable(name)])));

    const localTunnel = path.join(base, 'tools', process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client');
    let tunnelClient: any = { available: false, path: null, version: null };
    let tunnelCommand = process.env.TUNNEL_CLIENT_PATH?.trim() || '';
    if (!tunnelCommand) {
      try { await fs.access(localTunnel); tunnelCommand = localTunnel; } catch {}
    }
    if (!tunnelCommand) {
      const found = await this.commandAvailable(process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client');
      if (found.available) tunnelCommand = found.path!;
    }
    if (tunnelCommand) {
      tunnelClient = { available: true, path: tunnelCommand, version: null };
      try {
        const { stdout, stderr } = await execFileAsync(tunnelCommand, ['--version'], { windowsHide: true, timeout: 5000 });
        tunnelClient.version = (stdout || stderr).trim().split(/\r?\n/)[0] || null;
      } catch (e: any) {
        tunnelClient.error = String(e.message ?? e);
      }
    }

    const warnings: string[] = [];
    if (!roots.length) warnings.push('No filesystem roots are authorized.');
    if (roots.some(root => !root.exists || !root.directory)) warnings.push('One or more authorized roots are unavailable.');
    if (!tunnelClient.available) warnings.push('tunnel-client was not found.');
    if (process.platform === 'win32' && !(commandChecks['powershell.exe'] as any)?.available && !(commandChecks['pwsh.exe'] as any)?.available)
      warnings.push('No PowerShell executable was found.');

    return {
      ok: warnings.length === 0,
      platform: process.platform,
      node: process.version,
      roots,
      commands: commandChecks,
      tunnelClient,
      policy: {
        terminalEnabled: state.config.terminalEnabled,
        systemProcessControlEnabled: state.config.systemProcessControlEnabled,
        desktopControlEnabled: state.config.desktopControlEnabled,
        networkFetchEnabled: state.config.networkFetchEnabled,
        requireWriteApproval: state.config.requireWriteApproval,
        commandPolicyMode: state.config.commandPolicyMode
      },
      warnings
    };
  }

  async info() {
    return { platform: process.platform, arch: process.arch, hostname: os.hostname(), release: os.release(), version: os.version(),
      uptimeSeconds: Math.floor(os.uptime()), cpuCount: os.cpus().length, totalMemory: os.totalmem(), freeMemory: os.freemem(), node: process.version };
  }
  async listProcesses(limit=200) {
    if (process.platform === 'win32') {
      const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Sort-Object CPU -Descending | Select-Object -First "+limit+" Id,ProcessName,CPU,WorkingSet64,MainWindowTitle | ConvertTo-Json -Compress";
      const { stdout } = await execFileAsync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{maxBuffer:2*1024*1024,windowsHide:true});
      const parsed = stdout.trim() ? JSON.parse(stdout) : [];
      return { processes: Array.isArray(parsed)?parsed:[parsed] };
    }
    const { stdout } = await execFileAsync('ps',['-eo','pid=,comm=,%cpu=,rss=','--sort=-%cpu'],{maxBuffer:2*1024*1024});
    return { processes: stdout.trim().split('\n').slice(0,limit).map(line=>line.trim().split(/\s+/,4)) };
  }
  async killProcess(pid:number) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Invalid or protected PID.');
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{Id=$p.Id;Name=$p.ProcessName}|ConvertTo-Json -Compress`],{windowsHide:true});
      const p=JSON.parse(stdout.trim()); if (critical.has(String(p.Name).toLowerCase())) throw new Error('Refusing to terminate a protected Windows process.');
      await execFileAsync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true}); return { pid, name:p.Name, terminated:true };
    }
    process.kill(pid,'SIGTERM'); return { pid, terminated:true };
  }
}
