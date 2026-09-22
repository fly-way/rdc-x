import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { random, type State } from './state.js';
import { PathGuard } from './paths.js';

export class FileService {
  guard: PathGuard;
  constructor(private state: State) { this.guard = new PathGuard(state); }

  async text(input: string) {
    const target = await this.guard.resolve(input);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('Expected a regular file.');
    if (stat.size > this.state.config.maxFileBytes) throw new Error('File exceeds the configured size limit.');
    const buffer = await fs.readFile(target);
    if (buffer.length > this.state.config.maxFileBytes || buffer.includes(0))
      throw new Error('Binary or oversized file; use a format-specific reader.');
    return { target, text: buffer.toString('utf8') };
  }

  async read(input: string, offset = 0, length = 200) {
    const { target, text } = await this.text(input);
    const lines = text.split(/\r?\n/);
    const start = offset < 0 ? Math.max(0, lines.length + offset) : offset;
    return {
      path: target, totalLines: lines.length, offset: start,
      lines: lines.slice(start, start + length),
      nextOffset: start + length < lines.length ? start + length : null
    };
  }

  async info(input: string) {
    const target = await this.guard.resolve(input);
    const stat = await fs.stat(target);
    return {
      path: target,
      type: stat.isDirectory() ? 'directory' : 'file',
      bytes: stat.size,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString()
    };
  }

