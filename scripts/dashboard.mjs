import { spawn } from 'node:child_process';
import { getConfig, getKey, adminApi } from './common.mjs';
try {
  await adminApi('/state');
  const c = getConfig(); const url = `http://127.0.0.1:${c.adminPort}/#key=${getKey()}`;
  if (process.platform === 'win32') {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
  } else { const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }); child.unref(); }
  console.log('Opened the local dashboard. The admin key was not printed.');
} catch (e) { console.error('Dashboard unavailable: ' + e.message + '\nRun Start.cmd first.'); process.exitCode = 1; }
