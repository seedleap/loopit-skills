import { spawn } from 'node:child_process';

export async function terminateProcessTree(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (platform !== 'win32') {
    try { process.kill(-pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    return;
  }
  await new Promise((resolve, reject) => {
    const command = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore', windowsHide: true, timeout: 5000,
    });
    command.once('error', reject);
    command.once('exit', code => {
      // 128 means the target has already exited. Other failures leave staging intact.
      if (code === 0 || code === 128) resolve();
      else reject(Object.assign(new Error('process tree termination failed'), { code: 'PROCESS_TERMINATION_FAILED' }));
    });
  });
}