  async hash(input: string, algorithm: 'sha256' | 'sha512' = 'sha256', maxBytes = 512 * 1024 * 1024) {
    const target = await this.guard.resolve(input);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('Expected a regular file.');
    if (stat.size > maxBytes) throw new Error('File exceeds the requested hashing size limit.');
    const digest = crypto.createHash(algorithm);
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(target);
      stream.on('data', chunk => digest.update(chunk));
      stream.on('error', reject);
      stream.on('end', resolve);
    });
    return { path: target, bytes: stat.size, algorithm, digest: digest.digest('hex') };
  }

  async list(input: string, depth = 1, limit = 500) {
    const root = await this.guard.resolve(input);
    const entries: unknown[] = [];
    let truncated = false;
    const walk = async (dir: string, level: number): Promise<void> => {
      const children = await fs.readdir(dir, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (entries.length >= limit) { truncated = true; return; }
        const full = path.join(dir, child.name);
        try { await this.guard.resolve(full); } catch { continue; }
        entries.push({ path: path.relative(root, full), type: child.isDirectory() ? 'directory' : 'file' });
        if (child.isDirectory() && level < depth) await walk(full, level + 1);
      }
    };
    await walk(root, 1);
    return { root, entries, truncated };
  }

  async image(input: string) {
    const target = await this.guard.resolve(input);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > this.state.config.maxFileBytes) throw new Error('Image is too large or not a file.');
    const bytes = await fs.readFile(target);
    let mime: string;
    if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg';
    else if (bytes.subarray(0, 6).toString().startsWith('GIF8')) mime = 'image/gif';
    else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
    else throw new Error('Supported images: PNG, JPEG, GIF and WebP.');
    return { content: [{ type: 'image' as const, mimeType: mime, data: bytes.toString('base64') }] };
  }

  async backup(target: string, kind = 'backups') {
    const name = `${Date.now()}-${random(8)}-${path.basename(target)}`;
    const destination = path.join(this.state.dataDir, kind, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(target, destination);
    this.state.audit('file_backup', 'created', { original: target, backup: destination });
    return destination;
  }

  async write(input: string, content: string, mode: 'create' | 'overwrite' | 'append') {
    const target = await this.guard.resolve(input, true, true);
    let previous = '';
    try {
      await fs.stat(target);
      if (mode === 'create') throw new Error('File already exists; select overwrite explicitly.');
      previous = (await this.text(target)).text;
      await this.backup(target);
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }

    const text = mode === 'append' ? previous + content : content;
    if (Buffer.byteLength(text) > this.state.config.maxFileBytes) throw new Error('Result exceeds file size limit.');
    await this.guard.resolve(path.dirname(target), true);

    const temp = `${target}.${random(6)}.rdc-tmp`;
    try {
      await fs.writeFile(temp, text, { flag: 'wx' });
      await this.guard.resolve(target, true, true);
      if (mode === 'create') {
        await fs.copyFile(temp, target, fs.constants.COPYFILE_EXCL);
        await fs.unlink(temp);
      } else {
        await fs.rename(temp, target);
      }
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    return { path: target, bytes: Buffer.byteLength(text), mode };
  }

  async edit(input: string, oldText: string, newText: string, expected: number) {
    await this.guard.resolve(input, true);
    const { text } = await this.text(input);
    const count = text.split(oldText).length - 1;
    if (count !== expected) throw new Error(`Expected ${expected} exact occurrences; found ${count}. No changes made.`);
    return this.write(input, text.split(oldText).join(newText), 'overwrite');
  }

  async mkdir(input: string) {
    const target = await this.guard.resolve(input, true, true);
    await fs.mkdir(target, { recursive: true });
    return { path: target };
  }

  private async assertMissing(target: string) {
    try {
      await fs.lstat(target);
      throw new Error('Destination already exists.');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  private async assertSafeTree(target: string, counter = { value: 0 }, applyPathPolicy = true): Promise<void> {
    if (++counter.value > 100000) throw new Error('Directory tree is too large to validate safely.');
    if (applyPathPolicy) await this.guard.resolve(target);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('Symbol links and junctions cannot be copied or moved.');
    if (stat.isFile() && stat.nlink > 1) throw new Error('Hard-linked files cannot be copied or moved.');
    if (!stat.isDirectory()) return;
    for (const entry of await fs.readdir(target))
      await this.assertSafeTree(path.join(target, entry), counter, applyPathPolicy);
  }

  async copy(source: string, destination: string) {
    const from = await this.guard.resolve(source);
    const to = await this.guard.resolve(destination, true, true);
    await this.guard.resolve(path.dirname(to), true);
    await this.assertMissing(to);
    await this.assertSafeTree(from);
    const stat = await fs.stat(from);
    await fs.cp(from, to, { recursive: stat.isDirectory(), errorOnExist: true, force: false, dereference: false });
    return { source: from, destination: to, type: stat.isDirectory() ? 'directory' : 'file' };
  }

  async move(source: string, destination: string) {
    const from = await this.guard.resolve(source, true);
    const to = await this.guard.resolve(destination, true, true);
    await this.guard.resolve(path.dirname(to), true);
    await this.assertMissing(to);
    await this.assertSafeTree(from);
    const stat = await fs.stat(from);
    try {
      await fs.rename(from, to);
    } catch (e: any) {
      if (e.code !== 'EXDEV') throw e;
      await fs.cp(from, to, { recursive: stat.isDirectory(), errorOnExist: true, force: false, dereference: false });
      await fs.rm(from, { recursive: stat.isDirectory(), force: false });
    }
    return { source: from, destination: to, type: stat.isDirectory() ? 'directory' : 'file' };
  }

  async trash(input: string) {
    const target = await this.guard.resolve(input, true);
    await this.assertSafeTree(target);
    const stat = await fs.stat(target);
    const trashId = `${Date.now()}-${random(8)}-${path.basename(target)}`;
    const recoveryPath = path.join(this.state.dataDir, 'trash', trashId);
    await fs.mkdir(path.dirname(recoveryPath), { recursive: true });
    try {
      await fs.rename(target, recoveryPath);
    } catch (e: any) {
      if (e.code !== 'EXDEV') throw e;
      await fs.cp(target, recoveryPath, { recursive: stat.isDirectory(), errorOnExist: true, force: false, dereference: false });
      await fs.rm(target, { recursive: stat.isDirectory(), force: false });
    }
    this.state.audit('file_trash', 'created', { original: target, trashId });
    return { path: target, trashId, type: stat.isDirectory() ? 'directory' : 'file', permanentlyDeleted: false };
  }

  async listTrash(limit = 100) {
    const root = path.join(this.state.dataDir, 'trash');
    let names: string[] = [];
    try { names = await fs.readdir(root); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    const items = [];
    for (const name of names.sort().reverse().slice(0, limit)) {
      const stat = await fs.stat(path.join(root, name));
      items.push({ trashId: name, type: stat.isDirectory() ? 'directory' : 'file', bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
    return { items };
  }

  async restoreTrash(trashId: string, destination: string) {
    if (!/^[A-Za-z0-9._-]{1,300}$/.test(trashId) || trashId.includes('..')) throw new Error('Invalid trashId.');
    const source = path.join(this.state.dataDir, 'trash', trashId);
    const stat = await fs.stat(source);
    const target = await this.guard.resolve(destination, true, true);
    await this.guard.resolve(path.dirname(target), true);
    await this.assertMissing(target);
    await this.assertSafeTree(source, { value: 0 }, false);
    await fs.cp(source, target, { recursive: stat.isDirectory(), errorOnExist: true, force: false, dereference: false });
    return { trashId, destination: target, type: stat.isDirectory() ? 'directory' : 'file' };
  }
}
