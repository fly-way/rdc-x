import fs from 'node:fs/promises';
import path from 'node:path';
import { random } from './state.js';
import type { FileService } from './files.js';

export type SearchInput = {
  path: string;
  pattern: string;
  type: 'files' | 'content';
  mode: 'literal' | 'regex';
  ignoreCase: boolean;
  filePatterns: string[];
  includeHidden: boolean;
  includeGenerated: boolean;
  contextLines: number;
  maxDepth: number;
  maxResults: number;
  timeoutSeconds: number;
};

type Search = {
  id: string; owner: string; status: string; scanned: number; results: unknown[];
  startedAt: number; truncated: boolean; error?: string;
  input: Omit<SearchInput, 'path'> & { root: string };
};

const heavyDirs = new Set(['node_modules', '.git', 'Library', 'Temp', 'obj', 'bin', 'dist', '.next', '.cache']);

function globRegex(glob: string, ignoreCase: boolean) {
  let source = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') { source += '.*'; i++; }
    else if (ch === '*') source += '[^\\\\/]*';
    else if (ch === '?') source += '[^\\\\/]';
    else source += ch.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(source + '$', ignoreCase ? 'i' : '');
}

export class SearchService {
  items = new Map<string, Search>();
  constructor(private files: FileService) {}

  async start(owner: string, input: SearchInput) {
    for (const [id, item] of this.items)
      if (Date.now() - item.startedAt > 3600000 && item.status !== 'running') this.items.delete(id);
    if (this.items.size >= 50) throw new Error('Search limit reached.');

    const root = await this.files.guard.resolve(input.path);
    const task: Search = {
      id: random(12), owner, status: 'running', scanned: 0, results: [], startedAt: Date.now(), truncated: false,
      input: {
        pattern: input.pattern, type: input.type, mode: input.mode, ignoreCase: input.ignoreCase,
        filePatterns: input.filePatterns, includeHidden: input.includeHidden, includeGenerated: input.includeGenerated,
        contextLines: input.contextLines, maxDepth: input.maxDepth, maxResults: input.maxResults,
        timeoutSeconds: input.timeoutSeconds, root
      }
    };
    this.items.set(task.id, task);

    let matcher: (value: string) => boolean;
    if (input.mode === 'regex') {
      let re: RegExp;
      try { re = new RegExp(input.pattern, input.ignoreCase ? 'i' : ''); }
      catch (e: any) { this.items.delete(task.id); throw new Error('Invalid regular expression: ' + e.message); }
      matcher = value => re.test(value.slice(0, 20000));
    } else {
      const needle = input.ignoreCase ? input.pattern.toLowerCase() : input.pattern;
      matcher = value => (input.ignoreCase ? value.toLowerCase() : value).includes(needle);
    }

    const fileMatchers = input.filePatterns.map(glob => globRegex(glob, input.ignoreCase));
    const fileAllowed = (full: string) => {
      if (!fileMatchers.length) return true;
      const relative = path.relative(root, full).replaceAll(path.sep, '/');
      return fileMatchers.some(re => re.test(relative) || re.test(path.basename(full)));
    };
    const deadline = task.startedAt + input.timeoutSeconds * 1000;

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (task.status !== 'running') return;
      if (depth > input.maxDepth || task.scanned >= 100000 || Date.now() > deadline) { task.truncated = true; return; }

      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }

      for (const entry of entries) {
        if (task.status !== 'running') return;
        if (task.results.length >= input.maxResults || task.scanned >= 100000 || Date.now() > deadline) {
          task.truncated = true; return;
        }
        if (entry.isSymbolicLink()) continue;
        if (!input.includeHidden && entry.name.startsWith('.')) continue;
        if (!input.includeGenerated && entry.isDirectory() && heavyDirs.has(entry.name)) continue;

        const full = path.join(dir, entry.name);
        task.scanned++;
        try { await this.files.guard.resolve(full); } catch { continue; }

        const relative = path.relative(root, full);
        if (input.type === 'files' && matcher(relative))
          task.results.push({ path: full, relativePath: relative, type: entry.isDirectory() ? 'directory' : 'file' });

        if (entry.isDirectory()) {
          if (depth < input.maxDepth) await walk(full, depth + 1);
          continue;
        }
        if (input.type !== 'content' || !fileAllowed(full)) continue;

        try {
          const { text } = await this.files.text(full);
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const content = lines[i]!;
            if (!matcher(content)) continue;
            const before = input.contextLines ? lines.slice(Math.max(0, i - input.contextLines), i) : [];
            const after = input.contextLines ? lines.slice(i + 1, i + 1 + input.contextLines) : [];
            task.results.push({
              path: full, relativePath: path.relative(root, full), line: i + 1,
              content: content.slice(0, 2000), before, after
            });
            if (task.results.length >= input.maxResults) { task.truncated = true; return; }
          }
        } catch {
          // Binary, protected and oversized files are intentionally skipped.
        }
      }
    };

    void walk(root, 0)
      .then(() => { if (task.status === 'running') task.status = 'completed'; })
      .catch(e => { task.status = 'failed'; task.error = String(e.message ?? e); });

    return { searchId: task.id, status: task.status, mode: input.mode, type: input.type, root };
  }

  get(id: string, owner: string, offset = 0, length = 100) {
    const item = this.items.get(id);
    if (!item || item.owner !== owner) throw new Error('Search not found.');
    const { results, owner: _, ...meta } = item;
    return {
      ...meta, totalResults: results.length,
      results: results.slice(offset, offset + length),
      nextOffset: offset + length < results.length ? offset + length : null
    };
  }

  stop(id: string, owner: string) {
    this.get(id, owner);
    this.items.get(id)!.status = 'stopped';
    return { searchId: id, status: 'stopped' };
  }

  list(owner: string) {
    return [...this.items.values()]
      .filter(s => s.owner === owner)
      .map(({ results, owner: _, ...meta }) => ({ ...meta, count: results.length }));
  }

  stopAll() {
    for (const task of this.items.values()) if (task.status === 'running') task.status = 'stopped';
  }
}
