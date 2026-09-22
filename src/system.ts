import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const critical = new Set(['system','registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer']);
export class SystemService {
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
