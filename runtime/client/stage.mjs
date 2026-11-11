import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import semver from 'semver';
import { resolveSource, installSkills } from 'skills';
import { contentHash, intact, readJson } from '../shared/content.mjs';
import { writeJson } from '../shared/io.mjs';
import { terminateProcessTree } from './process-tree.mjs';

export function validateDescriptor(value, info) {
  if (value?.schema !== 1 || value.id !== info.id || !semver.valid(value.version)
    || semver.prerelease(value.version) || value.tag !== `skill/${info.id}/v${value.version}`
    || value.packagePath !== `skills/${info.id}` || !/^[a-f0-9]{40}$/.test(value.sourceCommit)
    || !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    throw Object.assign(new Error('invalid release descriptor'), { code: 'INVALID_DESCRIPTOR' });
  }
  return value;
}

export async function stageUpdate({ info, currentVersion, staging }) {
  const base = process.env.LOOPIT_SKILLS_RELEASE_BASE_URL
    || `https://raw.githubusercontent.com/${info.repository}/${info.releaseBranch}/index`;
  let response, body;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/${info.id}.json`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (response.ok) body = await response.text();
  }
  catch (error) { throw Object.assign(new Error('release network unavailable'), { code: error.name === 'TimeoutError' ? 'NETWORK_TIMEOUT' : 'NETWORK_UNAVAILABLE' }); }
  if (!response.ok) throw Object.assign(new Error(`release lookup HTTP ${response.status}`), { code: response.status === 429 ? 'RATE_LIMITED' : 'RELEASE_UNAVAILABLE' });
  let value;
  try { value = JSON.parse(body); }
  catch { throw Object.assign(new Error('invalid release JSON'), { code: 'INVALID_DESCRIPTOR' }); }
  const descriptor = validateDescriptor(value, info);
  if (!semver.gt(descriptor.version, currentVersion)) return { result: 'current', version: currentVersion };
  await writeJson(path.join(staging, 'pending.json'), { version: descriptor.version });
  const source = await resolveSource(info.repository, { ref: descriptor.tag });
  try {
    const selected = source.skills.find(s => s.name === info.id);
    if (!selected || selected.path !== descriptor.packagePath || selected.duplicates?.length || !source.source.commit) {
      throw Object.assign(new Error('release source identity mismatch'), { code: 'INTEGRITY_FAILED' });
    }
    const installed = await installSkills(source, { cwd: staging, skills: [info.id], agents: ['universal'],
      scope: 'project', mode: 'copy', lockfile: false, telemetry: false, duplicates: 'error', symlinks: 'reject' });
    if (installed.failed.length) throw Object.assign(new Error('staged install failed'), { code: installed.failed[0].code });
    const candidate = path.join(staging, '.agents/skills', info.id);
    const candidateInfo = await readJson(path.join(candidate, '.loopit-skill.json'));
    for (const field of ['id', 'version', 'sourceCommit', 'packagePath', 'tag']) {
      if (candidateInfo[field] !== descriptor[field]) throw Object.assign(new Error(`package ${field} mismatch`), { code: 'INTEGRITY_FAILED' });
    }
    if (candidateInfo.repository !== info.repository || candidateInfo.releaseBranch !== info.releaseBranch
      || !await intact(candidate, candidateInfo) || await contentHash(candidate) !== descriptor.contentHash) {
      throw Object.assign(new Error('package content mismatch'), { code: 'INTEGRITY_FAILED' });
    }
    return { result: 'prepared', candidate, descriptor };
  } finally { await source.dispose(); }
}

export async function stageMain(inputFile) {
  const input = await readJson(inputFile);
  // A second deadline also bounds this process if its supervisor is interrupted.
  const deadline = setTimeout(() => {
    void terminateProcessTree(process.pid).then(() => process.exit(124), () => process.exit(124));
  }, input.timeoutMs + 3000);
  try {
    await mkdir(path.join(input.staging, 'tmp'), { recursive: true });
    await writeJson(path.join(input.staging, 'result.json'), await stageUpdate(input));
  } catch (error) {
    await writeJson(path.join(input.staging, 'result.json'), { result: 'failed', code: error.code || error.name || 'UPDATE_FAILED' });
  } finally { clearTimeout(deadline); }
}
