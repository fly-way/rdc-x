import { adminApi } from './common.mjs';
try { await adminApi('/shutdown', {}); console.log('RDC-X shutdown requested. Managed terminal processes will stop.'); }
catch (e) { console.error('Stop failed or server is already stopped: ' + e.message); process.exitCode = 1; }
