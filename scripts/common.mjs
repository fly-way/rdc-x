import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const data = path.join(base, '.rdc');
export const getConfig = () => JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'));
export const getKey = () => fs.readFileSync(path.join(data, 'admin-token.txt'), 'utf8').trim();
export async function adminApi(route, body) {
  const c = getConfig();
  const response = await fetch(`http://127.0.0.1:${c.adminPort}/api${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-RDC-Admin': getKey(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000)
  });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`); return value;
}
