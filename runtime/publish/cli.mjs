import { discover, validateSkill } from './discover.mjs';
import { publish } from './release.mjs';
import { git, activationCommit } from './git.mjs';

try {
  if (process.argv[2] === 'validate') {
    const skills = await discover(process.cwd());
    if (!skills.length) throw new Error('no skills discovered');
    const results = await Promise.allSettled(skills.map(async skill => {
      if (skill.error) throw new Error(`${skill.id}: ${skill.error}`);
      await validateSkill(skill.dir, skill.id);
      return skill.id;
    }));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      console.log(JSON.stringify({ id: skills[i].id, valid: result.status === 'fulfilled', ...(result.reason && { error: result.reason.message }) }));
    }
    if (results.some(r => r.status === 'rejected')) process.exitCode = 1;
  } else if (process.argv[2] === 'release') {
    await git(process.cwd(), 'fetch', '--no-tags', 'origin', 'main');
    const sourceRef = process.env.SKILL_RELEASE_SOURCE_SHA || await git(process.cwd(), 'rev-parse', 'FETCH_HEAD');
    const baselineRef = await activationCommit(process.cwd(), sourceRef);
    const result = await publish({ sourceRef, baselineRef, push: process.argv.includes('--push'), repository: process.env.GITHUB_REPOSITORY || 'seedleap/loopit-skills' });
    console.log(JSON.stringify(result, null, 2));
    if (result.rejected?.length) {
      console.error(`${result.rejected.length} skill(s) rejected; other valid releases were published`);
      process.exitCode = 1;
    }
  } else throw new Error('usage: cli.mjs validate | release [--push]');
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
