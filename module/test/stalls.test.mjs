// Scratch-database integration checks: real reducers and SQL, no vendor credentials.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, newIdentity, founderToken, identityArg } from './client.mjs';
let founder, desk, coo;
const stamp = Date.now();
const ok = (r) => assert.equal(r.status, 200, r.body);
const opt = (v) => Array.isArray(v) && v[0] === 0 ? v[1] : undefined;
const one = async (q) => (await sql(founder, q))[0];
async function paid(suffix) {
  const ref = `stall-${stamp}-${suffix}`;
  ok(await call(desk, 'create_order', [ref, `agent1qaudit-${stamp}`, 'public listings', '{}', 100]));
  ok(await call(desk, 'record_payment', [ref, `demo-simulated:${ref}`]));
  return one(`SELECT * FROM orders WHERE ref = '${ref}'`);
}
before(async () => {
  founder = founderToken();
  [desk, coo] = await Promise.all(['front_desk', 'coo'].map(async (role) => {
    const identity = await newIdentity();
    ok(await call(founder, 'set_staff', [identityArg(identity.identity), role, `stall-${role}`]));
    return identity.token;
  }));
});
test('queued work blocks rescue; cancelling it permits exactly one balanced refund', async () => {
  const o = await paid('queued');
  const refused = await call(founder, 'refund_order', [o.id, 'stop']);
  assert.equal(refused.status, 530); assert.match(refused.body, /in flight/);
  const task = (await sql(founder, 'SELECT * FROM task')).find((t) => opt(t.order_id) === o.id);
  ok(await call(founder, 'cancel_task', [task.id, 'cancel before refund']));
  ok(await call(founder, 'refund_order', [o.id, 'stop']));
  assert.equal((await one(`SELECT * FROM orders WHERE id = ${o.id}`)).status, 'failed');
  const refunds = await sql(founder, `SELECT * FROM refund WHERE order_id = ${o.id}`);
  assert.equal(refunds.length, 1); assert.equal(refunds[0].status, 'issued');
  assert.equal(Number((await one(`SELECT * FROM books WHERE account = 'customer:${o.id}'`)).balance_cents), 0);
  assert.match((await call(coo, 'coo_decide', [o.id, 'REJECT', '', 'late decision'])).body, /is failed/);
  assert.match((await call(founder, 'refund_order', [o.id, 'again'])).body, /nothing left/);
  assert.equal((await sql(founder, 'SELECT * FROM books')).reduce((sum, r) => sum + BigInt(r.balance_cents), 0n), 0n);
});
test('a research task blocks rescue until cancelled', async () => {
  const o = await paid('research');
  ok(await call(coo, 'coo_decide', [o.id, 'REQUEST_RESEARCH', '', 'discover public sources']));
  assert.match((await call(founder, 'refund_order', [o.id, 'stop'])).body, /in flight/);
  for (const task of await sql(founder, 'SELECT * FROM task')) {
    if (opt(task.order_id) === o.id && task.status === 'queued') ok(await call(founder, 'cancel_task', [task.id, 'stop research']));
  }
  ok(await call(founder, 'refund_order', [o.id, 'stop']));
});
test('refund approval decline is recorded on the order feed', async () => {
  ok(await call(founder, 'set_config', ['refund_limit_cents', '0']));
  try {
    const o = await paid('decline');
    ok(await call(coo, 'coo_decide', [o.id, 'REJECT', '', 'terms unclear']));
    const refund = await one(`SELECT * FROM refund WHERE order_id = ${o.id}`);
    const approval = (await sql(founder, 'SELECT * FROM approval')).find((a) => a.kind === 'refund_over_limit' && a.ref_id === refund.id);
    ok(await call(founder, 'decide_approval', [approval.id, false]));
    const ev = (await sql(founder, "SELECT * FROM event WHERE kind = 'order_refund_declined'")).find((e) => e.ref_id === o.id);
    assert.equal(ev.ref_type, 'order');
  } finally { ok(await call(founder, 'set_config', ['refund_limit_cents', '500'])); }
});
test('public run links require founder, existing CREAO run and approved URL shape', async () => {
  const denied = await call(desk, 'set_run_share_url', [1, 'https://evil.example']);
  assert.equal(denied.status, 530); assert.match(denied.body, /may not do this/);
  const missing = await call(founder, 'set_run_share_url', [9999999, 'https://evil.example']);
  assert.equal(missing.status, 530); assert.match(missing.body, /CREAO run/);
});


test('founder links only a validated public CREAO URL', async () => {
  const marker = `link-test-${stamp}`;
  ok(await call(founder, 'creao_start', [marker, '{}', marker, '']));
  const run = await one(`SELECT * FROM run WHERE app_id = '${marker}'`);
  assert.ok(run);
  for (const url of ['javascript:alert(1)', 'https://evil.example/share/1234567890123456', 'https://agent.creao.ai/share/short']) {
    assert.equal((await call(founder, 'set_run_share_url', [run.id, url])).status, 530);
  }
  const share = 'https://agent.creao.ai/share/2361cbf6417714be089c498e9e96c580';
  ok(await call(founder, 'set_run_share_url', [run.id, share]));
  assert.equal((await one(`SELECT * FROM run WHERE id = ${run.id}`)).share_url, share);
});
