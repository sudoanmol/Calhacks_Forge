// Real Maincloud scheduling and Bright Data fetches; canary orders never dispatch paid CREAO runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, founderToken } from './client.mjs';

const founder = founderToken();
const canary = process.env.SPACETIME_TOKEN_CANARY;
const coo = process.env.SPACETIME_TOKEN_COO;
const opt = (v) => Array.isArray(v) && v[0] === 0 ? v[1] : undefined;
const ok = (r) => assert.equal(r.status, 200, r.body);
const one = async (query) => (await sql(founder, query))[0];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(source) {
  const ref = `admission-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  ok(await call(canary, 'create_order', [ref, 'canary', 'Public building opening year', JSON.stringify({ sources: [source], fields: ['opened'] }), 0]));
  ok(await call(canary, 'record_payment', [ref, 'canary-no-payment']));
  const order = await one(`SELECT * FROM orders WHERE ref = '${ref}'`);
  ok(await call(coo, 'coo_decide', [order.id, 'REQUEST_RESEARCH', '', 'Test mechanical checks before Research.']));
  return order;
}
async function until(orderId, statuses, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const job = await one(`SELECT * FROM admission_job WHERE order_id = ${orderId}`);
    if (statuses.includes(job.status)) return job;
    await pause(2000);
  }
  throw new Error(`Admission ${orderId} did not reach ${statuses}`);
}

test('mechanical admission rejects blocked domains without queuing Research', { timeout: 60_000 }, async () => {
  const order = await request('https://www.facebook.com/public-data');
  const job = await until(order.id, ['rejected'], 45_000);
  assert.match(job.reason, /blocked domain/);
  assert.equal((await one(`SELECT * FROM orders WHERE id = ${order.id}`)).status, 'rejected');
  assert.ok(!(await sql(founder, "SELECT * FROM task WHERE kind = 'research_gate'")).some((t) => opt(t.order_id) === order.id));
});

test('Research queues only after robots, reachability and a measured 120-second comparison', { timeout: 5 * 60_000 }, async () => {
  const order = await request('https://en.wikipedia.org/wiki/Palace_of_Fine_Arts');
  try {
    const waiting = await until(order.id, ['waiting', 'rejected'], 90_000);
    assert.equal(waiting.status, 'waiting', waiting.reason);
    assert.ok(!(await sql(founder, "SELECT * FROM task WHERE kind = 'research_gate'")).some((t) => opt(t.order_id) === order.id));
    const job = await until(order.id, ['passed', 'rejected'], 180_000);
    assert.equal(job.status, 'passed', job.reason);
    const tasks = (await sql(founder, "SELECT * FROM task WHERE kind = 'research_gate'")).filter((t) => opt(t.order_id) === order.id);
    assert.equal(tasks.length, 1);
    assert.equal(JSON.parse(tasks[0].input).prechecked, true);
    const checks = (await sql(founder, 'SELECT * FROM gate_check')).filter((c) => opt(c.order_id) === order.id);
    assert.deepEqual(Object.fromEntries(checks.filter((c) => c.check !== 'layer2').map((c) => [c.check, c.result])), { robots: 'pass', reachability: 'pass', volatility: 'pass' });
    const pages = await sql(founder, `SELECT * FROM research_page WHERE order_id = ${order.id}`);
    const comparison = pages.filter((p) => p.kind === 'page').map((p) => JSON.parse(p.summary).compare).find(Boolean);
    assert.ok(comparison.enoughGap && comparison.secondsApart >= 120);
    console.log(JSON.stringify({ orderId: order.id, secondsApart: comparison.secondsApart, volatility: job.volatility }));
  } finally {
    const current = await one(`SELECT * FROM orders WHERE id = ${order.id}`);
    if (current.status === 'researching') {
      const checks = (await sql(founder, 'SELECT * FROM gate_check')).filter((c) => opt(c.order_id) === order.id);
      for (const check of ['robots', 'terms', 'reachability', 'volatility'].filter((kind) => !checks.some((c) => c.check === kind))) {
        const url = check === 'robots' ? 'https://en.wikipedia.org/robots.txt' : 'https://en.wikipedia.org/wiki/Palace_of_Fine_Arts';
        ok(await call(process.env.SPACETIME_TOKEN_RESEARCH, 'record_gate_check', [order.id, check, 'unclear', url, 'Integration check complete; no commercial request.']));
      }
      ok(await call(process.env.SPACETIME_TOKEN_RESEARCH, 'research_report', [order.id, 'Mechanical admission integration test complete.', '["https://en.wikipedia.org/wiki/Palace_of_Fine_Arts"]', '["opened"]', 'stable', 0, 0]));
      ok(await call(coo, 'coo_decide', [order.id, 'REJECT', '', 'Integration test complete; not a customer request.']));
    }
  }
});
