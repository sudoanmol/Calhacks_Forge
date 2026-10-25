// Opt-in local integration against the real deployed Actor, Apify storage and Bright Data.
// Test verdicts below are explicitly SIMULATED QA decisions, never demo proof of a real error.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { HOST, call, sql, newIdentity, founderToken, identityArg } from './client.mjs';
const enabled = process.env.FORGE_TEST_AUDIT_LIVE === 'true';
const stamp = Date.now();
let founder, desk, coo, auditor;
const apis = [];
const ok = (r) => assert.equal(r.status, 200, r.body);
const one = async (q) => (await sql(founder, q))[0];
const opt = (v) => Array.isArray(v) && v[0] === 0 ? v[1] : undefined;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 180_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await pause(500); }
  throw new Error('timed out');
}
async function api(suffix, source) {
  const name = `audit-${suffix}-${stamp}`;
  ok(await call(founder, 'create_api', [JSON.stringify({ name, description: 'SIMULATED QA workflow over real public data',
    sources: [source], outputSchema: { properties: { title: { type: 'string' }, team: { type: 'string' }, location: { type: 'string' } } }, volatility: 'stable', pageCap: 1 }), 'RdQhIe6Jj6mE2qT4L', 'actor']));
  apis.push(name); return name;
}
async function auditing(name, cents = 100) {
  const ref = `audit-live-${Date.now()}`;
  ok(await call(desk, 'create_order', [ref, 'asi-audit-live-simulated-qa', 'SIMULATED QA: open roles', '{}', cents]));
  ok(await call(desk, 'record_payment', [ref, `demo-simulated:${ref}`]));
  const o = await one(`SELECT * FROM orders WHERE ref = '${ref}'`);
  ok(await call(coo, 'coo_decide', [o.id, 'ACCEPT', name, 'SIMULATED QA: exercise the deployed Actor']));
  return until(async () => {
    const current = await one(`SELECT * FROM orders WHERE id = ${o.id}`);
    assert.notEqual(current.status, 'failed', current.decision_reason);
    if (current.status === 'running' && current.apify_run_id) {
      const run = await one(`SELECT * FROM run WHERE external_id = '${current.apify_run_id}'`);
      if (run) ok(await call(founder, 'apify_poll', [run.id]));
    }
    return current.status === 'auditing' ? current : null;
  });
}
before(async () => {
  if (!enabled) return;
  assert.match(HOST, /^http:\/\/127\.0\.0\.1:/);
  founder = founderToken();
  [desk, coo, auditor] = await Promise.all(['front_desk', 'coo', 'auditor'].map(async (role) => {
    const seat = await newIdentity(); ok(await call(founder, 'set_staff', [identityArg(seat.identity), role, `audit-live-${role}`])); return seat.token;
  }));
});
after(async () => {
  if (!enabled) return;
  for (const name of apis) await call(founder, 'retire_api', [name, 'SIMULATED QA cleanup']);
});
test('real verified delivery refuses arbitrary refunds; declined challenge refund can be requested again', { skip: !enabled, timeout: 300_000 }, async () => {
  const name = await api('delivery', 'https://boards-api.greenhouse.io/v1/boards/lattice/departments');
  const o = await auditing(name, 600);
  const values = await sql(founder, `SELECT * FROM value_record WHERE order_id = ${o.id}`);
  const v = values.find((v) => v.status === 'verified' && v.metric !== '_page');
  assert.ok(v, 'real independent verification produced facts');
  ok(await call(auditor, 'audit_verdict', [o.id, 'ACCEPT', 'SIMULATED QA: independent re-fetch verified values']));
  assert.equal((await call(founder, 'refund_order', [o.id, 'arbitrary refund'])).status, 530);
  ok(await call(desk, 'open_challenge', [o.id, 'asi-audit-live-simulated-qa', v.row, v.metric, 'SIMULATED QA challenge for refund approval regression']));
  const ch = await until(async () => (await sql(founder, 'SELECT * FROM challenge')).find((c) => c.order_id === o.id && c.status === 'auditing'));
  ok(await call(auditor, 'challenge_verdict', [ch.id, 'UPHELD', 'SIMULATED QA verdict only; not evidence of an actual extraction error']));
  const refund = await one(`SELECT * FROM refund WHERE order_id = ${o.id}`);
  const approval = (await sql(founder, 'SELECT * FROM approval')).find((a) => a.kind === 'refund_over_limit' && a.ref_id === refund.id);
  ok(await call(founder, 'decide_approval', [approval.id, false]));
  ok(await call(founder, 'refund_order', [o.id, 'SIMULATED QA: reconsider declined challenge refund']));
  const refunds = await sql(founder, `SELECT * FROM refund WHERE order_id = ${o.id}`);
  const pending = refunds.find((r) => r.status === 'pending_approval');
  assert.equal(pending.challenge_id, ch.id);
  const next = (await sql(founder, 'SELECT * FROM approval')).find((a) => a.kind === 'refund_over_limit' && a.ref_id === pending.id);
  assert.equal(JSON.parse(next.detail).cause, 'founder');
  ok(await call(founder, 'decide_approval', [next.id, true]));
  assert.equal(Number((await one(`SELECT * FROM books WHERE account = 'customer:${o.id}'`)).balance_cents), 0);
});
test('real Actor output without verified values cannot deliver; Auditor REJECT refunds', { skip: !enabled, timeout: 240_000 }, async () => {
  const name = await api('empty', 'https://example.com');
  const o = await auditing(name);
  const result = await call(auditor, 'audit_verdict', [o.id, 'ACCEPT', 'SIMULATED QA invalid accept']);
  assert.equal(result.status, 530); assert.match(result.body, /no verified values/);
  ok(await call(auditor, 'audit_verdict', [o.id, 'REJECT', 'SIMULATED QA: zero verified values']));
  assert.equal((await one(`SELECT * FROM refund WHERE order_id = ${o.id}`)).status, 'issued');
});
test('founder can stop an auditing order after cancelling the audit task', { skip: !enabled, timeout: 240_000 }, async () => {
  const o = await auditing(apis[0]);
  const task = (await sql(founder, 'SELECT * FROM task')).find((t) => opt(t.order_id) === o.id && t.kind === 'audit' && t.status === 'queued');
  ok(await call(founder, 'cancel_task', [task.id, 'SIMULATED QA stop']));
  ok(await call(founder, 'refund_order', [o.id, 'SIMULATED QA stop after real collection']));
  assert.equal((await one(`SELECT * FROM orders WHERE id = ${o.id}`)).status, 'failed');
  assert.equal((await call(auditor, 'audit_verdict', [o.id, 'ACCEPT', 'late'])).status, 530);
  assert.equal((await sql(founder, 'SELECT * FROM books')).reduce((sum, b) => sum + BigInt(b.balance_cents), 0n), 0n);
});
