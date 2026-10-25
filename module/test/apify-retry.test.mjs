// Real provider runs, isolated local database. Fault injection is SIMULATED QA, never demo evidence.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { HOST, call, sql, newIdentity, founderToken, identityArg } from './client.mjs';
const enabled = process.env.FORGE_TEST_AUDIT_LIVE === 'true' && Boolean(process.env.APIFY_TOKEN);
let founder, desk, coo;
const names = [], taskIds = [];
const stamp = Date.now();
const ok = (r) => assert.equal(r.status, 200, r.body);
const one = async (q) => (await sql(founder, q))[0];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function apify(path, init = {}) {
  const response = await fetch(`https://api.apify.com/v2${path}`, { ...init, headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}`, 'Content-Type': 'application/json' } });
  assert.ok(response.ok, `${response.status}: ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}
async function create(name, engineId, engine) {
  names.push(name);
  ok(await call(founder, 'create_api', [JSON.stringify({ name, description: 'SIMULATED QA retry fixture',
    sources: ['https://boards-api.greenhouse.io/v1/boards/lattice/departments'], outputSchema: { properties: { title: { type: 'string' }, team: { type: 'string' }, location: { type: 'string' } } }, volatility: 'stable', pageCap: 1 }), engineId, engine]));
  const ref = `qa-retry-${name}`;
  ok(await call(desk, 'create_order', [ref, 'asi-simulated-retry-qa', 'SIMULATED QA retry test', '{}', 100]));
  ok(await call(desk, 'record_payment', [ref, `demo-simulated:${ref}`]));
  const o = await one(`SELECT * FROM orders WHERE ref = '${ref}'`);
  ok(await call(coo, 'coo_decide', [o.id, 'ACCEPT', name, 'SIMULATED QA retry workflow']));
  return o;
}
async function wait(fn, ms = 180_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await pause(750); }
  throw new Error('workflow timeout');
}
async function poll(o, terminal) {
  return wait(async () => {
    const row = await one(`SELECT * FROM orders WHERE id = ${o.id}`);
    if (row.status === 'running' && row.apify_run_id) {
      const run = await one(`SELECT * FROM run WHERE external_id = '${row.apify_run_id}'`);
      if (run) ok(await call(founder, 'apify_poll', [run.id]));
    }
    return terminal.includes(row.status) ? row : null;
  });
}
const retryEvents = async (id) => (await sql(founder, "SELECT * FROM event WHERE kind = 'order_run_retried'")).filter((e) => e.ref_id === id);
before(async () => {
  if (!enabled) return;
  assert.match(HOST, /^http:\/\/127\.0\.0\.1:/);
  founder = founderToken();
  [desk, coo] = await Promise.all(['front_desk', 'coo'].map(async (role) => {
    const seat = await newIdentity(); ok(await call(founder, 'set_staff', [identityArg(seat.identity), role, `retry-${role}`])); return seat.token;
  }));
});
after(async () => {
  if (!enabled) return;
  for (const name of names) await call(founder, 'retire_api', [name, 'SIMULATED QA cleanup']);
  for (const id of taskIds) await apify(`/actor-tasks/${id}`, { method: 'DELETE' });
});
test('ingest retries a real timed-out run once, then refunds', { skip: !enabled, timeout: 240_000 }, async () => {
  const actor = (await apify(`/acts/${process.env.APIFY_USERNAME}~forge-extract`)).data;
  const created = (await apify('/actor-tasks', { method: 'POST', body: JSON.stringify({ actId: actor.id, name: `qa-timeout-${stamp}`,
    input: { sources: ['https://example.com'], outputSchema: { properties: { title: { type: 'string' } } }, instructions: 'Read the public page title' }, options: { timeoutSecs: 1, memoryMbytes: 1024 } }) })).data;
  taskIds.push(created.id);
  const o = await create(`qa-timeout-${stamp}`, created.id, 'task');
  const done = await poll(o, ['failed']);
  assert.match(done.decision_reason, /after a retry/);
  assert.equal((await retryEvents(o.id)).length, 1);
  assert.equal((await one(`SELECT * FROM refund WHERE order_id = ${o.id}`)).status, 'issued');
  assert.equal(Number((await one(`SELECT * FROM books WHERE account = 'customer:${o.id}'`)).balance_cents), 0);
});
test('a real aborted run retries successfully without a refund', { skip: !enabled, timeout: 240_000 }, async () => {
  const o = await create(`qa-abort-${stamp}`, 'RdQhIe6Jj6mE2qT4L', 'actor');
  const running = await wait(async () => { const r = await one(`SELECT * FROM orders WHERE id = ${o.id}`); return r.status === 'running' ? r : null; });
  await apify(`/actor-runs/${running.apify_run_id}/abort`, { method: 'POST' });
  const done = await poll(o, ['auditing', 'failed']);
  assert.equal(done.status, 'auditing', done.decision_reason);
  assert.equal((await retryEvents(o.id)).length, 1);
  assert.equal((await sql(founder, `SELECT * FROM refund WHERE order_id = ${o.id}`)).length, 0);
  assert.equal(Number((await one(`SELECT * FROM books WHERE account = 'customer:${o.id}'`)).balance_cents), -100);
});
