import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { terminateProcessTree } from '../client/process-tree.mjs';
import { context } from '../client/local.mjs';
import { fileMap, exists } from '../shared/content.mjs';
import { waitFor } from './helpers.mjs';

test('Windows adapter waits for the termination command acknowledgement', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'loopit-taskkill-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'bin'));
  const command = path.join(root, 'bin/taskkill');
  await writeFile(command, `#!${process.execPath}\nconst pid=Number(process.argv[process.argv.indexOf('/pid')+1]);setTimeout(()=>{try{process.kill(pid,'SIGKILL')}catch{};},250);\n`);
  await chmod(command, 0o755);
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const module = new URL('../client/process-tree.mjs', import.meta.url).href;
  const started = Date.now();
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `const {terminateProcessTree}=await import(${JSON.stringify(module)});await terminateProcessTree(${child.pid},'win32');`],
  { env: { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}` } });
  assert.ok(Date.now() - started >= 250);
  await exited;
  assert.equal(child.signalCode, 'SIGKILL');
});

test('missing process group is already terminated', async () => {
  if (process.platform !== 'win32') await terminateProcessTree(2147483647);
});

test('termination failure bounds supervisor lifetime, preserves staging and releases its lock', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'loopit-kill-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = path.join(root, 'base'); await mkdir(base);
  await writeFile(path.join(base, 'workflow.md'), 'usable base');
  await writeFile(path.join(base, '.loopit-skill.json'), JSON.stringify({ schema: 1, id: 'example', version: '1.0.0', files: await fileMap(base) }));
  const ctx = await context(base, path.join(root, 'state'));
  const bin = path.join(root, 'bin'); await mkdir(bin);
  await writeFile(path.join(bin, 'taskkill'), `#!${process.execPath}\nprocess.exit(1);\n`); await chmod(path.join(bin, 'taskkill'), 0o755);
  const marker = path.join(root, 'stage.pid');
  const stage = path.join(root, 'blocked-stage.mjs');
  await writeFile(stage, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`);
  const module = new URL('../client/supervisor.mjs', import.meta.url).href;
  const parent = spawn(process.execPath, ['--input-type=module', '-e',
    `const {supervise}=await import(${JSON.stringify(module)});Object.defineProperty(process,'platform',{value:'win32'});await supervise(${JSON.stringify(base)},${JSON.stringify(stage)},'kill-failure');`],
  { stdio: 'ignore', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, LOOPIT_SKILLS_STATE_DIR: path.join(root, 'state'), LOOPIT_SKILLS_TIMEOUT_MS: '100' } });
  let stagePid;
  t.after(() => { parent.kill('SIGKILL'); if (stagePid) { try { process.kill(-stagePid, 'SIGKILL'); } catch {} } });
  const exited = new Promise(resolve => parent.once('exit', code => resolve(code)));
  stagePid = await waitFor(async () => Number(await readFile(marker, 'utf8')));
  let timer;
  const result = await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve('not bounded'), 2000); })]);
  clearTimeout(timer);
  const status = JSON.parse(await readFile(path.join(ctx.state, 'last-check.json')));
  assert.equal(status.code, 'PROCESS_TERMINATION_FAILED');
  assert.equal(await exists(path.join(ctx.state, 'update.lock')), false);
  assert.equal(result, 0);
  assert.ok((await (await import('node:fs/promises')).readdir(ctx.state)).some(n => n.startsWith('staging-')));
});
