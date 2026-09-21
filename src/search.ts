import fs from 'node:fs/promises';
import path from 'node:path';
import { random } from './state.js';
import type { FileService } from './files.js';
type Search = { id: string; owner: string; status: string; scanned: number; results: unknown[]; startedAt: number; truncated: boolean; error?: string };
export class SearchService {
  items = new Map<string, Search>();
  constructor(private files: FileService) {}
  async start(owner: string, input: { path: string; pattern: string; type: 'files' | 'content'; ignoreCase: boolean; maxResults: number }) {
    for (const [id, item] of this.items) if (Date.now() - item.startedAt > 3600000 && item.status !== 'running') this.items.delete(id);
    if (this.items.size >= 50) throw new Error('Search limit reached.');
    const root = await this.files.guard.resolve(input.path);
    const task: Search = { id: random(12), owner, status: 'running', scanned: 0, results: [], startedAt: Date.now(), truncated: false };
    this.items.set(task.id, task);
    const pattern = input.ignoreCase ? input.pattern.toLowerCase() : input.pattern;
    const matches = (value: string) => (input.ignoreCase ? value.toLowerCase() : value).includes(pattern);
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (task.status !== 'running') return;
      if (depth > 12 || task.scanned >= 20000 || Date.now() - task.startedAt > 30000) { task.truncated = true; return; }
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (task.status !== 'running') return;
        if (task.results.length >= input.maxResults || task.scanned >= 20000 || Date.now() - task.startedAt > 30000) { task.truncated = true; return; }
        if (['node_modules', '.git', '.rdc', 'Library', 'Temp', 'obj', 'bin'].includes(entry.name) || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name); task.scanned++;
        try { await this.files.guard.resolve(full); } catch { continue; }
        if (input.type === 'files' && matches(entry.name)) task.results.push({ path: full, type: entry.isDirectory() ? 'directory' : 'file' });
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (input.type === 'content') {
          try {
            const { text } = await this.files.text(full);
            for (const [line, content] of text.split(/\r?\n/).entries()) {
              if (matches(content)) task.results.push({ path: full, line: line + 1, content: content.slice(0, 1000) });
              if (task.results.length >= input.maxResults) { task.truncated = true; return; }
            }
          } catch { /* Binary, protected and oversized files are intentionally skipped. */ }
        }
      }
    };
    void walk(root, 0).then(() => { if (task.status === 'running') task.status = 'completed'; })
      .catch(e => { task.status = 'failed'; task.error = e.message; });
    return { searchId: task.id, status: task.status, matching: 'literal substring, not regular expression or glob' };
  }
  get(id: string, owner: string, offset = 0, length = 100) {
    const item = this.items.get(id);
    if (!item || item.owner !== owner) throw new Error('Search not found.');
    const { results, owner: _, ...meta } = item;
    return { ...meta, totalResults: results.length, results: results.slice(offset, offset + length), nextOffset: offset + length < results.length ? offset + length : null };
  }
  stop(id: string, owner: string) {
    this.get(id, owner); this.items.get(id)!.status = 'stopped'; return { searchId: id, status: 'stopped' };
  }
  list(owner: string) { return [...this.items.values()].filter(s => s.owner === owner).map(({ results, owner: _, ...meta }) => ({ ...meta, count: results.length })); }
  stopAll() { for (const task of this.items.values()) if (task.status === 'running') task.status = 'stopped'; }
}
