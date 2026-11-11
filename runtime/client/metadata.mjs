import path from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import semver from 'semver';
import { fileMap, inside, readJson, contentHash, exists } from '../shared/content.mjs';
import { writeText } from '../shared/io.mjs';

export const hostFiles = ['SKILL.md', 'agents/openai.yaml'];

export async function readActive(ctx) {
  const file = path.join(ctx.state, 'active.json');
  if (!await exists(file)) return null;
  const active = await readJson(file);
  const root = path.resolve(ctx.state, active.snapshot);
  if (!inside(path.join(ctx.state, 'snapshots'), root) || root === path.join(ctx.state, 'snapshots')) throw new Error('invalid snapshot pointer');
  const info = await readJson(path.join(root, '.loopit-skill.json'));
  if (active.schema !== 1 || active.id !== ctx.info.id || info.id !== ctx.info.id || info.version !== active.version
    || info.repository !== ctx.info.repository || info.releaseBranch !== ctx.info.releaseBranch
    || !await exists(path.join(root, 'workflow.md'))) throw new Error('invalid snapshot identity');
  return semver.gt(info.version, ctx.info.version) ? { root, info, active } : null;
}

export async function installationIntact(ctx, pointer) {
  try {
    const actual = await fileMap(ctx.root), expected = ctx.info.files;
    for (const name of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const allowed = hostFiles.includes(name) ? pointer?.hostFiles?.[name] || [] : [];
      if (actual[name] !== expected[name] && !allowed.includes(actual[name] ?? null)) return false;
    }
    return true;
  } catch { return false; }
}

export async function metadataTransition(ctx, candidateInfo) {
  const previous = await readActive(ctx);
  return Object.fromEntries(hostFiles.map(name => [name, [...new Set([ctx.info.files[name] ?? null,
    ...(previous?.active.hostFiles?.[name] || []), candidateInfo.files[name] ?? null])]]));
}

export async function refreshMetadata(ctx) {
  try {
    const selected = await readActive(ctx);
    if (!selected) return false;
    const { active: pointer, root: snapshot, info } = selected;
    if (!await installationIntact(ctx, pointer)
      || await contentHash(snapshot) !== pointer.contentHash) return false;
    for (const name of hostFiles) {
      const actual = (await fileMap(ctx.root))[name] ?? null;
      if (!pointer.hostFiles?.[name]?.includes(actual)) return false;
      const next = info.files[name] ?? null;
      if (actual === next) continue;
      if (next === null) await unlink(path.join(ctx.root, name));
      else await writeText(path.join(ctx.root, name), await readFile(path.join(snapshot, name)));
    }
    return true;
  } catch { return false; }
}
