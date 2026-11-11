import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import { context, selection, activate } from './local.mjs';
import { readJson } from '../shared/content.mjs';
import { writeJson } from '../shared/io.mjs';
import { refreshMetadata } from './metadata.mjs';
import { terminateProcessTree } from './process-tree.mjs';

export async function supervise(installation, runtimePath = fileURLToPath(import.meta.url), invocationId) {
  const ctx = await context(installation);
  await mkdir(ctx.state, { recursive: true, mode: 0o700 });
  let child, compromised = false, interrupted = false;
  let termination, terminationError;
  let reportTerminationFailure;
  const terminationFailed = new Promise(resolve => { reportTerminationFailure = resolve; });
  const stop = () => {
    if (!child?.pid) return Promise.resolve();
    return termination ||= terminateProcessTree(child.pid).catch(error => {
      terminationError = error;
      reportTerminationFailure(error);
    });
  };
  let unlock;
  try {
    unlock = await lockfile.lock(path.join(ctx.state, 'update'), { realpath: false, retries: 0,
      stale: 15000, update: 2000, onCompromised: () => { compromised = true; void stop(); } });
  } catch (error) { if (error.code === 'ELOCKED') return; throw error; }
  const startedAt = new Date().toISOString(), started = Date.now();
  let staging, result;
  const abort = () => { interrupted = true; void stop(); };
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    const current = await selection(ctx);
    if (current.modified || current.pointerError) { result = { result: 'skipped', code: 'LOCAL_MODIFIED' }; return; }
    await refreshMetadata(ctx);
    staging = await mkdtemp(path.join(ctx.state, 'staging-'));
    const timeoutMs = Math.min(300000, Math.max(100, Number(process.env.LOOPIT_SKILLS_TIMEOUT_MS) || 60000));
    const inputFile = path.join(staging, 'input.json');
    await writeJson(inputFile, { info: ctx.info, currentVersion: current.version, staging, timeoutMs });
    await writeJson(path.join(ctx.state, 'last-check.json'), { result: 'checking', startedAt, invocationId, currentVersion: current.version, staging });
    await mkdir(path.join(staging, 'tmp'));
    if (compromised || interrupted) throw Object.assign(new Error('worker stopped'), { code: 'INTERRUPTED' });
    child = spawn(process.execPath, [runtimePath, 'stage', inputFile], { detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, TMPDIR: path.join(staging, 'tmp'), TMP: path.join(staging, 'tmp'), TEMP: path.join(staging, 'tmp') } });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void stop(); }, timeoutMs);
    try {
      const failure = await Promise.race([
        new Promise((resolve, reject) => { child.once('exit', () => resolve(null)); child.once('error', reject); }),
        terminationFailed,
      ]);
      if (failure) throw failure;
    } finally { clearTimeout(timer); await stop(); }
    if (terminationError) throw terminationError;
    if (compromised || interrupted || timedOut) throw Object.assign(new Error('worker stopped'), { code: timedOut ? 'TIMEOUT' : 'INTERRUPTED' });
    result = await readJson(path.join(staging, 'result.json'));
    if (result.result === 'prepared') {
      await activate(ctx, result.candidate, result.descriptor);
      result = { result: 'updated', version: result.descriptor.version };
    }
  } catch (error) { result = { result: 'failed', code: error.code || error.name || 'UPDATE_FAILED' }; }
  finally {
    await stop();
    if (staging && !terminationError) await rm(staging, { recursive: true, force: true });
    if (terminationError) result = { result: 'failed', code: terminationError.code || 'PROCESS_TERMINATION_FAILED' };
    if (!compromised) await writeJson(path.join(ctx.state, 'last-check.json'), { ...result, startedAt, invocationId,
      finishedAt: new Date().toISOString(), durationMs: Date.now() - started });
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
    await unlock().catch(() => {});
    // Normal shutdown must keep the child referenced until its exit callback runs.
    if (terminationError) child?.unref();
  }
}
