import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function writeText(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, value, { mode: 0o644 });
}
