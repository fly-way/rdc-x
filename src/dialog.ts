import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { random } from './state.js';

export type FolderPickStatus = 'pending' | 'selected' | 'cancelled' | 'error';

export type FolderPick = {
  id: string;
  status: FolderPickStatus;
  paths: string[];
  error: string;
};

const PICK_TIMEOUT_MS = 10 * 60 * 1000;
const PICK_RETAIN_MS = 5 * 60 * 1000;
const MAX_PENDING = 3;
const MAX_PICKS = 24;

function powershellPath(): string {
  if (process.platform !== 'win32') return '';
  const preferred = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  return fs.existsSync(preferred) ? preferred : 'powershell.exe';
}

function clean(value: string, limit: number): string {
  return String(value ?? '').replace(/[\r\n'"`$]/g, ' ').trim().slice(0, limit);
}

function windowsScript(title: string, startPath: string): string {
  return [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
    'Add-Type -AssemblyName System.Windows.Forms;',
    '[System.Windows.Forms.Application]::EnableVisualStyles();',
    '$owner=New-Object System.Windows.Forms.Form;',
    "$owner.TopMost=$true;$owner.ShowInTaskbar=$false;$owner.WindowState='Minimized';$owner.Opacity=0.01;",
    '$null=$owner.Handle;',
    '$dialog=New-Object System.Windows.Forms.FolderBrowserDialog;',
    `$dialog.Description='${clean(title, 120)}';`,
    '$dialog.ShowNewFolderButton=$false;',
    "$dialog.RootFolder='MyComputer';",
    startPath ? `$dialog.SelectedPath='${clean(startPath, 240)}';` : '',
    '$result=$dialog.ShowDialog($owner);',
    "if($result -eq [System.Windows.Forms.DialogResult]::OK){ Write-Output ('RDCX_SELECTED=' + $dialog.SelectedPath) } else { Write-Output 'RDCX_CANCELLED' };",
    '$owner.Dispose();'
  ].filter(Boolean).join(' ');
}

/**
 * Opens the native folder picker on the computer that runs RDC-X, so the local owner can
 * authorize real directories instead of typing paths. Requests are asynchronous because a
 * person may take a while to pick a folder.
 */
export class DialogService {
  private picks = new Map<string, FolderPick>();
  private children = new Map<string, ChildProcess>();
  private timers = new Map<string, NodeJS.Timeout>();

  start(title: string, startPath = ''): FolderPick {
    if ([...this.picks.values()].filter(pick => pick.status === 'pending').length >= MAX_PENDING)
      throw new Error('Too many folder picker dialogs are already open. Finish or close them first.');

    if (this.picks.size > MAX_PICKS) {
      for (const [id, pick] of this.picks) if (pick.status !== 'pending') { this.picks.delete(id); break; }
    }

    const id = random(9);
    const pick: FolderPick = { id, status: 'pending', paths: [], error: '' };
    this.picks.set(id, pick);
    this.launch(id, title, startPath);
    return { ...pick };
  }

  get(id: string): FolderPick | undefined {
    const pick = this.picks.get(id);
    if (!pick) return undefined;
    const result = { ...pick, paths: [...pick.paths] };
    if (pick.status !== 'pending') this.scheduleRemoval(id);
    return result;
  }

  cancel(id: string): void {
    const pick = this.picks.get(id);
    if (!pick || pick.status !== 'pending') return;
    this.children.get(id)?.kill();
    pick.status = 'cancelled';
    this.cleanup(id);
    this.scheduleRemoval(id);
  }

  dispose(): void {
    for (const id of [...this.picks.keys()]) this.cancel(id);
  }

  private launch(id: string, title: string, startPath: string): void {
    const pick = this.picks.get(id);
    if (!pick) return;
    let child: ChildProcess;
    try {
      child = this.spawnPicker(title, startPath);
    } catch (e: any) {
      pick.status = 'error';
      pick.error = String(e.message ?? e).slice(0, 300);
      return;
    }
    this.children.set(id, child);

    let output = '';
    child.stdout?.on('data', chunk => { output += String(chunk); });
    child.stderr?.on('data', chunk => { output += String(chunk); });

    const timer = setTimeout(() => {
      child.kill();
      if (pick.status === 'pending') {
        pick.status = 'error';
        pick.error = 'The folder picker dialog was not answered within 10 minutes.';
      }
      this.timers.delete(id);
      this.scheduleRemoval(id);
    }, PICK_TIMEOUT_MS);
    timer.unref?.();
    this.timers.set(id, timer);

    child.on('error', (e: any) => {
      if (pick.status === 'pending') {
        pick.status = 'error';
        pick.error = String(e.message ?? e).slice(0, 300);
      }
      this.cleanup(id);
    });

    child.on('close', (code: number | null) => {
      if (pick.status !== 'pending') { this.cleanup(id); return; }
      const match = /RDCX_SELECTED=(.+)/.exec(output.split(/\r?\n/).find(line => line.includes('RDCX_SELECTED=')) ?? '');
      const plainPath = output.split(/\r?\n/).map(line => line.trim()).find(line => process.platform !== 'win32' && line.startsWith('/'));
      if (match) {
        const selected = match[1]!.trim();
        pick.status = selected ? 'selected' : 'error';
        pick.paths = selected ? [selected] : [];
        if (!selected) pick.error = 'The folder picker returned an empty path.';
      } else if (plainPath) {
        pick.status = 'selected';
        pick.paths = [plainPath];
      } else if (/RDCX_CANCELLED/.test(output) || (code !== 0 && !output.trim())) {
        pick.status = 'cancelled';
      } else {
        pick.status = 'error';
        pick.error = 'The folder picker did not return a folder. ' + output.trim().slice(0, 200);
      }
      this.cleanup(id);
    });
  }

  private spawnPicker(title: string, startPath: string): ChildProcess {
    if (process.platform === 'win32')
      return spawn(powershellPath(), ['-NoLogo', '-NoProfile', '-STA', '-Command', windowsScript(title, startPath)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    if (process.platform === 'darwin')
      return spawn('osascript', [
        '-e', `set theFolder to choose folder with prompt "${clean(title, 120)}"`,
        '-e', 'POSIX path of theFolder'
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

    return spawn('zenity', ['--file-selection', '--directory', `--title=${clean(title, 120)}`],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  private cleanup(id: string): void {
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); this.timers.delete(id); }
    this.children.delete(id);
  }

  private scheduleRemoval(id: string): void {
    const timer = setTimeout(() => { this.picks.delete(id); this.timers.delete(id); }, PICK_RETAIN_MS);
    timer.unref?.();
    this.timers.set(id, timer);
  }
}
