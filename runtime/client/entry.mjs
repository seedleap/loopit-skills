// Stable protocol v1 bootstrap. All changeable invocation logic lives in invoke.mjs.
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

try {
  const installation = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const info = JSON.parse(await readFile(path.join(installation, '.loopit-skill.json'), 'utf8'));
  const key = createHash('sha256').update(`${installation}\0${info.id}`).digest('hex');
  const state = path.join(path.resolve(process.env.LOOPIT_SKILLS_STATE_DIR || path.join(homedir(), '.local/state/loopit-skills')), key);
  let frontend = path.join(installation, 'scripts/invoke.mjs');
  let frontendError;
  try {
    const active = JSON.parse(await readFile(path.join(state, 'active.json'), 'utf8'));
    const snapshot = path.resolve(state, active.snapshot);
    const relative = path.relative(path.join(state, 'snapshots'), snapshot);
    const newer = active.version.split('.').map(Number).reduce((n, v, i) => n || Math.sign(v - Number(info.version.split('.')[i])), 0) > 0;
    if (active.schema === 1 && active.id === info.id && active.repository === info.repository
      && active.releaseBranch === info.releaseBranch && newer && relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      try {
        const next = path.join(snapshot, 'scripts/invoke.mjs');
        const data = await readFile(next);
        const normalized = data.includes(0) ? data : Buffer.from(data.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
        if (!active.frontendHash || createHash('sha256').update(normalized).digest('hex') !== active.frontendHash) throw new Error('frontend hash mismatch');
        frontend = next;
      } catch { frontendError = 'CORRUPT_FRONTEND'; }
    }
  } catch {}
  const { invoke } = await import(pathToFileURL(frontend).href);
  await invoke(installation, { frontendError });
} catch (error) {
  console.error(JSON.stringify({ error: 'SKILL_ENTRY_FAILED', message: error.message }));
  process.exitCode = 1;
}
