// Canary isolation, order params, exact run costs, API maintenance and the volatile re-check rule,
// against Maincloud with real seat identities (SPACETIME_TOKEN_<ROLE> in .env).
// The run test starts a real Apify Task run and Bright Data verification (a few minutes).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, founderToken } from './client.mjs';

const seat = (role) => {
  const tok = process.env[`SPACETIME_TOKEN_${role.toUpperCase()}`];
  if (!tok) throw new Error(`SPACETIME_TOKEN_${role.toUpperCase()} is not set`);
  return tok;
};
const stamp = Date.now();
let founder, canary, coo, auditor, desk;

before(() => {
  founder = founderToken();
  [canary, coo, auditor, desk] = ['canary', 'coo', 'auditor', 'front_desk'].map(seat);
});

const ok = (r) => assert.equal(r.status, 200, r.body);
const opt = (v) => (Array.isArray(v) && v[0] === 0 ? v[1] : undefined); // SATS option
const orderByRef = async (ref) => (await sql(founder, `SELECT * FROM orders WHERE ref = '${ref}'`))[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newOrder = async (ref, params) => {
  ok(await call(canary, 'create_order', [ref, 'canary', `fixes test ${ref}`, '{"origin":"test"}', 0]));
  if (params) ok(await call(canary, 'set_order_params', [ref, params]));
  ok(await call(canary, 'record_payment', [ref, 'canary-no-payment']));
  return orderByRef(ref);
};

test('set_order_params checks syntax and only the desk seats may call it', async () => {
  const ref = `fx-${stamp}-p`;
  ok(await call(canary, 'create_order', [ref, 'canary', 'params test', '{}', 0]));
  for (const bad of ['{"board":"../x"}', '{"board":"Stripe"}', '{"board":"a.b"}', '["x"]', 'nope', '{"board":1}']) {
    const r = await call(canary, 'set_order_params', [ref, bad]);
    assert.equal(r.status, 530, `${bad}: ${r.body}`);
  }
  assert.equal((await call(coo, 'set_order_params', [ref, '{"board":"x"}'])).ok, false);
  ok(await call(canary, 'set_order_params', [ref, '{"board":"lattice"}']));
  assert.equal((await orderByRef(ref)).params, '{"board":"lattice"}');
  const [mark] = await sql(founder, `SELECT * FROM canary_order WHERE order_id = ${(await orderByRef(ref)).id}`);
  assert.ok(mark, 'an order created by the canary seat is marked');
});

test('the COO cannot accept params the API does not declare', async () => {
  const o = await newOrder(`fx-${stamp}-q`, '{"board":"lattice"}');
  const r = await call(coo, 'coo_decide', [o.id, 'ACCEPT', 'yc-directory', 'test']);
  assert.match(r.body, /do not fit api yc-directory: unknown param board/);
  ok(await call(coo, 'coo_decide', [o.id, 'REJECT', '', 'Test cleanup: params do not fit.']));
  const after = await call(canary, 'set_order_params', [`fx-${stamp}-q`, '{}']);
  assert.match(after.body, /params are fixed/);
});

test('a canary open-roles order with board=lattice runs that board, is never audited and books exact costs', { timeout: 8 * 60_000 }, async () => {
  const [apiBefore] = await sql(founder, "SELECT * FROM api WHERE name = 'open-roles'");
  const ref = `fx-${stamp}-run`;
  const o = await newOrder(ref, '{"board":"lattice"}');
  ok(await call(coo, 'coo_decide', [o.id, 'ACCEPT', 'open-roles', 'Test: param override on open-roles.']));
  const t0 = Date.now();
  let cur = o;
  while (Date.now() - t0 < 7 * 60_000) {
    cur = await orderByRef(ref);
    if (['auditing', 'failed', 'delivered'].includes(cur.status)) break;
    if (cur.status === 'running' && Date.now() - t0 > 90_000 && cur.apify_run_id) {
      const [run] = await sql(founder, `SELECT * FROM run WHERE external_id = '${cur.apify_run_id}'`);
      if (run) await call(canary, 'apify_poll', [run.id]);
    }
    await sleep(3_000);
  }
  assert.equal(cur.status, 'auditing', `${cur.status}: ${cur.decision_reason}`);

  const started = (await sql(founder, "SELECT * FROM event WHERE kind = 'api_run_started'"))
    .map((e) => ({ ...e, p: JSON.parse(e.payload) })).find((e) => Number(e.ref_id) === Number(o.id));
  assert.deepEqual(started.p.input.sources, ['https://boards-api.greenhouse.io/v1/boards/lattice/departments']);
  assert.deepEqual(started.p.params, { board: 'lattice' });
  const values = await sql(founder, `SELECT * FROM value_record WHERE order_id = ${o.id}`);
  assert.ok(values.length > 0, 'values ingested');
  assert.ok(values.every((v) => v.source_url.includes('/boards/lattice/')), 'every value comes from the lattice board');
  const teams = [...new Set(values.filter((v) => v.metric === 'team').map((v) => v.value))];
  assert.ok(teams.length > 0, 'departments extracted');
  const verified = values.filter((v) => v.status === 'verified').length;
  console.log(JSON.stringify({ orderId: Number(o.id), values: values.length, verified, teams }));

  const audits = (await sql(founder, "SELECT * FROM task WHERE kind = 'audit'")).filter((t) => Number(opt(t.order_id)) === Number(o.id));
  assert.equal(audits.length, 0, 'no audit task for a canary order');
  const skipped = await sql(founder, `SELECT * FROM event WHERE kind = 'audit_skipped_canary' AND ref_id = ${o.id}`);
  assert.equal(skipped.length, 1);
  assert.match((await call(auditor, 'audit_verdict', [o.id, 'ACCEPT', 'test'])).body, /canary orders are not audited/);

  const [run] = await sql(founder, `SELECT * FROM run WHERE external_id = '${cur.apify_run_id}'`);
  const [cost] = await sql(founder, `SELECT * FROM run_cost WHERE run_id = ${run.id}`);
  assert.ok(cost, 'run_cost row');
  assert.equal(cost.finalized, true);
  assert.ok(Number(cost.apify_micros) > 0, 'Apify usage recorded');
  assert.ok(Number(cost.llm_input_tokens) > 0 && Number(cost.llm_output_tokens) > 0, 'token usage from RUN_SUMMARY');
  assert.ok(cost.actor_unlocker_requests >= 1 && cost.verify_unlocker_requests >= 1);
  assert.equal(BigInt(cost.total_micros), BigInt(cost.apify_micros) + BigInt(cost.llm_micros) + BigInt(cost.brightdata_micros));
  // Apify's usage settles after the run ends; settle_run_cost re-reads it about a minute later.
  const apifyRun = await (await fetch(`https://api.apify.com/v2/actor-runs/${cur.apify_run_id}`, { headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}` } })).json();
  let settled = cost;
  for (let i = 0; i < 30 && Number(settled.apify_micros) !== Math.round(apifyRun.data.usageTotalUsd * 1e6); i++) {
    await sleep(5_000);
    [settled] = await sql(founder, `SELECT * FROM run_cost WHERE run_id = ${run.id}`);
  }
  const apifyNow = await (await fetch(`https://api.apify.com/v2/actor-runs/${cur.apify_run_id}`, { headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}` } })).json();
  assert.equal(Number(settled.apify_micros), Math.round(apifyNow.data.usageTotalUsd * 1e6), 'run_cost holds the settled Apify usage');
  assert.equal(BigInt(settled.total_micros), BigInt(settled.apify_micros) + BigInt(settled.llm_micros) + BigInt(settled.brightdata_micros));
  const [apiCost] = await sql(founder, `SELECT * FROM api_cost WHERE api_id = ${apiBefore.id}`);
  assert.ok(Number(apiCost.cost_per_call_micros) > 0);
  console.log(JSON.stringify({ cost: settled, apiCostPerCallMicros: apiCost.cost_per_call_micros }));

  const [apiAfter] = await sql(founder, "SELECT * FROM api WHERE name = 'open-roles'");
  assert.equal(apiAfter.buyer_count, apiBefore.buyer_count, 'canary orders are not buyers');
  const books = await sql(founder, 'SELECT * FROM books');
  assert.equal(books.reduce((s, r) => s + BigInt(r.balance_cents), 0n), 0n);
});

test('update_api is founder-only, keeps the schema and rejects host templates', async () => {
  assert.equal((await call(coo, 'update_api', ['yc-directory', '{"pageCap":1}'])).ok, false);
  assert.match((await call(founder, 'update_api', ['yc-directory', '{"outputSchema":{}}'])).body, /may only set/);
  assert.match((await call(founder, 'update_api', ['yc-directory', JSON.stringify({ inputs: { co: {} }, sources: ['https://{co}.example.com/'] })])).body, /host/);
  assert.match((await call(founder, 'update_api', ['yc-directory', JSON.stringify({ sources: ['https://x.com/{nope}'] })])).body, /undeclared param/);
  assert.match((await call(founder, 'update_api', ['yc-directory', '{"pageCap":0}'])).body, /pageCap/);
  ok(await call(founder, 'update_api', ['yc-directory', '{"pageCap":1}']));
  const [yc] = await sql(founder, "SELECT * FROM api WHERE name = 'yc-directory'");
  assert.equal(yc.page_cap, 1);
});

test('retire_api hides an unused API from acceptance; APIs with buyers or seats other than founder cannot retire', async () => {
  const name = `retire-${stamp}`;
  ok(await call(founder, 'create_api', [JSON.stringify({ name, description: 'retire test', sources: ['https://example.com'], outputSchema: { properties: { title: {} } }, volatility: 'stable' }), '', 'task']));
  assert.equal((await call(coo, 'retire_api', [name, 'x'])).ok, false);
  assert.match((await call(founder, 'retire_api', [name, ' '])).body, /reason/);
  ok(await call(founder, 'retire_api', [name, 'Test API.']));
  assert.match((await call(founder, 'retire_api', [name, 'again'])).body, /already retired/);
  const o = await newOrder(`fx-${stamp}-r`);
  assert.match((await call(coo, 'coo_decide', [o.id, 'ACCEPT', name, 'test'])).body, /is retired/);
  ok(await call(coo, 'coo_decide', [o.id, 'REJECT', '', 'Test cleanup: retired api.']));
  const [leftover] = await sql(founder, "SELECT * FROM api_retired WHERE name = 'test-1792875081507'");
  assert.ok(leftover, 'the leftover Gate 1 test API is retired');
});

const probe = async (args) => {
  const marker = `probe-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  ok(await call(founder, 'verify_probe', [...args, marker]));
  const ev = await sql(founder, "SELECT * FROM event WHERE kind = 'verify_probe'");
  return ev.map((e) => JSON.parse(e.payload)).find((p) => p.marker === marker);
};

test('volatile re-check on a live page: verified, stale with the fresh value, or mismatch when stable', { timeout: 4 * 60_000 }, async () => {
  const url = 'https://www.ycombinator.com/companies/airbnb';
  const [same, changed, stable] = await Promise.all([
    probe([url, 'Batch: Winter 2009', 'Winter 2009', 'Airbnb', 'volatile']),
    probe([url, 'Batch: Winter 2010', 'Winter 2010', 'Airbnb', 'volatile']),
    probe([url, 'Batch: Winter 2010', 'Winter 2010', 'Airbnb', 'stable']),
  ]);
  for (const p of [same, changed, stable]) assert.equal(p.pageOk, true, p.reason);
  assert.equal(same.status, 'verified');
  assert.deepEqual([changed.status, changed.freshValue], ['stale', 'Winter 2009']);
  assert.equal(stable.status, 'mismatch');
});

test('volatile re-check finds a changed listing price through the product name on Newegg', { timeout: 4 * 60_000 }, async () => {
  const [api] = await sql(founder, "SELECT * FROM api WHERE name = 'gpu-listings'");
  const prices = (await sql(founder, `SELECT * FROM value_record WHERE api_id = ${api.id}`))
    .filter((v) => v.metric === 'price' && v.status === 'verified' && v.excerpt === v.value && !/^listing \d+$/i.test(v.entity));
  assert.ok(prices.length, 'a verified bare price from a past gpu-listings run');
  const rec = prices.sort((a, b) => Number(b.id) - Number(a.id))[0];
  const p = await probe([rec.source_url, '$ 9,999 .99', '$ 9,999 .99', rec.entity, 'volatile']);
  assert.equal(p.pageOk, true, p.reason);
  console.log(JSON.stringify({ entity: rec.entity, recorded: rec.value, probe: p }));
  assert.equal(p.status, 'stale');
  assert.match(p.freshValue, /^\$ \d[\d,]* \.\d\d$/);
});
