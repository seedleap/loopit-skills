import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { context, selection, status } from './local.mjs';

export async function invoke(installation, { frontendError } = {}) {
  const ctx = await context(installation);
  const options = { ignoreActive: Boolean(frontendError) };
  if (process.argv.includes('--status')) console.log(JSON.stringify({ ...await status(ctx, options), frontendError }));
  else {
    const current = await selection(ctx, { freeze: true, ...options });
    const worker = spawn(process.execPath, [path.join(current.resourcesRoot, 'scripts/runtime.mjs'), 'worker', ctx.root, current.invocationId], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' },
    });
    worker.on('error', () => {});
    worker.unref();
    console.log(JSON.stringify({ ...current, frontendError, frontendPath: fileURLToPath(import.meta.url), updateStarted: Boolean(worker.pid) }));
  }
}
