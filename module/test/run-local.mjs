// Creates isolated staff identities, then runs tests against an explicitly selected localhost db.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { HOST, DB, call, newIdentity, founderToken, identityArg } from './client.mjs';
assert.match(HOST, /^http:\/\/127\.0\.0\.1:\d+$/, 'local server required');
assert.notEqual(DB, 'forge', 'use a scratch database');
const founder = founderToken();
const env = { ...process.env, FOUNDER_TOKEN: founder };
for (const role of ['front_desk', 'coo', 'research', 'cfo', 'auditor', 'droid_runner', 'canary']) {
  const seat = await newIdentity();
  const r = await call(founder, 'set_staff', [identityArg(seat.identity), role, `local-test-${role}`]);
  assert.equal(r.status, 200, r.body);
  env[`SPACETIME_TOKEN_${role.toUpperCase()}`] = seat.token;
}
const files = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...(files.length ? files : [
  'module/test/unit.test.mjs', 'module/test/creao-unit.test.mjs', 'module/test/research-unit.test.mjs', 'module/test/compile_unit.test.mjs',
  'module/test/api.test.mjs', 'module/test/orders.test.mjs', 'module/test/refunds.test.mjs', 'module/test/stalls.test.mjs',
])], { env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
