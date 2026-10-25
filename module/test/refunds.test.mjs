// Paid orders that end badly (docs/paid-failure-spec.md): the Treasurer refunds them in reducer code.
// Runs against a local server (`spacetime start` + publish) and creates its own seats, so nothing is
// created or refunded on Maincloud. The audit path needs a real Apify run and is not exercised here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, identityArg, newIdentity, founderToken } from './client.mjs';

const stamp = Date.now();
const SENDER = `asi-refund-${stamp}`;
let founder, desk, coo, auditor;
const apis = [];
let limitBefore;

const ok = (r) => assert.equal(r.status, 200, r.body);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = async (q) => (await sql(founder, q))[0];
const num = (v) => Number(v);
const orderByRef = (ref) => one(`SELECT * FROM orders WHERE ref = '${ref}'`);
const refundsOf = async (id) => (await sql(founder, 'SELECT * FROM refund')).filter((r) => num(r.order_id) === num(id));
const kindsOf = async (id) => (await sql(founder, "SELECT * FROM event WHERE ref_type = 'order'"))
  .filter((e) => num(e.ref_id) === num(id)).map((e) => e.kind);
const balance = async (account) => BigInt((await one(`SELECT * FROM books WHERE account = '${account}'`))?.balance_cents ?? 0);
const booksSum = async () => (await sql(founder, 'SELECT * FROM books')).reduce((s, r) => s + BigInt(r.balance_cents), 0n);

// A paid order, then the COO decides on it.
async function paidOrder(ref, priceCents) {
  ok(await call(desk, 'create_order', [ref, SENDER, `refund test ${ref}: public listing page`, '{}', priceCents]));
  ok(await call(desk, 'record_payment', [ref, `demo-simulated:${ref}`]));
  const o = await orderByRef(ref);
  assert.equal(o.status, 'paid');
  assert.equal(await balance(`customer:${o.id}`), -BigInt(priceCents), 'the payment is a debit on the customer');
  return o;
}

async function apiWith(name, apifyId) {
  const apiName = `${name}-${stamp}`;
  const spec = { name: apiName, description: 'refund test api', sources: ['https://example.com'], outputSchema: { properties: { title: { type: 'string' } } }, volatility: 'stable' };
  ok(await call(founder, 'create_api', [JSON.stringify(spec), apifyId, 'task']));
  apis.push(apiName);
  return apiName;
}

const until = async (fn, ms = 40_000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return undefined;
    await sleep(500);
  }
};

before(async () => {
  founder = founderToken();
  const seats = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
  [desk, coo, auditor] = seats.map((s) => s.token);
  for (const [s, role] of [[seats[0], 'front_desk'], [seats[1], 'coo'], [seats[2], 'auditor']]) {
    ok(await call(founder, 'set_staff', [identityArg(s.identity), role, `refund-test-${role}`]));
  }
  limitBefore = (await one("SELECT * FROM config WHERE key = 'refund_limit_cents'")).value;
});

after(async () => {
  for (const name of apis) await call(founder, 'retire_api', [name, 'Refund test cleanup.']);
  await call(founder, 'set_config', ['refund_limit_cents', limitBefore ?? '500']);
});

test('a COO rejection refunds the paid order in full', async () => {
  const ref = `rf-${stamp}-reject`;
  const o = await paidOrder(ref, 100);
  ok(await call(coo, 'coo_decide', [o.id, 'REJECT', '', 'Fares only exist after a search form (test).']));

  const after = await orderByRef(ref);
  assert.equal(after.status, 'rejected');
  const [refund] = await refundsOf(o.id);
  assert.deepEqual([refund.status, num(refund.amount_cents), num(refund.challenge_id)], ['issued', 100, 0]);
  assert.equal(await balance(`customer:${o.id}`), 0n, 'the customer account is back to zero');
  const ev = (await sql(founder, "SELECT * FROM event WHERE kind = 'order_refunded'")).find((e) => num(e.ref_id) === num(o.id));
  assert.ok(ev, 'an order_refunded event is written');
  assert.equal(JSON.parse(ev.payload).cause, 'coo_rejected');
  assert.equal(JSON.parse(ev.payload).status, 'issued');
  assert.equal(await booksSum(), 0n);
});

