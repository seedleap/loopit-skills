import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, cp, rename } from 'node:fs/promises';
import { fileMap, contentHash } from '../shared/content.mjs';
import { context, selection, activate, status } from '../client/local.mjs';
import { refreshMetadata, metadataTransition } from '../client/metadata.mjs';

test('freezes the old workflow, switches only the target installation, and protects local edits', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'loopit-local-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const a = path.join(temp, 'project/skill-a');
  const b = path.join(temp, 'global/skill-a');
  const stateBase = path.join(temp, 'state');
  await mkdir(a, { recursive: true });
  await writeFile(path.join(a, 'workflow.md'), 'version one');
  const info = { schema: 1, id: 'skill-a', version: '1.0.0', files: await fileMap(a) };
  await writeFile(path.join(a, '.loopit-skill.json'), JSON.stringify(info));
  await cp(a, b, { recursive: true });
  const ca = await context(a, stateBase), cb = await context(b, stateBase);
  assert.notEqual(ca.state, cb.state);
  const first = await selection(ca);
  const candidate = path.join(temp, 'candidate');
  await cp(a, candidate, { recursive: true });
  await writeFile(path.join(candidate, 'workflow.md'), 'version two');
  await writeFile(path.join(candidate, '.loopit-skill.json'), JSON.stringify({ ...info, version: '1.0.1', files: await fileMap(candidate) }));
  await activate(ca, candidate, { id: 'skill-a', version: '1.0.1', contentHash: await contentHash(candidate) });
  assert.equal((await selection(ca)).version, '1.0.1');
  assert.equal((await selection(cb)).version, '1.0.0');
  assert.equal(first.version, '1.0.0');
  assert.equal(first.workflowPath, path.join(ca.root, 'workflow.md'));
  await writeFile(path.join(a, 'workflow.md'), 'user change');
  assert.equal((await selection(ca)).workflowPath, path.join(ca.root, 'workflow.md'));
  assert.equal((await status(ca)).modified, true);
});

test('reinstalling a newer base must not select an older cached snapshot', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'loopit-reinstall-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const base = path.join(temp, 'installation');
  await mkdir(base);
  const packageAt = async (dir, version) => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'workflow.md'), version);
    await writeFile(path.join(dir, '.loopit-skill.json'), JSON.stringify({ schema: 1, id: 'example', version, files: await fileMap(dir) }));
  };
  await packageAt(base, '1.0.0');
  const ctx = await context(base, path.join(temp, 'state'));
  const candidate = path.join(temp, 'candidate');
  await packageAt(candidate, '1.0.1');
  await activate(ctx, candidate, { id: 'example', version: '1.0.1', contentHash: await contentHash(candidate) });
  await packageAt(base, '1.0.2');
  assert.equal((await selection(await context(base, path.join(temp, 'state')))).version, '1.0.2');
});

test('reusing a corrupt base snapshot creates a clean copy without overwriting the old path', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'loopit-freeze-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const base = path.join(temp, 'installation'); await mkdir(base);
  await writeFile(path.join(base, 'workflow.md'), 'clean');
  await writeFile(path.join(base, '.loopit-skill.json'), JSON.stringify({ schema: 1, id: 'example', version: '1.0.0', files: await fileMap(base) }));
  const ctx = await context(base, path.join(temp, 'state'));
  const first = await selection(ctx, { freeze: true });
  await writeFile(first.workflowPath, 'corrupted');
  const second = await selection(ctx, { freeze: true });
  assert.notEqual(second.workflowPath, first.workflowPath);
  assert.equal(await (await import('node:fs/promises')).readFile(second.workflowPath, 'utf8'), 'clean');
});

test('stale pointer never refreshes metadata after a newer manual reinstall', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'loopit-metadata-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const base = path.join(temp, 'installation');
  const create = async (dir, version, text) => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), text);
    await writeFile(path.join(dir, 'workflow.md'), version);
    await writeFile(path.join(dir, '.loopit-skill.json'), JSON.stringify({ schema: 1, id: 'example', version, files: await fileMap(dir) }));
  };
  await create(base, '1.0.0', 'old');
  const ctx = await context(base, path.join(temp, 'state'));
  const next = path.join(temp, 'next'); await create(next, '1.0.1', 'middle');
  await activate(ctx, next, { id: 'example', version: '1.0.1', contentHash: await contentHash(next) });
  await create(base, '1.0.2', 'old');
  const newer = await context(base, path.join(temp, 'state'));
  await refreshMetadata(newer);
  assert.equal((await selection(newer)).modified, false);
});

test('metadata whitelist never accepts a user edit made during promotion', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'loopit-edit-race-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const base = path.join(temp, 'installation'); await mkdir(base);
  await writeFile(path.join(base, 'SKILL.md'), 'old'); await writeFile(path.join(base, 'workflow.md'), 'old');
  const info = { schema: 1, id: 'example', version: '1.0.0', files: await fileMap(base) };
  await writeFile(path.join(base, '.loopit-skill.json'), JSON.stringify(info));
  const ctx = await context(base, path.join(temp, 'state'));
  await mkdir(path.join(ctx.state, 'snapshots'), { recursive: true });
  const next = path.join(temp, 'next'); await cp(base, next, { recursive: true });
  await writeFile(path.join(next, 'SKILL.md'), 'next metadata');
  await writeFile(path.join(next, '.loopit-skill.json'), JSON.stringify({ ...info, version: '1.0.1', files: await fileMap(next) }));
  const hash = await contentHash(next);
  const snapshot = `snapshots/1.0.1-${hash}`;
  await rename(next, path.join(ctx.state, snapshot));
  // Insert the edit at the promotion boundary without depending on fs.watch delivery timing.
  await writeFile(path.join(base, 'SKILL.md'), 'user edit');
  const candidateInfo = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(ctx.state, snapshot, '.loopit-skill.json')));
  await writeFile(path.join(ctx.state, 'active.json'), JSON.stringify({ schema: 1, id: 'example', version: '1.0.1',
    contentHash: hash, snapshot, hostFiles: await metadataTransition(ctx, candidateInfo) }));
  await refreshMetadata(ctx);
  assert.equal(await (await import('node:fs/promises')).readFile(path.join(base, 'SKILL.md'), 'utf8'), 'user edit');
});
