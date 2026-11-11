import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
export async function git(cwd, ...args) {
  return (await execute('git', args, { cwd, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();
}
export async function ancestor(repo, a, b) {
  try { await git(repo, 'merge-base', '--is-ancestor', a, b); return true; }
  catch (error) { if (error.code === 1) return false; throw error; }
}
export async function remoteRelease(repo, remote) {
  try { await git(repo, 'ls-remote', '--exit-code', '--heads', remote, 'refs/heads/skill-releases'); }
  catch (error) { if (error.code === 2) return null; throw error; }
  await git(repo, 'fetch', '--no-tags', remote, 'refs/heads/skill-releases');
  return git(repo, 'rev-parse', 'FETCH_HEAD');
}
export const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function archive(repo, commit, workspace) {
  const root = await mkdtemp(path.join(workspace, 'source-'));
  const tarball = `${root}.tar`;
  await git(repo, 'archive', '--format=tar', `--output=${tarball}`, commit);
  await execute('tar', ['-xf', tarball, '-C', root]);
  return root;
}
export async function dependencies(source) {
  const lock = await readFile(path.join(source, 'package-lock.json'), 'utf8');
  const ownLock = await readFile(path.join(toolRoot, 'package-lock.json'), 'utf8');
  if (lock === ownLock) await symlink(path.join(toolRoot, 'node_modules'), path.join(source, 'node_modules'), 'dir');
  else await execute('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: source, maxBuffer: 1024 * 1024 });
}
export async function outputRepository(repo, releaseHead, workspace) {
  const output = path.join(workspace, 'output');
  await mkdir(output);
  await git(output, 'init', '-b', 'skill-releases');
  await git(output, 'config', 'user.name', 'github-actions[bot]');
  await git(output, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  if (releaseHead) {
    await git(output, 'fetch', '--no-tags', repo, releaseHead);
    await git(output, 'reset', '--hard', 'FETCH_HEAD');
  }
  return output;
}

export async function activationCommit(repo, target) {
  const workflow = '.github/workflows/skill-release.yml';
  const history = (await git(repo, 'rev-list', '--first-parent', '--reverse', target, '--', workflow)).split('\n').filter(Boolean);
  for (const commit of history) {
    try { await git(repo, 'cat-file', '-e', `${commit}:${workflow}`); return commit; }
    catch (error) { if (error.code !== 128) throw error; }
  }
  return target;
}
