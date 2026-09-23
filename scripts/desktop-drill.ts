// Desktop drill: drives the Windows desktop tools through the Secure MCP Tunnel endpoint on a
// throwaway instance. Read-only first, then one no-op mouse move. Nothing is written to disk:
// screenshots live in the temporary instance's .rdc and are deleted right after capture.
// Usage: npm run drill:desktop
import { fixture, port } from '../test/helpers.js';
import { createApp } from '../src/app.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const f = fixture();
const mcpPort = await port();
let adminPort = await port(); while (adminPort === mcpPort) adminPort = await port();
let tunnelPort = await port(); while (tunnelPort === mcpPort || tunnelPort === adminPort) tunnelPort = await port();
f.state.saveConfig({
  ...f.state.config, mcpPort, adminPort, tunnelPort, secureTunnelEnabled: true,
  desktopControlEnabled: true, publicUrl: `http://127.0.0.1:${mcpPort}`
});

const app = createApp(f.base);
await app.listen();
const client = new Client({ name: 'desktop-drill', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${tunnelPort}/mcp`)));

const results: { step: string; ok: boolean; detail: string }[] = [];
async function call(step: string, name: string, args: Record<string, unknown> = {}) {
  const started = Date.now();
  try {
    const result: any = await client.callTool({ name, arguments: args });
    if (result.isError) {
      results.push({ step, ok: false, detail: String(result.content?.[0]?.text ?? 'tool error').slice(0, 160) });
      return null;
    }
    results.push({ step, ok: true, detail: `${Date.now() - started}ms` });
    return result;
  } catch (error: any) {
    results.push({ step, ok: false, detail: String(error.message).slice(0, 160) });
    return null;
  }
}
const json = (result: any) => {
  const text = result?.content?.find((item: any) => item.type === 'text')?.text;
  try { return JSON.parse(text); } catch { return null; }
};
const imageOf = (result: any) => {
  const item = result?.content?.find((item: any) => item.type === 'image');
  if (!item) return null;
  const buffer = Buffer.from(item.data, 'base64');
  return { mimeType: item.mimeType, bytes: buffer.length, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

const displays = json(await call('list_displays', 'list_displays'));
const windows = json(await call('list_windows', 'list_windows'));
const windowList: any[] = Array.isArray(windows?.windows) ? windows.windows : [];
const target = windowList.find(item => item?.Id && item?.MainWindowTitle) ?? windowList[0];

let cursor = json(await call('get_cursor_position', 'get_cursor_position'));
if (target?.Id) await call('get_window_info', 'get_window_info', { pid: target.Id });

const full = imageOf(await call('desktop_screenshot', 'desktop_screenshot', { display: 0 }));
const region = imageOf(await call('desktop_screenshot_region', 'desktop_screenshot_region', { x: 100, y: 100, width: 240, height: 160 }));
const windowShot = target?.Id ? imageOf(await call('desktop_screenshot_window', 'desktop_screenshot_window', { pid: target.Id })) : null;

// Minimal, no-op mouse action: move the pointer to where it already is.
const before = cursor ? { x: cursor.x, y: cursor.y } : { x: 100, y: 100 };
await call('mouse_move (no-op)', 'mouse_move', { x: before.x, y: before.y });
const after = json(await call('get_cursor_position (after)', 'get_cursor_position'));
const cursorHeld = !!after && after.x === before.x && after.y === before.y;

console.log('\ndisplays           :', displays?.displays?.map((d: any) => `${d.Width}x${d.Height}${d.Primary ? ' (primary)' : ''}`).join(', ') ?? 'none');
console.log('visible windows    :', windowList.length, '->', windowList.slice(0, 6).map((w: any) => w.ProcessName).join(', '));
console.log('window info pid    :', target?.Id ?? 'n/a', target ? `(${target.ProcessName})` : '');
console.log('cursor position    :', before.x, before.y, '| unchanged after move:', cursorHeld);
console.log('full screenshot    :', full ? `${full.mimeType} ${full.width}x${full.height} ${(full.bytes / 1024).toFixed(0)}KB` : 'n/a');
console.log('region screenshot  :', region ? `${region.width}x${region.height} ${(region.bytes / 1024).toFixed(0)}KB` : 'n/a');
console.log('window screenshot  :', windowShot ? `${windowShot.width}x${windowShot.height} ${(windowShot.bytes / 1024).toFixed(0)}KB` : 'n/a');
console.log('');
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.step.padEnd(28)} ${item.detail}`);
const failed = results.filter(item => !item.ok);
console.log(`\ntotal ${results.length}, passed ${results.length - failed.length}, failed ${failed.length}`);

await client.close();
await app.stop();
f.clean();
await new Promise(resolve => setTimeout(resolve, 600));
process.exit(failed.length ? 1 : 0);
