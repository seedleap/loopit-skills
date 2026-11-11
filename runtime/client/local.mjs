import { realpath, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import semver from 'semver';
import { readJson, sha256, intact, inside, exists, contentHash } from '../shared/content.mjs';
import { writeJson } from '../shared/io.mjs';
import { installationIntact, metadataTransition, refreshMetadata, readActive } from './metadata.mjs';
import { freezeBase } from './freeze.mjs';

export async function context(installation, stateBase = process.env.LOOPIT_SKILLS_STATE_DIR) {
  const root = await realpath(installation);
  const info = await readJson(path.join(root, '.loopit-skill.json'));
  if (info.schema !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(info.id) || !semver.valid(info.version)) throw new Error('invalid installed skill identity');
  const base = stateBase || path.join(homedir(), '.local/state/loopit-skills');
  const state = path.join(path.resolve(base), sha256(`${root}\0${info.id}`));
  return { root, info, state };
}

export async function selection(ctx, { freeze = false, ignoreActive = false } = {}) {
  let selected = { root: ctx.root, info: ctx.info };
  let pointerError = ignoreActive;
  let active;
  try { active = await readActive(ctx); } catch { pointerError = true; }
  const baseModified = !await installationIntact(ctx, active?.active);
  if (!baseModified && active && !ignoreActive) selected = active;
  const modified = baseModified || !await intact(selected.root, selected.info)
    || Boolean(selected.active && await contentHash(selected.root) !== selected.active.contentHash);
  if (freeze && !modified && selected.root === ctx.root) selected = { ...selected, root: await freezeBase(ctx) };
  return { invocationId: randomUUID(), id: ctx.info.id, version: selected.info.version,
    workflowPath: path.join(selected.root, 'workflow.md'), resourcesRoot: selected.root,
    installationRoot: ctx.root, statePath: ctx.state, modified, pointerError };
}

export async function status(ctx, options) {
  const current = await selection(ctx, options);
  let lastCheck = null;
  try { lastCheck = await readJson(path.join(ctx.state, 'last-check.json')); } catch (e) { if (e.code !== 'ENOENT') lastCheck = { result: 'unreadable-status' }; }
  let pendingVersion = null;
  if (lastCheck?.result === 'checking' && typeof lastCheck.staging === 'string' && inside(ctx.state, lastCheck.staging)) {
    try { pendingVersion = (await readJson(path.join(lastCheck.staging, 'pending.json'))).version; } catch {}
  }
  return { ...current, pendingVersion, lastCheck };
}

export async function activate(ctx, candidate, descriptor) {
  const current = await selection(ctx);
  if (current.modified || current.pointerError) throw Object.assign(new Error('local files modified'), { code: 'LOCAL_MODIFIED' });
  const info = await readJson(path.join(candidate, '.loopit-skill.json'));
  if (info.id !== ctx.info.id || info.version !== descriptor.version || !semver.gt(info.version, current.version)
    || !await intact(candidate, info) || await contentHash(candidate) !== descriptor.contentHash) throw new Error('invalid candidate');
  const relative = `snapshots/${descriptor.version}-${descriptor.contentHash}`;
  const destination = path.join(ctx.state, relative);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (!await exists(destination)) await rename(candidate, destination);
  else if (await contentHash(destination) !== descriptor.contentHash) throw new Error('existing snapshot corrupted');
  const managedHostFiles = await metadataTransition(ctx, info);
  if (!await installationIntact(ctx, await readActive(ctx).then(a => a?.active))) throw Object.assign(new Error('local files modified'), { code: 'LOCAL_MODIFIED' });
  await writeJson(path.join(ctx.state, 'active.json'), { schema: 1, ...descriptor, snapshot: relative,
    repository: ctx.info.repository, releaseBranch: ctx.info.releaseBranch,
    hostFiles: managedHostFiles, frontendHash: info.files['scripts/invoke.mjs'] });
  await refreshMetadata(ctx);
}
