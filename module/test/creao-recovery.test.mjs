// Opt-in: publish a LOCAL scratch db with CREAO_API_KEY=invalid and CREAO_APP_ID_COO=invalid.
// Real CREAO 401s exercise bounded retries without paid agent runs. Takes about six minutes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST, call, sql, founderToken, newIdentity, identityArg } from './client.mjs';

test('CREAO start failures stop after five minutes and refund the paid order', {
  skip: process.env.FORGE_TEST_CREAO_RECOVERY !== 'true', timeout: 430_000,
}, async () => {
  assert.match(HOST, /^http:\/\/127\.0\.0\.1:/, 'scratch localhost only');
  const founder = founderToken();
  const ok = (r) => assert.equal(r.status, 200, r.body);
  const seat = await newIdentity();
  ok(await call(founder, 'set_staff', [identityArg(seat.identity), 'front_desk', 'recovery-test']));
  const ref = `recovery-${Date.now()}`;
  ok(await call(seat.token, 'create_order', [ref, 'asi-recovery-test', 'public listings', '{}', 100]));
  ok(await call(seat.token, 'record_payment', [ref, `demo-simulated:${ref}`]));
  let order;
  const deadline = Date.now() + 400_000;
  while (Date.now() < deadline) {
    [order] = await sql(founder, `SELECT * FROM orders WHERE ref = '${ref}'`);
    if (order.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(order.status, 'failed', order.decision_reason);
  const [refund] = await sql(founder, `SELECT * FROM refund WHERE order_id = ${order.id}`);
  assert.equal(refund.status, 'issued');
  const [book] = await sql(founder, `SELECT * FROM books WHERE account = 'customer:${order.id}'`);
  assert.equal(Number(book.balance_cents), 0);
  const events = await sql(founder, "SELECT * FROM event WHERE kind = 'task_ended_without_decision'");
  assert.ok(events.length);
  const runs = await sql(founder, 'SELECT * FROM run');
  assert.ok(runs.length >= 2 && runs.length <= 15, `bounded run count: ${runs.length}`);
  assert.ok(runs.every((r) => r.status === 'start_failed'));
  const count = runs.length;
  await new Promise((r) => setTimeout(r, 35_000));
  assert.equal((await sql(founder, 'SELECT * FROM run')).length, count, 'retries stay stopped');
  assert.equal((await sql(founder, 'SELECT * FROM books')).reduce((s, b) => s + BigInt(b.balance_cents), 0n), 0n);
});
