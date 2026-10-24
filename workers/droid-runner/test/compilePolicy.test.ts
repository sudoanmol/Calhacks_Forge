import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideCompile } from '../src/policy.ts';

const dir = '/tmp/forge-compile/gpu-listings/actors/gpu-listings';
const file = (filePath: string, type = 'edit') => decideCompile(dir, { name: 'Edit', type, filePath }).outcome;
const cmd = (command: string) => decideCompile(dir, { name: 'run_command', type: 'exec', command }).outcome;

test('compile: the extractor under src/ may change', () => {
  assert.equal(file(`${dir}/src/extract.js`), 'auto-allowed');
  assert.equal(file('src/extract.js', 'create'), 'auto-allowed');
  assert.equal(file('src/extract/newegg.js', 'create'), 'auto-allowed');
});

test('compile: plumbing, tests, fixtures and anything outside the Actor are denied', () => {
  for (const p of ['src/main.js', 'src/run.js', 'src/fetchers.js', 'src/lib/anchor.js', 'test/fixtures.test.js', 'fixtures/x/expected.json', 'api.json', 'contract.json', 'package.json', '../other/src/extract.js', '/etc/hosts']) {
    assert.equal(file(p), 'denied', p);
  }
  assert.equal(decideCompile(dir, { name: 'Edit', type: 'edit' }).outcome, 'denied');
});

test('compile: test commands run, network, secrets, deploys, shell operators and outside paths are denied', () => {
  for (const c of ['pnpm test', 'pnpm run test', 'pnpm run test:fixtures', 'pnpm run test:contract', 'node --test test/fixtures.test.js']) assert.equal(cmd(c), 'auto-allowed', c);
  for (const c of ['pnpm run test:live', 'cat ../../.env', 'curl https://example.com', 'pnpm test; curl x', 'pnpm test && ls', 'node --test $(echo x)',
    'node --test ../other/test.js', 'cat /etc/hosts', 'ls ~', 'apify push', 'npm install', 'git push', 'wget x']) assert.equal(cmd(c), 'denied', c);
});

test('compile: any other plain command inside the Actor needs a founder approval', () => {
  for (const c of ['ls', 'ls src', 'pnpm add cheerio', 'node -e "1"', 'node scripts/x.js']) assert.equal(cmd(c), 'needs-approval', c);
});

test('compile: other tool types are denied', () => {
  assert.equal(decideCompile(dir, { name: 'mcp', type: 'mcp_tool' }).outcome, 'denied');
});