test('a counteroffer refunds and leaves the order counteroffered', async () => {
  const ref = `rf-${stamp}-counter`;
  const o = await paidOrder(ref, 100);
  ok(await call(coo, 'coo_decide', [o.id, 'COUNTEROFFER', '', 'Too broad; the top 25 pages instead.']));

  assert.equal((await orderByRef(ref)).status, 'counteroffered', 'the state still means "a smaller scope was proposed"');
  const [refund] = await refundsOf(o.id);
  assert.deepEqual([refund.status, num(refund.amount_cents)], ['issued', 100]);
  assert.equal(await balance(`customer:${o.id}`), 0n);
  const ev = (await sql(founder, "SELECT * FROM event WHERE kind = 'order_refunded'")).find((e) => num(e.ref_id) === num(o.id));
  assert.equal(JSON.parse(ev.payload).cause, 'coo_counteroffered');
  assert.equal(await booksSum(), 0n);
});

test('a failed run is retried exactly once, then fails and refunds', { timeout: 90_000 }, async () => {
  const api = await apiWith('rf-api-retry', 'fake-task-id');
  const ref = `rf-${stamp}-retry`;
  const o = await paidOrder(ref, 100);
  ok(await call(coo, 'coo_decide', [o.id, 'ACCEPT', api, 'Existing api fits (test).']));

  const retried = await until(async () => (await kindsOf(o.id)).includes('order_run_retried'));
  assert.ok(retried, `the failed start is retried: ${(await kindsOf(o.id)).join(', ')}`);
  const midway = await orderByRef(ref);
  assert.equal(midway.status, 'accepted', 'the order goes back to accepted for the retry');
  const retryEvent = (await sql(founder, "SELECT * FROM event WHERE kind = 'order_run_retried'")).find((e) => num(e.ref_id) === num(o.id));
  assert.equal(JSON.parse(retryEvent.payload).attempt, 2, 'the retry is the second attempt');

  const failed = await until(async () => (await orderByRef(ref)).status === 'failed');
  assert.ok(failed, 'the second failure ends the order');
  assert.match((await orderByRef(ref)).decision_reason, /after a retry/);
  const [refund] = await refundsOf(o.id);
  assert.deepEqual([refund.status, num(refund.amount_cents)], ['issued', 100]);
  assert.equal(await balance(`customer:${o.id}`), 0n);
  assert.equal((await kindsOf(o.id)).filter((k) => k === 'order_run_retried').length, 1, 'exactly one retry');
  assert.equal(await booksSum(), 0n);
});

test('a config failure fails and refunds without a retry', { timeout: 60_000 }, async () => {
  const api = await apiWith('rf-api-norun', '');
  const ref = `rf-${stamp}-nover`;
  const o = await paidOrder(ref, 100);
  ok(await call(coo, 'coo_decide', [o.id, 'ACCEPT', api, 'Existing api fits (test).']));

  const failed = await until(async () => (await orderByRef(ref)).status === 'failed');
  assert.ok(failed, 'the order fails');
  assert.match((await orderByRef(ref)).decision_reason, /no runnable version/);
  assert.ok(!(await kindsOf(o.id)).includes('order_run_retried'), 'no retry for a config problem');
  const [refund] = await refundsOf(o.id);
  assert.equal(refund.status, 'issued');
  assert.equal(await balance(`customer:${o.id}`), 0n);
  assert.equal(await booksSum(), 0n);
});

