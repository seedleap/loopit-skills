import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { stageUpdate } from '../client/stage.mjs';

test('response-body disconnect is a network failure; malformed JSON is an invalid descriptor', async t => {
  let brokenStream = true;
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (brokenStream) { res.write('{"schema":1'); setTimeout(() => res.destroy(), 20); }
    else res.end('not valid JSON');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const before = process.env.LOOPIT_SKILLS_RELEASE_BASE_URL;
  process.env.LOOPIT_SKILLS_RELEASE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    if (before === undefined) delete process.env.LOOPIT_SKILLS_RELEASE_BASE_URL;
    else process.env.LOOPIT_SKILLS_RELEASE_BASE_URL = before;
    return new Promise(resolve => server.close(resolve));
  });
  const input = { info: { id: 'a', repository: 'seedleap/loopit-skills', releaseBranch: 'skill-releases' }, currentVersion: '1.0.0' };
  await assert.rejects(stageUpdate(input), { code: 'NETWORK_UNAVAILABLE' });
  brokenStream = false;
  await assert.rejects(stageUpdate(input), { code: 'INVALID_DESCRIPTOR' });
});
