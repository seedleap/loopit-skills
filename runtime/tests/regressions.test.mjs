import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fixture, git } from './helpers.mjs';
import { publish } from '../publish/release.mjs';
import { activationCommit } from '../publish/git.mjs';

test('first release anchors at activation even when a later job runs first; tested SHA bounds publishing', async t => {
  const f = await fixture(t);
  await f.change('a', 'second commit'); const second = await f.commit('second');
  await f.change('a', 'not tested yet'); const third = await f.commit('third');
  await publish({ repo: f.repo, sourceRef: second, baselineRef: f.head, repository: f.repository, push: true });
  assert.equal((await f.descriptor('a')).version, '1.0.1');
  assert.equal((await f.descriptor('a')).sourceCommit, second);
  assert.equal(await git(f.remote, 'show', 'skill/a/v1.0.0:skills/a/references/rules.md'), 'initial');
  await publish({ repo: f.repo, sourceRef: third, baselineRef: f.head, repository: f.repository, push: true });
  assert.equal((await f.descriptor('a')).version, '1.0.2');
});

test('activation anchor is the first workflow-bearing first-parent commit', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.repo, '.github/workflows'), { recursive: true });
  await writeFile(path.join(f.repo, '.github/workflows/skill-release.yml'), 'name: release\n');
  const activation = await f.commit('enable CI');
  await f.change('a', 'later'); const later = await f.commit('later');
  assert.equal(await activationCommit(f.repo, later), activation);
});

test('malformed URI and generated parent conflicts are isolated; Skills-excluded files are rejected', async t => {
  const f = await fixture(t);
  const run = () => publish({ repo: f.repo, sourceRef: 'main', repository: f.repository, push: true });
  await run();
  await f.change('a', '[malformed](100%.md)'); await f.change('b', 'valid b'); await f.commit('malformed URI');
  await run(); assert.equal((await f.descriptor('b')).version, '1.0.1');
  await f.change('a', 'valid a');
  await writeFile(path.join(f.repo, 'domain/skills/a/scripts'), 'file blocks generated directory');
  await f.change('b', 'valid b2'); await f.commit('scripts conflict');
  await run(); assert.equal((await f.descriptor('b')).version, '1.0.2');
  await git(f.repo, 'rm', 'domain/skills/a/scripts');
  await writeFile(path.join(f.repo, 'domain/skills/a/references/metadata.json'), '{}');
  await f.commit('excluded metadata');
  const result = await run();
  assert.ok(result.rejected.some(r => r.id === 'a'));
  assert.equal((await f.descriptor('a')).version, '1.0.0');
});

test('removing a duplicate retries changed valid content without requiring another edit', async t => {
  const f = await fixture(t);
  const run = () => publish({ repo: f.repo, sourceRef: 'main', repository: f.repository, push: true });
  await run();
  const duplicate = path.join(f.repo, 'other/skills/a');
  await mkdir(path.dirname(duplicate), { recursive: true });
  await cp(path.join(f.repo, 'domain/skills/a'), duplicate, { recursive: true });
  await f.change('a', 'changed during duplicate'); await f.commit('duplicate'); await run();
  assert.equal((await f.descriptor('a')).version, '1.0.0');
  await git(f.repo, 'rm', '-r', 'other'); await f.commit('remove duplicate'); await run();
  assert.equal((await f.descriptor('a')).version, '1.0.1');
});

test('Git ignore cannot omit packaged files, and published packages include applicable licenses', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.repo, 'domain/skills/a/.gitignore'), 'scripts/\n');
  await writeFile(path.join(f.repo, 'domain/LICENSE'), 'Copyright (c) Fixture Business\nMIT\n');
  await f.commit('package ignore and license');
  await publish({ repo: f.repo, sourceRef: 'main', repository: f.repository, push: true });
  assert.ok((await git(f.remote, 'ls-tree', '-r', '--name-only', 'skill/a/v1.0.0')).includes('skills/a/scripts/entry.mjs'));
  assert.match(await git(f.remote, 'show', 'skill/a/v1.0.0:skills/a/LICENSE'), /Fixture Business/);
  assert.match(await git(f.remote, 'show', 'skill/a/v1.0.0:skills/a/THIRD_PARTY_NOTICES.txt'), /signal-exit@4\.1\.0/);
});

test('invalid historical client syntax does not permanently block a later fixed commit', async t => {
  const f = await fixture(t);
  const run = () => publish({ repo: f.repo, sourceRef: 'main', repository: f.repository, push: true });
  await run();
  const original = await git(f.repo, 'show', 'HEAD:runtime/client/entry.mjs');
  await writeFile(path.join(f.repo, 'runtime/client/entry.mjs'), 'this is invalid JavaScript {{'); await f.commit('invalid syntax');
  await writeFile(path.join(f.repo, 'runtime/client/entry.mjs'), `${original}\n// fixed\n`); await f.commit('fix syntax');
  await run(); assert.equal((await f.descriptor('a')).version, '1.0.1');
});

test('historical packages use the packaging template from their own source commit', async t => {
  const f = await fixture(t);
  const build = path.join(f.repo, 'runtime/publish/build.mjs');
  const original = await git(f.repo, 'show', 'HEAD:runtime/publish/build.mjs');
  await writeFile(build, original.replace('# 每次调用入口', '# Future launcher'));
  await f.commit('change packaging template');
  await publish({ repo: f.repo, sourceRef: 'main', baselineRef: f.head, repository: f.repository, push: true });
  assert.doesNotMatch(await git(f.remote, 'show', 'skill/a/v1.0.0:skills/a/SKILL.md'), /Future launcher/);
  assert.match(await git(f.remote, 'show', 'skill/a/v1.0.1:skills/a/SKILL.md'), /Future launcher/);
});
