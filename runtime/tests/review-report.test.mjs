import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { resolveSource, installSkills } from 'skills';
import { fixture, waitFor, json } from './helpers.mjs';
import { publish } from '../publish/release.mjs';
const exec = promisify(execFile);

test('real review-report package freezes its Python/assets/references and switches only on a later invocation', async t => {
  const f = await fixture(t);
  const id = 'review-report';
  const sourceDir = path.resolve('code-review-skills/skills', id);
  const imported = path.join(f.repo, 'code-review-skills/skills', id);
  await cp(sourceDir, imported, { recursive: true });
  await f.commit('导入审查报告包');
  const release = () => publish({ repo: f.repo, sourceRef: 'main', repository: f.repository, push: true });
  await release();
  const descriptor = await f.descriptor(id);
  const source = await resolveSource(f.repository, { ref: descriptor.tag });
  try {
    const installed = await installSkills(source, { cwd: path.join(f.root, 'installed'), skills: [id], agents: ['universal'],
      scope: 'project', mode: 'copy', lockfile: false, telemetry: false, duplicates: 'error', symlinks: 'reject' });
    assert.equal(installed.failed.length, 0);
  } finally { await source.dispose(); }
  const installation = path.join(f.root, 'installed/.agents/skills', id);
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push(req.url);
    res.end(JSON.stringify(await f.descriptor(id)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', LOOPIT_SKILLS_STATE_DIR: path.join(f.root, 'state'),
    LOOPIT_SKILLS_RELEASE_BASE_URL: `http://127.0.0.1:${server.address().port}` };
  const invoke = async (args = [], overrides = {}) => JSON.parse((await exec(process.execPath,
    [path.join(installation, 'scripts/entry.mjs'), ...args], { env: { ...env, ...overrides }, timeout: 5000 })).stdout);
  const finish = receipt => waitFor(async () => {
    const result = await json(path.join(receipt.statePath, 'last-check.json'));
    return result.invocationId === receipt.invocationId && result.result !== 'checking' && result;
  });
  const first = await invoke();
  assert.equal(first.version, descriptor.version);
  assert.equal(first.modified, false);
  assert.match(await readFile(first.workflowPath, 'utf8'), /references\/file-change-review\.md/);
  assert.match(await readFile(path.join(installation, 'SKILL.md'), 'utf8'), /entry\.mjs/);
  assert.equal((await finish(first)).result, 'current');
  const reference = 'references/field-semantics-evidence.md';
  const original = await readFile(path.join(first.resourcesRoot, reference), 'utf8');
  await writeFile(path.join(imported, reference), original + '\n隔离更新回归标记。\n');
  await f.commit('更新包内参考');
  await release();
  const updating = await invoke();
  assert.equal(updating.version, first.version);
  assert.equal((await finish(updating)).result, 'updated');
  assert.equal(await readFile(path.join(first.resourcesRoot, reference), 'utf8'), original);
  const next = await invoke();
  assert.notEqual(next.version, first.version);
  assert.notEqual(next.resourcesRoot, first.resourcesRoot);
  assert.match(await readFile(path.join(next.resourcesRoot, reference), 'utf8'), /隔离更新回归标记/);
  await finish(next);
  // 已安装快照直接运行生成器，不依赖源码仓库的 Python 模块或个人 Skill。
  const output = path.join(f.root, 'report-output');
  await exec('python3', [path.resolve('code-review-skills/examples/generate.py'), '--skill-root', next.resourcesRoot,
    '--output-dir', output], { env });
  assert.match(await readFile(path.join(output, 'report.html'), 'utf8'), /final-issue-P1/);
  const offline = await invoke([], { LOOPIT_SKILLS_RELEASE_BASE_URL: 'http://127.0.0.1:1' });
  assert.equal(offline.version, next.version);
  assert.equal((await finish(offline)).code, 'NETWORK_UNAVAILABLE');
  assert.ok(requests.every(url => url === '/review-report.json'));
});
