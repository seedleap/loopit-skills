import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { contentHash, fileMap } from '../shared/content.mjs';
import { discover, validateSkill } from '../publish/discover.mjs';
import { buildPackage, bundleRuntime } from '../publish/build.mjs';

async function sandbox(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'loopit-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function skill(root, id = 'example') {
  const dir = path.join(root, 'domain/skills', id);
  await mkdir(path.join(dir, 'references'), { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: Example skill\n---\n\nRead [guide](references/guide.md).\n`);
  await writeFile(path.join(dir, 'references/guide.md'), 'Business rule\n');
  return dir;
}

test('content fingerprint follows Skills API canonical path/content encoding', async t => {
  const root = await sandbox(t);
  await writeFile(path.join(root, 'a.txt'), 'hello\r\n');
  await writeFile(path.join(root, 'z.bin'), Buffer.from([0, 13, 10]));
  const expected = createHash('sha256').update('a.txt\0' + '6\0').update('hello\n')
    .update('z.bin\0' + '3\0').update(Buffer.from([0, 13, 10])).digest('hex');
  assert.equal(await contentHash(root), expected);
  assert.deepEqual(Object.keys(await fileMap(root)), ['a.txt', 'z.bin']);
  await symlink('a.txt', path.join(root, 'unsafe'));
  await assert.rejects(contentHash(root), /symlink/i);
});

test('discovers independent skills, rejects duplicate identity and escaping/missing links', async t => {
  const root = await sandbox(t);
  const dir = await skill(root);
  assert.deepEqual((await discover(root)).map(x => x.id), ['example']);
  await validateSkill(dir, 'example');
  await writeFile(path.join(dir, 'references/guide.md'), '[escape](../../../README.md)');
  await assert.rejects(validateSkill(dir, 'example'), /outside|escape/i);
  await writeFile(path.join(dir, 'references/guide.md'), '[missing](absent.md)');
  await assert.rejects(validateSkill(dir, 'example'), /missing/i);
  await skill(path.join(root, 'other'), 'example');
  const found = await discover(root);
  assert.ok(found.every(x => x.error?.includes('duplicate')));
});

test('published single skill retains workflow links and has a standalone launcher/runtime', async t => {
  const root = await sandbox(t);
  const dir = await skill(root);
  const original = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
  const target = path.join(root, 'output');
  const bundles = await bundleRuntime(process.cwd());
  const descriptor = await buildPackage({ dir, id: 'example', target, bundles,
    version: '1.0.0', sourceCommit: 'a'.repeat(40), repository: 'seedleap/loopit-skills' });
  assert.equal(await readFile(path.join(target, 'workflow.md'), 'utf8'), original);
  assert.match(await readFile(path.join(target, 'SKILL.md'), 'utf8'), /entry\.mjs/);
  await validateSkill(target, 'example', { generated: true });
  const info = JSON.parse(await readFile(path.join(target, '.loopit-skill.json')));
  assert.equal(info.version, '1.0.0');
  assert.equal(descriptor.contentHash, await contentHash(target));
  assert.equal(descriptor.tag, 'skill/example/v1.0.0');
  assert.ok(info.files['scripts/runtime.mjs']);
  assert.ok(!info.files['.loopit-skill.json']);
});
