import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');

await test('web UI exposes Chinese and English language selectors', () => {
  assert.match(html, /data-language-select/);
  assert.match(html, /value="zh-CN"/);
  assert.match(html, /value="en"/);
  assert.match(app, /'zh-CN':\s*\{/);
  assert.match(app, /\ben:\s*\{/);
  assert.match(app, /localStorage\.setItem\('rdcx-lang'/);
});

await test('dashboard uses wide desktop content and readable typography overrides', () => {
  assert.match(css, /\.page-wrap\{padding:22px 22px 42px;max-width:none/);
  assert.match(css, /\.nav-item\{height:48px[^}]*font-size:14px/);
  assert.match(css, /\.page-heading h1\{font-size:28px/);
  assert.match(css, /\.settings-card form\{max-width:none;width:100%\}/);
});
