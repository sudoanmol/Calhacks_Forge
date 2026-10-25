// Compile flow (AGENTS.md §3 compile triggers, §6 C) against Maincloud with real seat identities.
// Delivers three real orders (Apify run + Bright Data verification) on a dedicated test API that reuses the
// yc-directory Tier 0 Task, so the buyers trigger fires on that API only: set_config would re-run the triggers
// for every API. The test then plays each seat through the real reducers. No Droid session, CREAO run or
// `apify push` happens: creao_max_concurrency is 0 while fixtures exist, and the shipped Tier 1 version
// names an Actor id that is labelled as not deployed. The test API keeps its buyers, so it cannot be retired;
// its name and description mark it as a test fixture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, founderToken } from './client.mjs';

const seat = (role) => {
  const tok = process.env[`SPACETIME_TOKEN_${role.toUpperCase()}`];
  if (!tok) throw new Error(`SPACETIME_TOKEN_${role.toUpperCase()} is not set`);
  return tok;
};
const stamp = Date.now();
const API = `cmp-test-${stamp}`;
let founder, canary, coo, auditor, desk, cfo, runner;
let prevConcurrency, prevCap, api, fields;
const fixtures = [];
let orders = [];
let jobY, jobX;

const ok = (r) => assert.equal(r.status, 200, r.body);
const fails = (r, re) => { assert.notEqual(r.status, 200, `expected a failure matching ${re}`); assert.match(r.body, re); };
const opt = (v) => (Array.isArray(v) && v[0] === 0 ? v[1] : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = async (q) => (await sql(founder, q))[0];
const booksSum = async () => (await sql(founder, 'SELECT * FROM books')).reduce((s, r) => s + BigInt(r.balance_cents), 0n);
const budget = () => one("SELECT * FROM budget WHERE name = 'engineering'");
const job = (ticketId) => one(`SELECT * FROM compile_job WHERE ticket_id = ${ticketId}`);
const jobsOf = async () => (await sql(founder, `SELECT * FROM compile_job WHERE api_id = ${api.id}`)).sort((a, b) => a.ticket_id - b.ticket_id);
const ticket = (id) => one(`SELECT * FROM ticket WHERE id = ${id}`);
const tasksOf = async (ticketId, kind) => (await sql(founder, `SELECT * FROM task WHERE kind = '${kind}'`))
  .filter((t) => opt(t.ticket_id) === ticketId).sort((a, b) => a.id - b.id);
const approvalsOf = async (refId, kind) => (await sql(founder, `SELECT * FROM approval WHERE kind = '${kind}'`))
  .filter((a) => a.ref_id === refId).sort((a, b) => a.id - b.id);

// Claims the oldest queued task of this kind and returns it; only this test queues compile and ship tasks.
async function claim(kind, ticketId) {
  ok(await call(runner, 'claim_task', [kind]));
  const t = (await tasksOf(ticketId, kind)).at(-1);
  assert.equal(t?.status, 'claimed', `no claimed ${kind} task for ticket ${ticketId}`);
  return t;
}

async function toAuditing(ref, sender) {
  ok(await call(desk, 'create_order', [ref, sender, `compile test ${ref}: YC Airbnb`, '{"origin":"test"}', 100]));
  ok(await call(desk, 'record_payment', [ref, 'cs_test_compile']));
  let o = await one(`SELECT * FROM orders WHERE ref = '${ref}'`);
  fixtures.push(o.id);
  ok(await call(coo, 'coo_decide', [o.id, 'ACCEPT', API, 'Compile test fixture.']));
  const t0 = Date.now();
  while (Date.now() - t0 < 7 * 60_000) {
    o = await one(`SELECT * FROM orders WHERE id = ${o.id}`);
    if (['auditing', 'failed'].includes(o.status)) break;
    if (o.status === 'running' && o.apify_run_id && Date.now() - t0 > 90_000) {
      const run = await one(`SELECT * FROM run WHERE external_id = '${o.apify_run_id}'`);
      if (run) await call(canary, 'apify_poll', [run.id]);
    }
    await sleep(3_000);
  }
  assert.equal(o.status, 'auditing', `${o.status}: ${o.decision_reason}`);
  return o;
}

const deliver = (o) => call(auditor, 'audit_verdict', [o.id, 'ACCEPT', 'Compile test fixture: values verified on the re-fetch.']);

before(async () => {
  founder = founderToken();
  [canary, coo, auditor, desk, cfo, runner] = ['canary', 'coo', 'auditor', 'front_desk', 'cfo', 'droid_runner'].map(seat);
  assert.equal((await one("SELECT * FROM config WHERE key = 'compile_min_buyers'")).value, '2', 'the test assumes compile_min_buyers = 2');
  prevConcurrency = (await one("SELECT * FROM config WHERE key = 'creao_max_concurrency'")).value;
  prevCap = (await budget()).cap_cents;
  ok(await call(founder, 'set_config', ['creao_max_concurrency', '0']));
  const yc = await one("SELECT * FROM api WHERE name = 'yc-directory'");
  const ycVersion = await one(`SELECT * FROM api_version WHERE id = ${opt(yc.current_version_id)}`);
  const spec = {
    name: API, description: 'TEST FIXTURE for the compile flow test, not for sale. Same source and fields as yc-directory.',
    inputs: JSON.parse(yc.inputs), sources: JSON.parse(yc.sources), outputSchema: JSON.parse(yc.output_schema),
    volatility: yc.volatility, freshnessWindowMin: yc.freshness_window_min, pageCap: yc.page_cap,
  };
  ok(await call(founder, 'create_api', [JSON.stringify(spec), ycVersion.apify_id, 'task']));
  api = await one(`SELECT * FROM api WHERE name = '${API}'`);
  fields = JSON.parse(ycVersion.fields);
  orders = await Promise.all(['a', 'b', 'c'].map((x) => toAuditing(`cmp-${stamp}-${x}`, `cmp-test-buyer-${stamp}-${x}`)));
});

after(async () => {
  try {
    for (const t of await sql(founder, 'SELECT * FROM task')) {
      const mine = fixtures.includes(opt(t.order_id)) || (jobX && opt(t.ticket_id) === jobX) || (jobY && opt(t.ticket_id) === jobY);
      if (t.status === 'queued' && mine) await call(founder, 'cancel_task', [t.id, 'compile test cleanup']);
    }
  } finally {
    await call(founder, 'set_budget_cap', [prevCap]);
    await call(founder, 'set_config', ['creao_max_concurrency', prevConcurrency ?? '2']);
  }
});

test('only the owning seat may call each compile reducer', async () => {
  for (const tok of [coo, auditor, runner]) fails(await call(tok, 'cfo_propose', [1, 'COMPILE', 10, 'x']), /may not do this/);
  for (const tok of [cfo, runner, coo]) fails(await call(tok, 'compile_verdict', [1, 'ACCEPT', 'x']), /may not do this/);
  for (const tok of [cfo, auditor]) {
    fails(await call(tok, 'submit_compile', [1, 's', '{}']), /may not do this/);
    fails(await call(tok, 'log_droid_event', [1, 'assistant', '{}']), /may not do this/);
    fails(await call(tok, 'record_api_version', [1, '1.0', 1, 'actor', 'x', '[]', 's', true]), /may not do this/);
    fails(await call(tok, 'request_droid_action', [1, 'req-00000001', 'run_command', 'ls', 'x']), /may not do this/);
    fails(await call(tok, 'compile_failed', [1, 'x']), /may not do this/);
  }
  for (const tok of [cfo, runner, auditor]) fails(await call(tok, 'set_budget_cap', [1]), /may not do this/);
});

test('reaching compile_min_buyers opens a compile ticket and a CFO task on that API only', async () => {
  ok(await deliver(orders[0]));
  assert.equal((await one(`SELECT * FROM api WHERE id = ${api.id}`)).buyer_count, 1);
  assert.equal((await jobsOf()).length, 0, 'one buyer is below compile_min_buyers');
  ok(await deliver(orders[1]));
  assert.equal((await one(`SELECT * FROM api WHERE id = ${api.id}`)).buyer_count, 2);
  const jobs = await jobsOf();
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  jobY = j.ticket_id;
  assert.equal(j.status, 'awaiting_cfo');
  assert.equal(j.trigger, 'buyers');
  assert.equal(JSON.parse(j.trigger_detail).buyers, 2);
  const tk = await ticket(jobY);
  assert.equal(tk.label, 'compile');
  assert.equal(tk.status, 'open');
  assert.equal(opt(tk.api_id), api.id);
  const [t] = await tasksOf(jobY, 'cfo_compile');
  assert.equal(t.role, 'cfo');
  assert.equal(t.status, 'queued');
  assert.equal(JSON.parse(t.input).api, API);
});

test('cfo_propose validates the decision, the amount and the rationale', async () => {
  fails(await call(cfo, 'cfo_propose', [jobY, 'BUILD', 10, 'x']), /decision must be one of/);
  fails(await call(cfo, 'cfo_propose', [jobY, 'COMPILE', 10, ' ']), /rationale is required/);
  fails(await call(cfo, 'cfo_propose', [jobY, 'COMPILE', 0, 'x']), /COMPILE amount must be/);
  fails(await call(cfo, 'cfo_propose', [999_999, 'COMPILE', 10, 'x']), /no compile job/);
});

test('over the cap a compile waits on spend_over_cap; once approved it keeps its reservation; compile_failed releases it', async () => {
  const b0 = await budget();
  ok(await call(founder, 'set_budget_cap', [b0.spent_cents + b0.reserved_cents + 5]));
  ok(await call(cfo, 'cfo_propose', [jobY, 'COMPILE', 10, 'Compile test: 2 buyers, over the cap on purpose.']));
  assert.equal((await job(jobY)).status, 'awaiting_approval');
  assert.equal((await tasksOf(jobY, 'cfo_compile'))[0].status, 'done');
  assert.equal((await tasksOf(jobY, 'compile')).length, 0);
  const [ap] = await approvalsOf(jobY, 'spend_over_cap');
  assert.equal(ap.status, 'pending');
  assert.equal(ap.amount_cents, 10);
  fails(await call(cfo, 'cfo_propose', [jobY, 'COMPILE', 10, 'again']), /nothing to propose/);

  ok(await call(founder, 'decide_approval', [ap.id, true]));
  let j = await job(jobY);
  assert.equal(j.status, 'queued');
  assert.equal(j.over_cap_approved, true);
  assert.equal(j.reserved_cents, 10);
  assert.equal((await budget()).reserved_cents, b0.reserved_cents + 10);
  assert.equal((await tasksOf(jobY, 'compile'))[0].status, 'queued');

  ok(await call(founder, 'set_budget_cap', [b0.spent_cents]));
  assert.equal((await job(jobY)).status, 'queued', 'a founder-approved overrun survives a cap cut');

  const t = await claim('compile', jobY);
  assert.equal((await job(jobY)).status, 'compiling');
  fails(await call(runner, 'compile_failed', [t.id, ' ']), /reason is required/);
  ok(await call(runner, 'compile_failed', [t.id, 'Compile test: the worker could not start Droid.']));
  j = await job(jobY);
  assert.equal(j.status, 'failed');
  assert.equal(j.reserved_cents, 0);
  assert.equal(j.spent_cents, 0, 'nothing is spent before Droid submits an attempt');
  assert.equal((await ticket(jobY)).status, 'failed');
  assert.equal((await budget()).reserved_cents, b0.reserved_cents);
});

test('a failed compile is not re-ticketed until the API gains another buyer', async () => {
  ok(await deliver(orders[2]));
  assert.equal((await one(`SELECT * FROM api WHERE id = ${api.id}`)).buyer_count, 3);
  const jobs = await jobsOf();
  assert.equal(jobs.length, 2);
  jobX = jobs[1].ticket_id;
  assert.notEqual(jobX, jobY);
  assert.equal(jobs[1].status, 'awaiting_cfo');
  assert.equal(JSON.parse(jobs[1].trigger_detail).buyers, 3);
});

test('cutting the budget cap makes a queued compile ineligible at once; raising it requeues the compile', async () => {
  const b0 = await budget();
  ok(await call(founder, 'set_budget_cap', [b0.spent_cents + b0.reserved_cents + 100]));
  ok(await call(cfo, 'cfo_propose', [jobX, 'COMPILE', 20, 'Compile test: 3 buyers; fits the cap.']));
  let j = await job(jobX);
  assert.equal(j.status, 'queued');
  assert.equal(j.reserved_cents, 20);
  assert.equal((await tasksOf(jobX, 'compile'))[0].status, 'queued');

  ok(await call(founder, 'set_budget_cap', [b0.spent_cents + b0.reserved_cents + 3]));
  j = await job(jobX);
  assert.equal(j.status, 'ineligible');
  assert.equal(j.reserved_cents, 0);
  assert.equal((await tasksOf(jobX, 'compile'))[0].status, 'cancelled');
  assert.equal((await budget()).reserved_cents, b0.reserved_cents);
  const ev = (await sql(founder, "SELECT * FROM event WHERE kind = 'budget_cap_set'")).sort((a, b) => b.id - a.id)[0];
  assert.deepEqual(JSON.parse(ev.payload).ineligible, [String(jobX)]);

  ok(await call(founder, 'set_budget_cap', [b0.spent_cents + b0.reserved_cents + 100]));
  j = await job(jobX);
  assert.equal(j.status, 'queued');
  assert.equal(j.reserved_cents, 20);
  const tasks = await tasksOf(jobX, 'compile');
  assert.equal(tasks.length, 2);
  assert.equal(tasks[1].status, 'queued');
});

test('Droid compile: failing tests are rejected, rework resumes the same session, accept, founder ship, Tier 1 version', async () => {
  const sum0 = await booksSum();
  const b0 = await budget();
  let t = await claim('compile', jobX);
  assert.equal((await job(jobX)).status, 'compiling');

  ok(await call(runner, 'log_droid_event', [t.id, 'assistant', JSON.stringify({ text: 'compile test message' })]));
  fails(await call(runner, 'log_droid_event', [t.id, 'Bad Kind', '{}']), /kind must be/);
  const ev = (await sql(founder, "SELECT * FROM event WHERE kind = 'droid_assistant'")).find((e) => e.ref_id === t.id);
  assert.equal(JSON.parse(ev.payload).text, 'compile test message');

  const requestId = `req-${stamp}`;
  ok(await call(runner, 'request_droid_action', [t.id, requestId, 'run_command', 'ls src', 'not on the compile allowlist']));
  const ap = (await approvalsOf(t.id, 'droid_action')).find((a) => JSON.parse(a.detail).requestId === requestId);
  assert.equal(ap.status, 'pending');
  ok(await call(founder, 'decide_approval', [ap.id, false]));
  assert.equal((await one(`SELECT * FROM approval WHERE id = ${ap.id}`)).status, 'rejected');

  const failing = { tests: { fixtures: { status: 'pass' }, contract: { status: 'pass' }, live: { status: 'fail', fail: 1 } } };
  fails(await call(runner, 'submit_compile', [t.id, 'session-a', 'not json']), /results must be JSON/);
  ok(await call(runner, 'submit_compile', [t.id, `session-${stamp}`, JSON.stringify(failing)]));
  let j = await job(jobX);
  assert.equal(j.status, 'auditing');
  assert.equal(j.attempt, 1);
  assert.equal(j.tests_passed, false);
  assert.equal((await tasksOf(jobX, 'audit_compile'))[0].role, 'auditor');
  fails(await call(runner, 'submit_compile', [t.id, `session-${stamp}`, JSON.stringify(failing)]), /not the lease owner|is auditing/);

  fails(await call(auditor, 'compile_verdict', [jobX, 'ACCEPT', 'looks fine']), /did not all pass/);
  ok(await call(auditor, 'compile_verdict', [jobX, 'REJECT', 'Compile test: the live test failed; fix the extractor.']));
  j = await job(jobX);
  assert.equal(j.status, 'rework');
  assert.equal((await tasksOf(jobX, 'audit_compile'))[0].status, 'done');
  const rework = (await tasksOf(jobX, 'compile')).at(-1);
  assert.equal(rework.status, 'queued');
  const input = JSON.parse(rework.input);
  assert.equal(input.droidSessionId, `session-${stamp}`);
  assert.equal(input.attempt, 2);
  assert.match(input.feedback, /live test failed/);

  t = await claim('compile', jobX);
  assert.equal((await job(jobX)).status, 'compiling');
  const passing = { tests: { fixtures: { status: 'pass' }, contract: { status: 'pass' }, live: { status: 'pass' } } };
  fails(await call(runner, 'submit_compile', [t.id, 'another-session', JSON.stringify(passing)]), /rework must resume session/);
  ok(await call(runner, 'submit_compile', [t.id, `session-${stamp}`, JSON.stringify(passing)]));
  j = await job(jobX);
  assert.equal(j.attempt, 2);
  assert.equal(j.tests_passed, true);

  ok(await call(auditor, 'compile_verdict', [jobX, 'ACCEPT', 'Compile test: fixtures, contract and live pass.']));
  assert.equal((await job(jobX)).status, 'ship_pending');
  const [ship] = await approvalsOf(jobX, 'api_ship');
  assert.equal(ship.status, 'pending');
  fails(await call(cfo, 'decide_approval', [ship.id, true]), /may not do this/);
  ok(await call(founder, 'decide_approval', [ship.id, true]));
  assert.equal((await job(jobX)).status, 'shipping');

  t = await claim('ship', jobX);
  const actorId = `not-deployed-compile-test-${stamp}`;
  const rec = (over = {}) => {
    const a = { version: '1.0', tier: 1, engine: 'actor', apifyId: actorId, fields: JSON.stringify(fields), session: `session-${stamp}`, passed: true, ...over };
    return call(runner, 'record_api_version', [t.id, a.version, a.tier, a.engine, a.apifyId, a.fields, a.session, a.passed]);
  };
  fails(await rec({ fields: JSON.stringify(fields.slice(1)) }), new RegExp(`contract: version 1.0 drops field\\(s\\) ${fields[0]}`));
  fails(await rec({ tier: 0, engine: 'task' }), /tier 1 with engine actor/);
  fails(await rec({ session: 'another-session' }), /must be the audited session/);
  fails(await rec({ passed: false }), /tests passed/);
  fails(await rec({ version: 'v1' }), /version must look like/);
  ok(await rec({ fields: JSON.stringify([...fields, 'extra_field']) }));

  const a = await one(`SELECT * FROM api WHERE id = ${api.id}`);
  assert.equal(a.tier, 1);
  const v = await one(`SELECT * FROM api_version WHERE id = ${opt(a.current_version_id)}`);
  assert.equal(v.version, '1.0');
  assert.equal(v.engine, 'actor');
  assert.equal(v.apify_id, actorId);
  assert.equal(v.droid_session_id, `session-${stamp}`);
  assert.deepEqual(JSON.parse(v.fields), [...fields, 'extra_field']);
  j = await job(jobX);
  assert.equal(j.status, 'shipped');
  assert.equal(opt(j.version_id), v.id);
  assert.equal(j.spent_cents, 20);
  assert.equal((await ticket(jobX)).status, 'shipped');
  const b1 = await budget();
  assert.equal(b1.spent_cents, b0.spent_cents + 20);
  assert.equal(b1.reserved_cents, b0.reserved_cents - 20);
  const bonuses = (await sql(founder, 'SELECT * FROM bonus')).filter((x) => opt(x.task_id) === t.id);
  assert.deepEqual(bonuses.map((x) => [x.role, x.amount_cents]).sort(), [['cfo', 1], ['droid_runner', 2]]);
  assert.equal(await booksSum(), sum0, 'every ledger tx sums to zero');
  fails(await rec(), /not the lease owner|already has version/);
});
