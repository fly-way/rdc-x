import { spawn } from 'node:child_process';
import { getConfig, getKey, adminApi } from './common.mjs';

function launchDetached(command, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
    child.once('error', error => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once('spawn', () => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve();
      }
    });
  });
}

try {
  await adminApi('/state');
  const c = getConfig();
  const url = `http://127.0.0.1:${c.adminPort}/#key=${encodeURIComponent(getKey())}&view=connections`;

  if (process.platform === 'win32') {
    // Use the Windows URL protocol handler directly. This is more reliable than
    // spawning a hidden PowerShell and asking Start-Process to interpret a URL.
    // Fall back to Explorer for systems where rundll32 URL handling is disabled.
    try {
      await launchDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
    } catch {
      await launchDetached('explorer.exe', [url]);
    }
  } else {
    await launchDetached(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
  }

  console.log('Opened the local dashboard. The admin key was not printed.');
} catch (e) {
  console.error('Dashboard unavailable: ' + e.message + '\nRun Start-All.cmd on this computer.');
  process.exitCode = 1;
}
