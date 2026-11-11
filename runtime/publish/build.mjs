import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { fileMap, contentHash, exists } from '../shared/content.mjs';
import { frontmatter, validateSkill } from './discover.mjs';
import { bundleLicenses } from './licenses.mjs';

export async function bundleRuntime(sourceRoot) {
  const result = {};
  const inputs = new Set();
  for (const [name, source] of Object.entries({ entry: 'entry.mjs', invoke: 'invoke.mjs', runtime: 'cli.mjs' })) {
    const bundle = await build({ entryPoints: [path.join(sourceRoot, 'runtime/client', source)],
      absWorkingDir: sourceRoot, bundle: true, write: false, platform: 'node', format: 'esm',
      target: 'node22.20', minify: true, legalComments: 'inline', metafile: true, logLevel: 'silent',
      banner: { js: "import { createRequire as __loopitCreateRequire } from 'node:module';import { fileURLToPath as __loopitFilePath } from 'node:url';import { dirname as __loopitDirname } from 'node:path';const require = __loopitCreateRequire(import.meta.url);const __filename = __loopitFilePath(import.meta.url);const __dirname = __loopitDirname(__filename);" } });
    result[`${name}.mjs`] = bundle.outputFiles[0].text;
    for (const input of Object.keys(bundle.metafile.inputs)) inputs.add(input);
  }
  result.notices = await bundleLicenses(inputs, sourceRoot);
  return result;
}

export async function buildPackage({ dir, id, version, sourceCommit, repository, target, bundles }) {
  await validateSkill(dir, id);
  await cp(dir, target, { recursive: true, errorOnExist: true, force: false });
  const domainLicense = path.resolve(dir, '../../LICENSE');
  if (!await exists(path.join(target, 'LICENSE')) && await exists(domainLicense)) await cp(domainLicense, path.join(target, 'LICENSE'));
  const original = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
  const metadata = frontmatter(original);
  const launcher = `---\n${stringify(metadata)}---\n\n# 每次调用入口\n\n每次选用此 Skill（显式调用、自动选用、同会话再次使用、压缩后继续）都必须重新执行入口；不得缓存或直接复用上次的业务正文。\n\n1. 以本文件实际安装目录为基准，执行：\n\n   \`node \"<本 SKILL.md 所在目录>/scripts/entry.mjs\"\`\n\n2. 读取入口返回 JSON 中的绝对路径 \`workflowPath\`，并严格按该正文完成本次任务；所有相对资源路径以 \`resourcesRoot\` 为基准。\n3. 本次始终固定使用回执的 \`version\` 和路径，即使后台出现新版也不重新解析指针。不等待后台检查，不执行前台更新。下次调用重新从步骤 1 开始。\n\n本入口只返回本地快照并启动静默后台检查。Node.js ≥22.20、Git；详情或最近结果：\`node \"<本 SKILL.md 所在目录>/scripts/entry.mjs\" --status\`。宿主没有执行入口的权限时应报告限制，不绕过权限。\n`;
  await writeFile(path.join(target, 'workflow.md'), original);
  await writeFile(path.join(target, 'SKILL.md'), launcher);
  await mkdir(path.join(target, 'scripts'), { recursive: true });
  for (const name of ['entry.mjs', 'invoke.mjs', 'runtime.mjs']) await writeFile(path.join(target, 'scripts', name), bundles[name]);
  await writeFile(path.join(target, 'THIRD_PARTY_NOTICES.txt'), bundles.notices);
  const descriptor = { schema: 1, id, version, sourceCommit, packagePath: `skills/${id}`, tag: `skill/${id}/v${version}` };
  const info = { ...descriptor, repository, releaseBranch: 'skill-releases', files: await fileMap(target) };
  await writeFile(path.join(target, '.loopit-skill.json'), `${JSON.stringify(info, null, 2)}\n`);
  await validateSkill(target, id, { generated: true });
  return { ...descriptor, contentHash: await contentHash(target) };
}
