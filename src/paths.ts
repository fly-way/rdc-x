import fs from 'node:fs/promises';
import path from 'node:path';
import type { State } from './state.js';

export function within(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
const secretNames = /^(\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.gnupg|id_rsa|id_ed25519|\.rdc)$/i;
export class PathGuard {
  constructor(readonly state: State) {}
  async resolve(input: string, write = false, missing = false): Promise<string> {
    if (!input || input.includes('\0') || input.split(/[\\/]/).includes('..')) throw new Error('Invalid or traversing path.');
    if (process.platform === 'win32') {
      if (input.startsWith('\\\\') || input.startsWith('//') || /:(?![\\/])/.test(input.slice(2)))
        throw new Error('UNC, device paths and alternate data streams are not allowed.');
      if (input.split(/[\\/]/).some(p => /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p) || /[. ]$/.test(p)))
        throw new Error('Windows device names and ambiguous trailing characters are not allowed.');
    }
    const roots = this.state.config.roots;
    if (!roots.length) throw new Error('No directories have been authorized.');
    const candidate = path.resolve(path.isAbsolute(input) ? input : path.join(roots[0]!.path, input));
    if (candidate.split(path.sep).some(part => secretNames.test(part))) throw new Error('Protected credentials path.');
    // The server cannot rewrite its own policy, code, launchers or secrets through file tools.
    if (within(this.state.base, candidate) && !within(path.join(this.state.base, 'workspace'), candidate))
      throw new Error('RDC-X application files are protected; only its workspace is accessible.');
    const root = roots.find(r => within(path.resolve(r.path), candidate) && (!write || r.write));
    if (!root) throw new Error(write ? 'Path is outside writable roots.' : 'Path is outside allowed roots.');
    let current = path.parse(candidate).root;
    let firstMissing = false;
    for (const part of candidate.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (firstMissing) continue;
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed.');
        if (stat.isFile() && stat.nlink > 1) throw new Error('Hard-linked files are not allowed.');
      } catch (e: any) {
        if (missing && e.code === 'ENOENT') firstMissing = true; else throw e;
      }
    }
    // Canonical path comparison also catches short-name / mount alias escapes.
    const canonicalRoot = await fs.realpath(root.path);
    let ancestor = candidate;
    while (true) {
      try {
        const canonical = await fs.realpath(ancestor);
        if (!within(canonicalRoot, canonical)) throw new Error('Canonical path escapes the allowed root.');
        break;
      } catch (e: any) {
        if (missing && e.code === 'ENOENT' && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
        else throw e;
      }
    }
    return candidate;
  }
}
