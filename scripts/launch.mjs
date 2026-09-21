import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { base, data, adminApi } from './common.mjs';
let running = false;
try { await adminApi('/state'); running = true; } catch {}
if (!running) {
  const out = fs.openSync(path.join(data, 'server.log'), 'a');
  const child = spawn(process.execPath, [path.join(base, 'dist', 'main.js')], { cwd: base, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
  child.unref(); fs.closeSync(out);
  fs.writeFileSync(path.join(data, 'run.json'), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try { await adminApi('/state'); running = true; break; } catch {}
  }
}
if (!running) { console.error('Startup failed. Inspect .rdc/server.log for details.'); process.exitCode = 1; }
else { console.log('RDC-X is running locally. Use Stop.cmd to stop it.'); await import('./dashboard.mjs'); }
