import { createHash } from 'node:crypto';
import { readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignored = new Set(['.git', '__pycache__', '__pypackages__']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const normalize = data => data.includes(0) ? data : Buffer.from(data.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

export async function files(root, prefix = '', strict = false) {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`symlink forbidden: ${relative}`);
    if (entry.isDirectory() && ignored.has(entry.name) || entry.name === 'metadata.json') {
      if (strict) throw new Error(`Skills-excluded path: ${relative}`);
      continue;
    }
    if (entry.isDirectory()) result.push(...await files(root, relative, strict));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`unsupported file: ${relative}`);
  }
  return result.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

// Skills 1.8.1 computedHash contract: path NUL length NUL normalized content.
export async function contentHash(root) {
  const hash = createHash('sha256');
  for (const name of await files(root)) {
    if (path.basename(name) === 'metadata.json') continue;
    const data = normalize(await readFile(path.join(root, name)));
    hash.update(name).update('\0').update(String(data.length)).update('\0').update(data);
  }
  return hash.digest('hex');
}

export async function fileMap(root) {
  const result = {};
  for (const name of await files(root)) {
    if (name !== '.loopit-skill.json') result[name] = sha256(normalize(await readFile(path.join(root, name))));
  }
  return result;
}

export async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function intact(root, info) {
  try { return JSON.stringify(await fileMap(root)) === JSON.stringify(info.files); }
  catch { return false; }
}
