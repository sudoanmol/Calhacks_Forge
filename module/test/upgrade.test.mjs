// Opt-in no-reset migration check. Publish main to the scratch database before this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { HOST, DB, call, sql, newIdentity, founderToken, identityArg } from './client.mjs';
test('publishing HEAD without reset preserves orders, books and refund history', {
  skip: process.env.FORGE_TEST_UPGRADE !== 'true', timeout: 60_000,
}, async () => {
  assert.match(HOST, /^http:\/\/127\.0\.0\.1:/); assert.notEqual(DB, 'forge');
  const founder = founderToken(), seat = await newIdentity();
  const ok = (r) => assert.equal(r.status, 200, r.body);
  ok(await call(founder, 'set_staff', [identityArg(seat.identity), 'front_desk', 'upgrade-desk']));
  const coo = await newIdentity();
  ok(await call(founder, 'set_staff', [identityArg(coo.identity), 'coo', 'upgrade-coo']));
  const stamp = Date.now();
  for (const suffix of ['quoted', 'paid', 'rejected']) {
    const ref = `upgrade-${stamp}-${suffix}`;
    ok(await call(seat.token, 'create_order', [ref, 'asi-upgrade-test', 'SIMULATED QA upgrade', '{}', 100]));
    if (suffix !== 'quoted') ok(await call(seat.token, 'record_payment', [ref, `demo-simulated:${ref}`]));
    if (suffix === 'rejected') {
      const [o] = await sql(founder, `SELECT * FROM orders WHERE ref = '${ref}'`);
      ok(await call(coo.token, 'coo_decide', [o.id, 'REJECT', '', 'SIMULATED QA rejected fixture']));
    }
  }
  const before = {};
  for (const table of ['orders', 'refund', 'books']) before[table] = await sql(founder, `SELECT * FROM ${table}`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CREAO_') && k !== 'PUBLIC_ROUTE_BASE'));
  execFileSync('spacetime', ['publish', '-s', HOST, '-p', 'module', '-y', DB], { env, stdio: 'pipe' });
  for (const table of ['orders', 'refund', 'books']) assert.deepEqual(await sql(founder, `SELECT * FROM ${table}`), before[table], table);
  const [quoted] = await sql(founder, `SELECT * FROM orders WHERE ref = 'upgrade-${stamp}-quoted'`);
  assert.equal((await call(founder, 'refund_order', [quoted.id, 'not paid'])).status, 530);
});
