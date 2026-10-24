// Flow A reducers against Maincloud with real seat identities (SPACETIME_TOKEN_<ROLE> in .env).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, founderToken, newIdentity } from './client.mjs';

const seat = (role) => {
  const tok = process.env[`SPACETIME_TOKEN_${role.toUpperCase()}`];
  if (!tok) throw new Error(`SPACETIME_TOKEN_${role.toUpperCase()} is not set`);
  return tok;
};
const stamp = Date.now();
let founder, desk, coo, auditor, stranger;

before(async () => {
  founder = founderToken();
  [desk, coo, auditor] = ['front_desk', 'coo', 'auditor'].map(seat);
  stranger = (await newIdentity()).token;
});

const orderByRef = async (ref) => (await sql(founder, `SELECT * FROM orders WHERE ref = '${ref}'`))[0];
const ok = (r) => assert.equal(r.status, 200, r.body);

test('desk quotes, then payment books the ledger and queues COO triage', async () => {
  const ref = `t-${stamp}-a`;
  ok(await call(desk, 'create_order', [ref, `asi-test-${stamp}`, 'RTX listings', '{"fields":["price"]}', 100]));
  const o = await orderByRef(ref);
  assert.equal(o.status, 'quoted');
  const gc = await sql(founder, `SELECT * FROM gate_check WHERE check = 'layer2'`);
  assert.ok(gc.some((g) => JSON.stringify(g.order_id).includes(String(o.id))));

  ok(await call(desk, 'record_payment', [ref, 'cs_test_fake']));
  assert.equal((await orderByRef(ref)).status, 'paid');
  const tasks = await sql(founder, `SELECT * FROM task WHERE kind = 'coo_triage'`);
  assert.ok(tasks.some((t) => JSON.stringify(t.order_id).includes(String(o.id)) && ['queued', 'dispatched'].includes(t.status)));
  const books = await sql(founder, `SELECT * FROM books WHERE account = 'customer:${o.id}'`);
  assert.equal(Number(books[0].balance_cents), -100);
});

test('paying twice is rejected', async () => {
  const ref = `t-${stamp}-a`;
  const r = await call(desk, 'record_payment', [ref, 'cs_test_fake']);
  assert.equal(r.ok, false);
  assert.match(r.body, /not quoted/);
});

test('only the COO seat can decide, with a reason and a known decision', async () => {
  const o = await orderByRef(`t-${stamp}-a`);
  for (const tok of [desk, auditor, stranger]) {
    const r = await call(tok, 'coo_decide', [o.id, 'REJECT', '', 'no']);
    assert.equal(r.ok, false);
  }
  assert.equal((await call(coo, 'coo_decide', [o.id, 'MAYBE', '', 'x'])).ok, false);
  assert.equal((await call(coo, 'coo_decide', [o.id, 'REJECT', '', '  '])).ok, false);
  const unknown = await call(coo, 'coo_decide', [o.id, 'ACCEPT', 'no-such-api', 'fits']);
  assert.match(unknown.body, /no api/);
});

test('COO rejection closes the triage task with the cited reason', async () => {
  const o = await orderByRef(`t-${stamp}-a`);
  ok(await call(coo, 'coo_decide', [o.id, 'REJECT', '', 'Fares only exist after a search form (test).']));
  const after = await orderByRef(`t-${stamp}-a`);
  assert.equal(after.status, 'rejected');
  assert.match(after.decision_reason, /search form/);
  const tasks = await sql(founder, `SELECT * FROM task WHERE kind = 'coo_triage'`);
  const mine = tasks.find((t) => JSON.stringify(t.order_id).includes(String(o.id)));
  assert.equal(mine.status, 'done');
});

test('ACCEPT on an API with no runnable version fails the order instead of hanging', async () => {
  const name = `test-${stamp}`;
  const spec = { name, description: 'test api', sources: ['https://example.com'], outputSchema: { properties: { title: { type: 'string' } } }, volatility: 'stable' };
  ok(await call(founder, 'create_api', [JSON.stringify(spec), '', 'task']));
  assert.equal((await call(desk, 'create_api', [JSON.stringify({ ...spec, name: `${name}-x` }), '', 'task'])).ok, false);
  const ref = `t-${stamp}-b`;
  ok(await call(desk, 'create_order', [ref, `asi-test-${stamp}`, 'test', '{}', 100]));
  ok(await call(desk, 'record_payment', [ref, 'cs_test_fake']));
  const o = await orderByRef(ref);
  ok(await call(coo, 'coo_decide', [o.id, 'ACCEPT', name, 'existing api fits']));
  let status;
  for (let i = 0; i < 20; i++) {
    status = (await orderByRef(ref)).status;
    if (status === 'failed') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(status, 'failed', 'the scheduled run procedure fails it');
});

test('desk rejection records the failed gate check without a task', async () => {
  const ref = `t-${stamp}-c`;
  ok(await call(desk, 'reject_at_desk', [ref, `asi-test-${stamp}`, 'Emails of engineers at Stripe', '{}', 'personal_data', 'asks for emails']));
  const o = await orderByRef(ref);
  assert.equal(o.status, 'rejected_at_desk');
  const tasks = await sql(founder, `SELECT * FROM task WHERE kind = 'coo_triage'`);
  assert.ok(!tasks.some((t) => JSON.stringify(t.order_id).includes(`${o.id}]`)));
});

test('the auditor can only rule on an order that is being audited', async () => {
  const o = await orderByRef(`t-${stamp}-a`);
  const r = await call(auditor, 'audit_verdict', [o.id, 'ACCEPT', 'looks fine']);
  assert.match(r.body, /not auditing/);
});

test('the public books balance to zero', async () => {
  const rows = await sql(founder, 'SELECT * FROM books');
  const sum = rows.reduce((s, r) => s + BigInt(r.balance_cents), 0n);
  assert.equal(sum, 0n);
});
