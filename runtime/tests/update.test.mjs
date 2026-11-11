import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, readdir, cp, mkdir, chmod, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { resolveSource, installSkills } from 'skills';
import { fixture, waitFor, json } from './helpers.mjs';
import { publish } from '../publish/release.mjs';
import { fileMap } from '../shared/content.mjs';
const exec = promisify(execFile);

async function setup(t) {
  const f = await fixture(t);
  const release = () => publish({ repo: f.repo, sourceRef: 'main', repository: f.repository, push: true });
  await release();
  const installed = path.join(f.root, 'installed');
  const source = await resolveSource(f.repository, { ref: 'skill/a/v1.0.0' });
  try {
    const result = await installSkills(source, { cwd: installed, skills: ['a', 'b', 'c'], agents: ['universal'],
      scope: 'project', mode: 'copy', lockfile: false, telemetry: false, duplicates: 'error', symlinks: 'reject' });
    assert.equal(result.failed.length, 0);
  } finally { await source.dispose(); }
  const requests = [];
  let delay = 0, corrupt = false;
  const server = createServer(async (req, res) => {
    requests.push(req.url);
    const descriptor = await f.descriptor(req.url.slice(1, -5));
    if (corrupt) descriptor.contentHash = '0'.repeat(64);
    setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(descriptor)); }, delay);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env, LOOPIT_SKILLS_STATE_DIR: path.join(f.root, 'state'),
    LOOPIT_SKILLS_RELEASE_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_TELEMETRY: '1' };
  const root = id => path.join(installed, '.agents/skills', id);
  const invoke = async (id = 'a', extra = [], customEnv = {}) => JSON.parse((await exec(process.execPath,
    [path.join(root(id), 'scripts/entry.mjs'), ...extra], { env: { ...env, ...customEnv }, timeout: 5000 })).stdout);
  const finish = async receipt => waitFor(async () => {
    const result = await json(path.join(receipt.statePath, 'last-check.json'));
    return result.invocationId === receipt.invocationId && result.result !== 'checking' && result;
  });
  return { ...f, release, root, invoke, finish, env, requests, setDelay: n => { delay = n; }, setCorrupt: n => { corrupt = n; } };
}

test('detached update never waits for network, pins N, only touches A, next invocation uses N+1', async t => {
  const f = await setup(t);
  for (const id of ['a', 'b', 'c']) await f.change(id, `new ${id}`);
  const sourceSkill = path.join(f.repo, 'domain/skills/a/SKILL.md');
  await writeFile(sourceSkill, (await readFile(sourceSkill, 'utf8')).replace('description: Test a', 'description: Updated trigger a'));
  await f.commit('all skills updated'); await f.release();
  const bBefore = await fileMap(f.root('b')), cBefore = await fileMap(f.root('c'));
  f.setDelay(2500);
  const start = Date.now(), first = await f.invoke();
  assert.ok(Date.now() - start < 1500, 'entry waited for the network');
  assert.equal(first.version, '1.0.0');
  assert.equal(first.frontendPath, path.join(first.installationRoot, 'scripts/invoke.mjs'));
  assert.equal((await f.invoke('a', ['--status'])).version, '1.0.0');
  await waitFor(() => f.requests.length > 0);
  const early = await f.invoke();
  assert.equal(early.version, '1.0.0');
  assert.equal((await f.finish(first)).result, 'updated');
  f.setDelay(0);
  const second = await f.invoke();
  assert.equal(second.version, '1.0.1');
  assert.notEqual(second.workflowPath, first.workflowPath);
  assert.equal(second.frontendPath, await realpath(path.join(second.resourcesRoot, 'scripts/invoke.mjs')));
  assert.match(await readFile(path.join(f.root('a'), 'SKILL.md'), 'utf8'), /Updated trigger a/);
  assert.doesNotMatch(await readFile(path.join(first.resourcesRoot, 'SKILL.md'), 'utf8'), /Updated trigger a/);
  assert.equal((await f.invoke('a', ['--status'])).modified, false);
  assert.equal(await readFile(path.join(first.resourcesRoot, 'references/rules.md'), 'utf8'), 'initial\n');
  assert.equal(await readFile(path.join(second.resourcesRoot, 'references/rules.md'), 'utf8'), 'new a');
  await f.finish(second);
  assert.ok(f.requests.every(request => request === '/a.json'));
  assert.deepEqual(await fileMap(f.root('b')), bBefore);
  assert.deepEqual(await fileMap(f.root('c')), cBefore);
  assert.equal((await readdir(f.env.LOOPIT_SKILLS_STATE_DIR)).length, 1);
  assert.equal((await readdir(first.statePath)).some(n => n.startsWith('staging-')), false);
});

