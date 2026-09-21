import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { random, type State } from './state.js';
import type { PathGuard } from './paths.js';

type Session = {
  id: string;
  owner: string;
  pid?: number;
  command: string;
  cwd: string;
  state: string;
  startedAt: number;
  exitCode: number | null;
  output: string;
  discarded: number;
  interactive: boolean;
  child: ChildProcess;
  timer?: NodeJS.Timeout;
};

export class ProcessService {
  sessions = new Map<string, Session>();

  constructor(private state: State, private guard: PathGuard) {}

  assertEnabled() {
    if (!this.state.config.terminalEnabled) {
      throw new Error('Terminal is disabled. The owner must enable it in the local dashboard.');
    }
  }

  private commandMatches(command: string, pattern: string) {
    let source = '^';
    for (const ch of pattern) {
      if (ch === '*') source += '.*';
      else if (ch === '?') source += '.';
      else source += ch.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
    source += '$';
    return new RegExp(source, 'i').test(command.trim());
  }

  private assertCommandPolicy(command: string) {
    const value = command.trim();
    if (!value) throw new Error('Command cannot be empty.');

    const {
      commandPolicyMode: mode,
      blockedCommandPatterns: blocked,
      allowedCommandPatterns: allowed
    } = this.state.config;

    if (mode === 'off') return;

    const denied = blocked.find(pattern => this.commandMatches(value, pattern));
    if (denied) {
      throw new Error('Command blocked by local policy pattern: ' + denied);
    }

    if (mode === 'allowlist' && !allowed.some(pattern => this.commandMatches(value, pattern))) {
      throw new Error('Command is not allowed by the local command allowlist.');
    }
  }

  async start(owner: string, command: string, cwd: string, seconds: number, interactive = false) {
    this.assertEnabled();
    this.assertCommandPolicy(command);

    for (const [id, session] of this.sessions) {
      if (session.state !== 'running' && Date.now() - session.startedAt > 3600000) {
        this.sessions.delete(id);
      }
    }

    if ([...this.sessions.values()].filter(p => p.state === 'running').length >= 8 || this.sessions.size >= 100) {
      throw new Error('Terminal session limit reached.');
    }

    const directory = await this.guard.resolve(cwd, true);
    const allowedEnv = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|LANG|LC_ALL|TERM)$/i;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name, value]) => value !== undefined && allowedEnv.test(name))
    );

    const win = process.platform === 'win32';
    const executable = win ? 'powershell.exe' : '/bin/sh';
    const args = win
      ? [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ' +
            command +
            '; if ($?) { exit 0 } else { exit 1 }'
        ]
      : ['-c', command];

    const child = spawn(executable, args, {
      cwd: directory,
      env,
      windowsHide: true,
      detached: !win,
      stdio: 'pipe'
    });

    const session: Session = {
      id: random(12),
      owner,
      pid: child.pid,
      command,
      cwd: directory,
      state: 'running',
      startedAt: Date.now(),
      exitCode: null,
      output: '',
      discarded: 0,
      interactive,
      child
    };
    this.sessions.set(session.id, session);

    const append = (text: string) => {
      session.output += text;
      if (session.output.length > 262144) {
        const count = session.output.length - 262144;
        session.output = session.output.slice(count);
        session.discarded += count;
      }
    };

    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder('utf8');
      stream?.on('data', data => append(decoder.write(data)));
      stream?.on('end', () => append(decoder.end()));
    }

    // Ordinary one-shot commands should see EOF on stdin. Keeping the pipe open
    // can make Windows PowerShell wait indefinitely after the command finishes.
    // Explicit interactive sessions keep stdin open for interact_with_process.
    if (!interactive) child.stdin?.end();

    child.on('error', error => {
      append(`\n[spawn error] ${error.message}`);
      session.state = 'failed';
      clearTimeout(session.timer);
    });

    child.on('close', code => {
      if (session.state === 'running') session.state = 'completed';
      session.exitCode = code;
      clearTimeout(session.timer);
    });

    session.timer = setTimeout(() => {
      session.state = 'timed_out';
      void this.terminate(session);
    }, Math.min(seconds, this.state.config.maxProcessSeconds) * 1000);
    session.timer.unref();

    return this.read(session.id, owner);
  }

  private find(id: string, owner: string) {
    const item = this.sessions.get(id);
    if (!item || item.owner !== owner) throw new Error('Session not found.');
    return item;
  }

  read(id: string, owner: string, offset = 0, length = 20000) {
    const item = this.find(id, owner);
    const start = Math.max(offset, item.discarded);
    const output = item.output.slice(start - item.discarded, start - item.discarded + length);
    return {
      sessionId: item.id,
      pid: item.pid,
      state: item.state,
      exitCode: item.exitCode,
      output,
      offset: start,
      nextOffset: start + output.length,
      discardedCharacters: item.discarded
    };
  }

  async input(id: string, owner: string, text: string) {
    this.assertEnabled();
    const item = this.find(id, owner);
    if (!item.interactive) {
      throw new Error('Session is not interactive. Start it with interactive=true to send stdin.');
    }
    if (item.state !== 'running' || !item.child.stdin?.writable) {
      throw new Error('Session is not accepting input.');
    }
    await new Promise<void>((resolve, reject) =>
      item.child.stdin!.write(text, error => error ? reject(error) : resolve())
    );
    return { sessionId: id, sentCharacters: text.length };
  }

  private async terminate(item: Session) {
    if (!item.pid || item.child.exitCode !== null) return;
    clearTimeout(item.timer);

    const closed = new Promise<void>(resolve => {
      if (item.child.exitCode !== null) resolve();
      else item.child.once('close', () => resolve());
    });

    if (process.platform === 'win32') {
      await new Promise<void>(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(item.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        });
        killer.on('error', () => {
          item.child.kill();
          resolve();
        });
        killer.on('close', () => resolve());
      });
    } else {
      try {
        process.kill(-item.pid, 'SIGKILL');
      } catch {
        item.child.kill('SIGKILL');
      }
    }

    // Do not report a stopped tree before Node has observed the child close.
    // This also lets stdout/stderr drain and prevents Windows temp-directory cleanup races.
    await Promise.race([
      closed,
      new Promise<void>(resolve => setTimeout(resolve, 5000))
    ]);
  }

  async stop(id: string, owner: string) {
    const item = this.find(id, owner);
    if (item.state === 'running') {
      item.state = 'stopped';
      await this.terminate(item);
    }
    return { sessionId: id, state: item.state };
  }

  list(owner?: string) {
    return [...this.sessions.values()]
      .filter(s => !owner || s.owner === owner)
      .map(({ child, timer, output, ...meta }) => ({ ...meta, outputCharacters: output.length }));
  }

  async stopAll() {
    await Promise.all(
      [...this.sessions.values()]
        .filter(s => s.state === 'running')
        .map(s => this.stop(s.id, s.owner))
    );
  }
}
