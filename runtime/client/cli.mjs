import { fileURLToPath } from 'node:url';
import { supervise } from './supervisor.mjs';
import { stageMain } from './stage.mjs';

try {
  if (process.argv[2] === 'worker') await supervise(process.argv[3], fileURLToPath(import.meta.url), process.argv[4]);
  else if (process.argv[2] === 'stage') await stageMain(process.argv[3]);
  else throw new Error('expected worker or stage');
} catch (error) {
  console.error(JSON.stringify({ error: 'SKILL_WORKER_FAILED', code: error.code || error.name }));
  process.exitCode = 1;
}
