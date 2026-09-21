import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { base, data, adminApi } from './common.mjs';

const logPath = path.join(data, 'server.log');
const previousLogPath = path.join(data, 'server.previous.log');

function tailLog(lines = 80) {
  try {
    const text = fs.readFileSync(logPath, 'utf8');
    return text.split(/\r?\n/).slice(-lines).join('\n').trim();
  } catch {
    return '';
  }
}

let running = false;
try { await adminApi('/state'); running = true; } catch {}

if (running) {
  console.log('[RDC-X] Existing instance detected. Restarting it so the running backend matches the freshly built files...');
  try {
    await adminApi('/shutdown', {});
  } catch (error) {
    console.error('Could not request shutdown of the existing RDC-X instance: ' + error.message);
    process.exit(1);
  }

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try {
      await adminApi('/state');
    } catch {
      running = false;
      break;
    }
  }

  if (running) {
    console.error('The previous RDC-X instance did not stop within 15 seconds.');
    console.error('Close any old RDC-X/tunnel-client process and run Start-All.cmd again.');
    process.exit(1);
  }
}

if (!running) {
  fs.mkdirSync(data, { recursive: true });
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 0) {
      fs.copyFileSync(logPath, previousLogPath);
    }
  } catch {}
  fs.writeFileSync(logPath, `=== RDC-X startup ${new Date().toISOString()} ===\n`);

  const out = fs.openSync(logPath, 'a');
  let child;
  try {
    child = spawn(process.execPath, [path.join(base, 'dist', 'main.js')], {
      cwd: base,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, out]
    });
  } catch (error) {
    fs.closeSync(out);
    console.error('Could not spawn RDC-X server: ' + error.message);
    process.exit(1);
  }
  child.unref();
  fs.closeSync(out);

  fs.writeFileSync(path.join(data, 'run.json'), JSON.stringify({
    pid: child.pid,
    startedAt: new Date().toISOString()
  }, null, 2));

  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try {
      await adminApi('/state');
      running = true;
      break;
    } catch {}
  }
}

if (!running) {
  console.error('RDC-X did not become healthy within 10 seconds.');
  const tail = tailLog();
  if (tail) {
    console.error('\n--- .rdc/server.log (tail) ---\n' + tail + '\n--- end log ---');
  } else {
    console.error('No startup log was produced.');
  }
  process.exitCode = 1;
} else {
  console.log('RDC-X is running locally. Complete Secure Tunnel sign-in in the browser to unlock the Dashboard.');
  await import('./dashboard.mjs');
}
