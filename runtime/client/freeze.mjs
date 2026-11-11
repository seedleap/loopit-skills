import { mkdir, mkdtemp, cp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentHash, exists } from '../shared/content.mjs';

export async function freezeBase(ctx) {
  const hash = await contentHash(ctx.root);
  let snapshot = path.join(ctx.state, 'snapshots', `base-${hash}`);
  if (await exists(snapshot)) {
    if (await contentHash(snapshot) === hash) return snapshot;
    snapshot += `-${randomUUID()}`;
  }
  await mkdir(path.dirname(snapshot), { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(path.join(ctx.state, 'freeze-'));
  const candidate = path.join(temporary, 'package');
  try {
    await cp(ctx.root, candidate, { recursive: true });
    if (await contentHash(candidate) !== hash) throw new Error('installation changed while freezing');
    try { await rename(candidate, snapshot); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      if (await contentHash(snapshot) !== hash) { snapshot += `-${randomUUID()}`; await rename(candidate, snapshot); }
    }
    return snapshot;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
