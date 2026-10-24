import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/policy.ts';

const wt = '/tmp/forge-wt/gpu-listings';

test('file changes inside the worktree are auto-allowed', () => {
  assert.equal(decide(wt, { name: 'Create', type: 'create', filePath: `${wt}/src/extract.js` }).outcome, 'auto-allowed');
  assert.equal(decide(wt, { name: 'Edit', type: 'edit', filePath: 'src/extract.js' }).outcome, 'auto-allowed');
});

test('writes outside the worktree are denied', () => {
  assert.equal(decide(wt, { name: 'Edit', type: 'edit', filePath: '/tmp/forge-wt/other/x.js' }).outcome, 'denied');
  assert.equal(decide(wt, { name: 'Edit', type: 'edit', filePath: '../../etc/passwd' }).outcome, 'denied');
});

test('env files are denied', () => {
  assert.equal(decide(wt, { name: 'Create', type: 'create', filePath: `${wt}/.env` }).outcome, 'denied');
});

test('tests are auto-allowed', () => {
  assert.equal(decide(wt, { name: 'Execute', type: 'exec', command: 'pnpm test' }).outcome, 'auto-allowed');
  assert.equal(decide(wt, { name: 'Execute', type: 'exec', command: 'pnpm run test:fixtures' }).outcome, 'auto-allowed');
});

test('network, deploy and secrets commands are denied', () => {
  for (const command of ['curl https://example.com', 'apify push', 'git push origin main', 'cat ../../.env', 'npm install left-pad']) {
    assert.equal(decide(wt, { name: 'Execute', type: 'exec', command }).outcome, 'denied', command);
  }
});

test('other commands need founder approval', () => {
  assert.equal(decide(wt, { name: 'Execute', type: 'exec', command: 'pnpm add cheerio' }).outcome, 'needs-approval');
});