test('corrupt download, offline, timeout and local changes retain the installed version', async t => {
  const f = await setup(t);
  await f.change('a', 'new a'); await f.commit('new a'); await f.release();
  f.setCorrupt(true);
  let receipt = await f.invoke();
  assert.equal((await f.finish(receipt)).code, 'INTEGRITY_FAILED');
  assert.equal((await f.invoke('a', ['--status'])).version, '1.0.0');
  f.setCorrupt(false); f.setDelay(2000);
  receipt = await f.invoke('a', [], { LOOPIT_SKILLS_TIMEOUT_MS: '150' });
  await waitFor(async () => (await json(path.join(receipt.statePath, 'last-check.json'))).result === 'checking');
  assert.equal((await f.finish(receipt)).code, 'TIMEOUT');
  assert.equal((await readdir(receipt.statePath)).some(n => n.startsWith('staging-')), false);
  receipt = await f.invoke('a', [], { LOOPIT_SKILLS_RELEASE_BASE_URL: 'http://127.0.0.1:1' });
  const offline = await f.finish(receipt);
  assert.equal(offline.result, 'failed');
  assert.equal(offline.code, 'NETWORK_UNAVAILABLE');
  await writeFile(path.join(f.root('a'), 'references/rules.md'), 'user edit');
  receipt = await f.invoke();
  await waitFor(async () => (await json(path.join(receipt.statePath, 'last-check.json'))).code === 'LOCAL_MODIFIED');
  assert.equal(await readFile(path.join(f.root('a'), 'references/rules.md'), 'utf8'), 'user edit');
  assert.equal(receipt.version, '1.0.0');
});

test('deadline kills the Git download process group before cleaning staging', { skip: process.platform === 'win32' }, async t => {
  const f = await setup(t);
  await f.change('a', 'new a'); await f.commit('new a'); await f.release();
  const bin = path.join(path.dirname(f.env.LOOPIT_SKILLS_STATE_DIR), 'slow-bin');
  const pidFile = path.join(bin, 'download.pid');
  await mkdir(bin);
  const actualGit = (await exec('which', ['git'])).stdout.trim();
  await writeFile(path.join(bin, 'git'), `#!${process.execPath}\nconst {spawn,spawnSync}=require('node:child_process');const fs=require('node:fs');if(process.argv.includes('clone')){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);}else{const r=spawnSync(${JSON.stringify(actualGit)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);}\n`);
  await chmod(path.join(bin, 'git'), 0o755);
  const receipt = await f.invoke('a', [], { PATH: `${bin}${path.delimiter}${process.env.PATH}`, LOOPIT_SKILLS_TIMEOUT_MS: '2000' });
  const pids = await waitFor(() => json(pidFile));
  assert.equal((await f.finish(receipt)).code, 'TIMEOUT');
  for (const pid of pids) await waitFor(() => {
    try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
  }, 3000);
  assert.equal((await readdir(receipt.statePath)).some(n => n.startsWith('staging-')), false);
  assert.equal((await f.invoke('a', ['--status'])).version, '1.0.0');
});

test('supervisor interruption preserves N, cleans its stage, and a later invocation retries', { skip: process.platform === 'win32' }, async t => {
  const f = await setup(t);
  await f.change('a', 'new a'); await f.commit('new a'); await f.release();
  f.setDelay(2500);
  const worker = spawn(process.execPath, [path.join(f.root('a'), 'scripts/runtime.mjs'), 'worker', f.root('a'), 'interrupted'], { env: f.env, stdio: 'ignore' });
  const exited = new Promise(resolve => worker.once('exit', resolve));
  await waitFor(() => f.requests.length === 1);
  worker.kill('SIGTERM');
  await exited;
  const receipt = await f.invoke('a', ['--status']);
  assert.equal(receipt.version, '1.0.0');
  assert.equal(receipt.lastCheck.code, 'INTERRUPTED');
  assert.equal((await readdir(receipt.statePath)).some(n => n.startsWith('staging-')), false);
  f.setDelay(0);
  assert.equal((await f.finish(await f.invoke())).result, 'updated');
});

test('parallel invocations share one lock; project/global same ID have independent state', async t => {
  const f = await setup(t);
  await f.change('a', 'new a'); await f.commit('new a'); await f.release();
  f.setDelay(1200);
  const receipts = await Promise.all(Array.from({ length: 5 }, () => f.invoke()));
  await waitFor(async () => (await json(path.join(receipts[0].statePath, 'last-check.json'))).result === 'updated');
  assert.equal(f.requests.length, 1);
  assert.ok(receipts.every(r => r.version === '1.0.0'));
  const other = path.join(path.dirname(f.env.LOOPIT_SKILLS_STATE_DIR), 'global/a');
  await mkdir(path.dirname(other), { recursive: true });
  await cp(f.root('a'), other, { recursive: true });
  const status = JSON.parse((await exec(process.execPath, [path.join(other, 'scripts/entry.mjs'), '--status'], { env: f.env })).stdout);
  assert.notEqual(status.statePath, receipts[0].statePath);
  assert.equal(status.version, '1.0.0');
});

test('a damaged upgraded frontend falls back to the usable base and status remains available', async t => {
  const f = await setup(t);
  await f.change('a', 'new a'); await f.commit('new a'); await f.release();
  await f.finish(await f.invoke());
  const upgraded = await f.invoke('a', ['--status']);
  await rm(path.join(upgraded.resourcesRoot, 'scripts/invoke.mjs'));
  const safe = await f.invoke('a', ['--status']);
  assert.equal(safe.version, '1.0.0');
  assert.equal(safe.frontendError, 'CORRUPT_FRONTEND');
});
