import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, cp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);
export const git = async (cwd, ...args) => (await exec('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();

export async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'loopit-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'source'), remote = path.join(root, 'remote.git');
  await mkdir(repo);
  await git(root, 'init', '--bare', remote);
  await git(repo, 'init', '-b', 'main');
  await git(repo, 'config', 'user.name', 'Fixture');
  await git(repo, 'config', 'user.email', 'fixture@example.invalid');
  await git(repo, 'remote', 'add', 'origin', remote);
  await cp(path.resolve('runtime'), path.join(repo, 'runtime'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', '.gitignore']) await cp(path.resolve(name), path.join(repo, name));
  for (const id of ['a', 'b', 'c']) {
    const dir = path.join(repo, 'domain/skills', id);
    await mkdir(path.join(dir, 'references'), { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: Test ${id}\n---\nRead [rules](references/rules.md).\n`);
    await writeFile(path.join(dir, 'references/rules.md'), 'initial\n');
  }
  await writeFile(path.join(repo, 'README.md'), 'Fixture\n');
  const commit = async (message, author) => {
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', message, ...(author ? ['--author', `${author} <${author}@example.invalid>`] : []));
    return git(repo, 'rev-parse', 'HEAD');
  };
  const head = await commit('baseline');
  await git(repo, 'push', 'origin', 'main');
  const change = async (id, text) => writeFile(path.join(repo, 'domain/skills', id, 'references/rules.md'), text);
  const descriptor = async id => JSON.parse(await git(remote, 'show', `skill-releases:index/${id}.json`));
  return { root, repo, remote, repository: pathToFileURL(remote).href, commit, change, descriptor, head };
}

export async function waitFor(fn, timeout = 15000) {
  const start = Date.now();
  let result;
  while (Date.now() - start < timeout) {
    try { result = await fn(); if (result) return result; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`condition not reached after ${timeout}ms; last=${JSON.stringify(result)}`);
}
export async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