test('a refund over refund_limit_cents waits on the founder', async () => {
  ok(await call(founder, 'set_config', ['refund_limit_cents', '50']));
  const ref = `rf-${stamp}-over`;
  const o = await paidOrder(ref, 100);
  ok(await call(coo, 'coo_decide', [o.id, 'REJECT', '', 'Terms forbid automated collection (test).']));

  const [refund] = await refundsOf(o.id);
  assert.deepEqual([refund.status, num(refund.amount_cents)], ['pending_approval', 100]);
  assert.equal(await balance(`customer:${o.id}`), -100n, 'nothing moves before the approval');
  const ap = (await sql(founder, 'SELECT * FROM approval')).find((a) => num(a.ref_id) === num(refund.id) && a.kind === 'refund_over_limit');
  assert.deepEqual([ap.status, num(ap.amount_cents)], ['pending', 100]);
  assert.equal(JSON.parse(ap.detail).cause, 'coo_rejected');
  assert.equal(await booksSum(), 0n);

  ok(await call(founder, 'decide_approval', [ap.id, true]));
  assert.equal((await sql(founder, 'SELECT * FROM refund')).find((r) => num(r.id) === num(refund.id)).status, 'issued');
  assert.equal(await balance(`customer:${o.id}`), 0n, 'the founder-approved refund moves the money');
  assert.equal(await booksSum(), 0n);
  ok(await call(founder, 'set_config', ['refund_limit_cents', limitBefore ?? '500']));
});

test('refund_order is the founder rescue and refuses anything that is not a dead paid order', async () => {
  const quotedRef = `rf-${stamp}-quoted`;
  ok(await call(desk, 'create_order', [quotedRef, SENDER, 'refund test: quoted only', '{}', 100]));
  const quoted = await orderByRef(quotedRef);
  const deskRef = `rf-${stamp}-desk`;
  ok(await call(desk, 'reject_at_desk', [deskRef, SENDER, 'Emails of engineers (test)', '{}', 'personal_data', 'asks for emails']));
  const deskOrder = await orderByRef(deskRef);

  assert.match((await call(coo, 'refund_order', [quoted.id, 'x'])).body, /may not do this/);
  assert.match((await call(desk, 'refund_order', [quoted.id, 'x'])).body, /may not do this/);
  assert.match((await call(founder, 'refund_order', [quoted.id, 'x'])).body, /is quoted; only rejected/);
  assert.match((await call(founder, 'refund_order', [deskOrder.id, 'x'])).body, /is rejected_at_desk; only rejected/);
  assert.match((await call(founder, 'refund_order', [quoted.id, ' '])).body, /reason is required/);
  assert.equal((await sql(founder, 'SELECT * FROM refund')).filter((r) => num(r.order_id) === num(quoted.id)).length, 0);

  // A dead paid order whose refund was declined: the money is still the customer's, so the founder moves it back.
  ok(await call(founder, 'set_config', ['refund_limit_cents', '0']));
  const ref = `rf-${stamp}-rescue`;
  const o = await paidOrder(ref, 100);
  ok(await call(coo, 'coo_decide', [o.id, 'REJECT', '', 'Terms forbid automated collection (test).']));
  ok(await call(founder, 'set_config', ['refund_limit_cents', limitBefore ?? '500']));
  const [declined] = await refundsOf(o.id);
  assert.equal(declined.status, 'pending_approval');
  const ap = (await sql(founder, 'SELECT * FROM approval')).find((a) => num(a.ref_id) === num(declined.id));
  ok(await call(founder, 'decide_approval', [ap.id, false]));
  assert.equal((await refundsOf(o.id))[0].status, 'rejected');
  assert.equal(await balance(`customer:${o.id}`), -100n, 'a declined refund leaves the payment with us');

  ok(await call(founder, 'refund_order', [o.id, 'the customer asked again']));
  const issued = await refundsOf(o.id);
  assert.equal(issued.length, 2);
  assert.equal(issued.find((r) => r.status === 'issued').amount_cents, 100);
  assert.equal(await balance(`customer:${o.id}`), 0n);
  const ev = (await sql(founder, "SELECT * FROM event WHERE kind = 'order_refund_requested'")).find((e) => num(e.ref_id) === num(o.id));
  assert.equal(JSON.parse(ev.payload).reason, 'the customer asked again');
  assert.match((await call(founder, 'refund_order', [o.id, 'again'])).body, /nothing left to refund/);
  assert.equal(await booksSum(), 0n);
});
