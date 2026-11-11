import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { exists, readJson } from '../shared/content.mjs';

export async function bundleLicenses(inputs, sourceRoot) {
  const packages = new Map();
  for (const input of inputs) {
    let dir = path.dirname(path.resolve(sourceRoot, input));
    if (!dir.includes(`${path.sep}node_modules${path.sep}`)) continue;
    while (dir !== path.dirname(dir)) {
      if (await exists(path.join(dir, 'package.json'))) {
        const pkg = await readJson(path.join(dir, 'package.json'));
        if (pkg.name && pkg.version) {
          packages.set(`${pkg.name}@${pkg.version}`, dir);
          break;
        }
      }
      dir = path.dirname(dir);
    }
  }
  const notices = [];
  for (const [name, dir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const names = (await readdir(dir)).filter(n => /^(LICENSE|LICENCE|COPYING|NOTICE|ThirdPartyNoticeText)/i.test(n));
    if (!names.length) throw new Error(`missing bundled dependency license: ${name}`);
    for (const file of names) notices.push(`${name}/${file}\n${await readFile(path.join(dir, file), 'utf8')}`);
  }
  return notices.join('\n\n');
}
