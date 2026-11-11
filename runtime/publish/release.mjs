import { mkdtemp, rm, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import semver from 'semver';
import { pathToFileURL } from 'node:url';
import { git, ancestor, remoteRelease, archive, dependencies, outputRepository } from './git.mjs';
import { discover, InvalidSkill, validateSkill } from './discover.mjs';
import { readJson, sha256, contentHash } from '../shared/content.mjs';
import { writeJson } from '../shared/io.mjs';

async function inputs(repo, commit, skills) {
  const common = [];
  for (const file of ['runtime/client', 'runtime/shared', 'runtime/publish/build.mjs', 'runtime/publish/licenses.mjs', 'package.json', 'package-lock.json']) common.push(await git(repo, 'rev-parse', `${commit}:${file}`));
  const result = {};
  for (const skill of skills) {
    const license = path.posix.join(path.posix.dirname(path.posix.dirname(skill.relative)), 'LICENSE');
    const tree = await git(repo, 'ls-tree', commit, license);
    result[skill.relative] = sha256(`${await git(repo, 'rev-parse', `${commit}:${skill.relative}`)}\0${common.join('\0')}\0${tree}\0${skill.error || 'valid'}`);
  }
  return result;
}

export async function publish({ repo = process.cwd(), sourceRef = 'refs/remotes/origin/main', baselineRef, repository = 'seedleap/loopit-skills',
  remote = 'origin', push = false, beforePush } = {}) {
  const target = await git(repo, 'rev-parse', `${sourceRef}^{commit}`);
  const releaseHead = await remoteRelease(repo, remote);
  const workspace = await mkdtemp(path.join(tmpdir(), 'loopit-release-'));
  try {
    const output = await outputRepository(repo, releaseHead, workspace);
    const stateFile = path.join(output, '.release-state.json');
    const state = releaseHead ? await readJson(stateFile) : { schema: 1, cursor: null, inputs: {}, skills: {}, events: {} };
    if (state.schema !== 1) throw new Error('unsupported release state schema');
    if (state.cursor && await ancestor(repo, target, state.cursor)) return { state, published: [], unchanged: true };
    if (state.cursor && !await ancestor(repo, state.cursor, target)) throw new Error('main history diverged from release cursor');
    const baseline = state.cursor || (baselineRef ? await git(repo, 'rev-parse', `${baselineRef}^{commit}`) : target);
    if (!await ancestor(repo, baseline, target)) throw new Error('baseline not ancestor of target');
    const commits = [...(!state.cursor ? [baseline] : []), ...(await git(repo, 'rev-list', '--first-parent', '--reverse', `${baseline}..${target}`)).split('\n').filter(Boolean)];
    if (state.cursor && !(await git(repo, 'rev-list', '--first-parent', target)).split('\n').includes(state.cursor)) throw new Error('release cursor not on main first-parent chain');
    const refs = [], published = [], rejected = [];
    for (const commit of commits) {
      const source = await archive(repo, commit, workspace);
      try {
        const skills = await discover(source);
        const fingerprints = await inputs(repo, commit, skills);
        const changed = skills.filter(s => state.inputs[s.relative] !== fingerprints[s.relative]);
        let bundles, builder, bundleError, dependenciesReady = false;
        const tags = [];
        for (const skill of changed) {
          const key = `${skill.id}@${commit}`;
          if (state.events[key]) continue;
          try {
            if (skill.error) throw new InvalidSkill(skill.error);
            // Validate before compiling so an invalid skill cannot block its peers.
            await validateSkill(skill.dir, skill.id);
            if (bundleError) throw new InvalidSkill(bundleError);
            if (!bundles) {
              if (!dependenciesReady) { await dependencies(source); dependenciesReady = true; }
              try {
                builder = await import(pathToFileURL(path.join(source, 'runtime/publish/build.mjs')).href);
                bundles = await builder.bundleRuntime(source);
              }
              catch (error) {
                if (error.errors?.length || error instanceof SyntaxError) {
                  bundleError = `runtime bundle invalid: ${error.errors?.[0]?.text || error.message}`;
                  throw new InvalidSkill(bundleError);
                }
                throw error;
              }
            }
            const version = state.skills[skill.id] ? semver.inc(state.skills[skill.id].version, 'patch') : '1.0.0';
            const candidate = path.join(workspace, `package-${skill.id}`);
            await rm(candidate, { recursive: true, force: true });
            const descriptor = await builder.buildPackage({ ...skill, version, sourceCommit: commit, repository, target: candidate, bundles });
            const destination = path.join(output, descriptor.packagePath);
            await rm(destination, { recursive: true, force: true });
            await mkdir(path.dirname(destination), { recursive: true });
            await rename(candidate, destination);
            await writeJson(path.join(output, 'index', `${skill.id}.json`), descriptor);
            state.skills[skill.id] = descriptor;
            state.events[key] = { result: 'published', version };
            tags.push(descriptor.tag);
            published.push(descriptor);
          } catch (error) {
            if (!(error instanceof InvalidSkill) && error.code !== 'INVALID_SKILL') throw error;
            state.events[key] = { result: 'invalid', reason: error.message };
            rejected.push({ id: skill.id, sourceCommit: commit, reason: error.message });
          }
        }
        state.inputs = fingerprints;
        state.cursor = commit;
        await writeJson(stateFile, state);
        await git(output, 'add', '--force', '--all');
        const tree = await git(output, 'write-tree');
        const audit = await archive(output, tree, workspace);
        try {
          for (const tag of tags) {
            const descriptor = published.find(d => d.tag === tag);
            if (await contentHash(path.join(audit, descriptor.packagePath)) !== descriptor.contentHash) throw new Error(`Git tree integrity mismatch: ${tag}`);
          }
        } finally { await rm(audit, { recursive: true, force: true }); }
        await git(output, 'commit', '-m', `发布 Skill：${commit}`);
        const releaseCommit = await git(output, 'rev-parse', 'HEAD');
        for (const tag of tags) refs.push(`${releaseCommit}:refs/tags/${tag}`);
      } finally { await rm(source, { recursive: true, force: true }); }
    }
    const head = await git(output, 'rev-parse', 'HEAD');
    if (push && commits.length) {
      if (beforePush) await beforePush({ state, published });
      // Keep checkout credentials in the original repository; never touch its index or branch.
      await git(repo, 'fetch', '--no-tags', output, 'refs/heads/skill-releases');
      await git(repo, 'push', '--atomic', remote, `${head}:refs/heads/skill-releases`, ...refs);
    }
    return { state, published, rejected, releaseCommit: head, pushed: push };
  } finally { await rm(workspace, { recursive: true, force: true }); }
}
