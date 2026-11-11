import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { files, inside, exists } from '../shared/content.mjs';

export class InvalidSkill extends Error { code = 'INVALID_SKILL'; }
export function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new InvalidSkill('missing YAML frontmatter');
  try { return parse(match[1]); } catch (error) { throw new InvalidSkill(`invalid YAML: ${error.message}`); }
}

export async function discover(root) {
  const result = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || ['node_modules', 'runtime'].includes(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (await exists(path.join(child, 'SKILL.md'))) {
        let id = entry.name, error;
        try {
          id = frontmatter(await readFile(path.join(child, 'SKILL.md'), 'utf8')).name;
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) throw new InvalidSkill('invalid skill name');
          if (id !== entry.name) throw new InvalidSkill('skill name must match directory');
        } catch (e) { error = e.message; id = entry.name; }
        result.push({ id, dir: child, relative: path.relative(root, child).split(path.sep).join('/'), error });
      } else await visit(child);
    }
  }
  await visit(root);
  const counts = new Map();
  for (const item of result) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  for (const item of result) if (counts.get(item.id) > 1) item.error = `duplicate skill name: ${item.id}`;
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function validateSkill(dir, id, { generated = false } = {}) {
  try {
    const names = await files(dir, '', true);
    const meta = frontmatter(await readFile(path.join(dir, 'SKILL.md'), 'utf8'));
    if (meta.name !== id || typeof meta.description !== 'string' || !meta.description.trim()) throw new InvalidSkill('name/description invalid');
    const reserved = ['workflow.md', '.loopit-skill.json', 'scripts/entry.mjs', 'scripts/runtime.mjs', 'scripts/invoke.mjs', 'THIRD_PARTY_NOTICES.txt'];
    if (!generated && names.some(n => n === 'scripts' || reserved.some(r => n === r || n.startsWith(`${r}/`)))) throw new InvalidSkill('reserved generated package path');
    for (const name of names.filter(n => n.endsWith('.md'))) {
      const text = await readFile(path.join(dir, name), 'utf8');
      const targets = [...text.matchAll(/\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g)].map(m => m[1].replace(/^<|>$/g, ''));
      targets.push(...[...text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map(m => m[1]));
      for (const target of targets) {
        if (/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(target)) continue;
        let local;
        try { local = decodeURIComponent(target.split(/[?#]/)[0]); }
        catch { throw new InvalidSkill(`malformed link URI: ${name} → ${target}`); }
        if (!local) continue;
        const resource = path.resolve(path.dirname(path.join(dir, name)), local);
        if (!inside(dir, resource)) throw new InvalidSkill(`link outside skill: ${name} → ${target}`);
        if (!await exists(resource)) throw new InvalidSkill(`missing reference: ${name} → ${target}`);
        await stat(resource);
      }
    }
    if (generated) for (const file of reserved.slice(0, 5)) {
      if (!names.includes(file)) throw new InvalidSkill(`missing generated file: ${file}`);
    }
  } catch (error) {
    if (error instanceof InvalidSkill) throw error;
    if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code) || /symlink|Skills-excluded/.test(error.message)) throw new InvalidSkill(error.message);
    throw error;
  }
}
