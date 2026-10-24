// Customer challenge flow (AGENTS.md §3 Addition 2, §6 D) against Maincloud with real seat identities.
// Builds two delivered yc-directory orders through the real reducers (Apify run + Bright Data verification,
// a few minutes), then exercises open_challenge -> recheck -> challenge_verdict on them.
// While fixtures exist, creao_max_concurrency is 0 so dispatch never sends test tasks to a paid CREAO run;
// the previous value is restored at the end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, founderToken } from './client.mjs';

const seat = (role) => {
  const tok = process.env[`SPACETIME_TOKEN_${role.toUpperCase()}`];
  if (!tok) throw new Error(`SPACETIME_TOKEN_${role.toUpperCase()} is not set`);
  return tok;
};
// The customer of the Gate 1 yc-directory order: reusing it keeps fixtures from counting as new buyers.
const SENDER = 'asi-e2e-founder';
const stamp = Date.now();
let founder, canary, coo, auditor, desk;
let prevConcurrency;
const fixtures = [];
let fxSmall, fxLarge;

const ok = (r) => assert.equal(r.status, 200, r.body);
const opt = (v) => (Array.isArray(v) && v[0] === 0 ? v[1] : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = async (q) => (await sql(founder, q))[0];
const booksSum = async () => (await sql(founder, 'SELECT * FROM books')).reduce((s, r) => s + BigInt(r.balance_cents), 0n);
const balance = async (account) => BigInt((await one(`SELECT * FROM books WHERE account = '${account}'`))?.balance_cents ?? 0);

async function deliveredOrder(ref, priceCents) {
  ok(await call(desk, 'create_order', [ref, SENDER, `challenge test ${ref}: YC Airbnb`, '{"origin":"test"}', priceCents]));
  ok(await call(desk, 'record_payment', [ref, 'cs_test_challenge']));
  let o = await one(`SELECT * FROM orders WHERE ref = '${ref}'`);
  fixtures.push(o.id);
  ok(await call(coo, 'coo_decide', [o.id, 'ACCEPT', 'yc-directory', 'Challenge test fixture.']));
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
  ok(await call(auditor, 'audit_verdict', [o.id, 'ACCEPT', 'Challenge test fixture: values verified on the re-fetch.']));
  return one(`SELECT * FROM orders WHERE id = ${o.id}`);
}

const valueOf = async (orderId, metric) => (await sql(founder, `SELECT * FROM value_record WHERE order_id = ${orderId}`))
  .filter((v) => v.metric === metric && opt(v.supersedes_id) === undefined).sort((a, b) => Number(a.id) - Number(b.id))[0];

async function openAndRecheck(orderId, row, metric, reason) {
  const t0 = Date.now();
  ok(await call(desk, 'open_challenge', [orderId, SENDER, row, metric, reason]));
  const opened = Date.now() - t0;
  let ch;
  while (Date.now() - t0 < 90_000) {
    ch = (await sql(founder, 'SELECT * FROM challenge')).filter((c) => c.order_id === orderId).sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (ch && ch.status !== 'rechecking') break;
    await sleep(250);
  }
  const elapsed = Date.now() - t0;
  assert.equal(ch.status, 'auditing');
  const check = await one(`SELECT * FROM challenge_check WHERE challenge_id = ${ch.id}`);
  console.log(JSON.stringify({ challengeId: Number(ch.id), openMs: opened, openToAuditingMs: elapsed, savedMs: check.saved_ms, freshMs: check.fresh_ms, totalMs: check.total_ms, saved: check.saved_result, fresh: check.fresh_result }));
  return { ch, check, elapsed };
}

const auditTask = async (challengeId) => (await sql(founder, "SELECT * FROM task WHERE kind = 'audit_challenge'"))
  .find((t) => JSON.parse(t.input).challengeId === String(challengeId));

before(async () => {
  founder = founderToken();
  [canary, coo, auditor, desk] = ['canary', 'coo', 'auditor', 'front_desk'].map(seat);
  prevConcurrency = (await one("SELECT * FROM config WHERE key = 'creao_max_concurrency'")).value;
  ok(await call(founder, 'set_config', ['creao_max_concurrency', '0']));
  [fxSmall, fxLarge] = await Promise.all([deliveredOrder(`ch-${stamp}-a`, 100), deliveredOrder(`ch-${stamp}-b`, 600)]);
});

after(async () => {
  try {
    for (const t of await sql(founder, 'SELECT * FROM task')) {
      if (t.status === 'queued' && fixtures.some((id) => id === opt(t.order_id))) await call(founder, 'cancel_task', [t.id, 'challenge test cleanup']);
    }
  } finally {
    await call(founder, 'set_config', ['creao_max_concurrency', prevConcurrency ?? '2']);
  }
});

test('only the seat that owns each step may call it', async () => {
  for (const tok of [coo, auditor, canary]) assert.match((await call(tok, 'open_challenge', [fxSmall.id, SENDER, 0, 'batch', 'x'])).body, /may not do this/);
  for (const tok of [desk, coo, founder]) assert.match((await call(tok, 'challenge_verdict', [1, 'REJECTED', 'x'])).body, /may not do this/);
  for (const tok of [desk, auditor]) assert.match((await call(tok, 'decide_approval', [1, true])).body, /may not do this/);
});

test('open_challenge refuses orders that are not delivered, other customers, missing rows and ambiguous rows', async () => {
  const ref = `ch-${stamp}-quoted`;
  ok(await call(desk, 'create_order', [ref, SENDER, 'challenge test: not delivered', '{}', 100]));
  const quoted = await one(`SELECT * FROM orders WHERE ref = '${ref}'`);
  const r1 = await call(desk, 'open_challenge', [quoted.id, SENDER, 0, '', 'row 0 is wrong']);
  assert.equal(r1.status, 530);
  assert.match(r1.body, /is quoted; only a delivered order can be challenged/);
  assert.match((await call(desk, 'open_challenge', [fxSmall.id, `test-other-${stamp}`, 0, 'batch', 'x'])).body, /does not belong to this customer/);
  assert.match((await call(desk, 'open_challenge', [fxSmall.id, SENDER, 99, '', 'x'])).body, /has no row 99/);
  assert.match((await call(desk, 'open_challenge', [fxSmall.id, SENDER, 0, '', 'x'])).body, /say which one is wrong/);
  assert.match((await call(desk, 'open_challenge', [fxSmall.id, SENDER, 0, 'founders', 'x'])).body, /has no founders/);
  assert.match((await call(desk, 'open_challenge', [fxSmall.id, SENDER, 0, 'batch', ' '])).body, /reason is required/);
});

test('recheck compares the saved page and a fresh fetch in seconds; REJECTED changes nothing', { timeout: 3 * 60_000 }, async () => {
  const v = await valueOf(fxSmall.id, 'batch');
  const bonusesBefore = (await sql(founder, 'SELECT * FROM bonus')).filter((b) => opt(b.order_id) === fxSmall.id);
  assert.ok(bonusesBefore.length && bonusesBefore.every((b) => b.status === 'accrued'));
  const { ch, check, elapsed } = await openAndRecheck(fxSmall.id, v.row, 'batch', 'The batch is wrong, Airbnb was in a different batch.');
  assert.ok(elapsed < 30_000, `recheck took ${elapsed} ms`);
  assert.equal(check.saved_result, 'match', check.saved_reason);
  assert.equal(check.saved_quote, v.excerpt);
  assert.match(check.saved_context, /Winter 2009/);
  assert.ok(['match', 'changed', 'missing'].includes(check.fresh_result), check.fresh_reason);
  assert.equal(check.value, v.value);
  const ev = (await sql(founder, 'SELECT * FROM evidence')).filter((e) => opt(e.value_record_id) === v.id);
  assert.ok(ev.length >= 1, 'the fresh fetch is logged as evidence for the value');
  const task = await auditTask(ch.id);
  assert.equal(task.role, 'auditor');
  assert.equal(task.status, 'queued');
  assert.match((await call(desk, 'open_challenge', [fxSmall.id, SENDER, v.row, 'batch', 'again'])).body, /already auditing/);
  assert.match((await call(auditor, 'challenge_verdict', [ch.id, 'MAYBE', 'x'])).body, /UPHELD or REJECTED/);

  const sum0 = await booksSum();
  ok(await call(auditor, 'challenge_verdict', [ch.id, 'REJECTED', `Saved page says "${check.saved_quote}"; the extractor read it correctly.`]));
  const after = await one(`SELECT * FROM challenge WHERE id = ${ch.id}`);
  assert.deepEqual([after.status, after.verdict], ['rejected', 'REJECTED']);
  assert.ok(opt(after.resolved_at));
  assert.equal((await auditTask(ch.id)).status, 'done');
  assert.equal((await sql(founder, 'SELECT * FROM refund')).filter((r) => r.order_id === fxSmall.id).length, 0);
  const bonusesAfter = (await sql(founder, 'SELECT * FROM bonus')).filter((b) => opt(b.order_id) === fxSmall.id);
  assert.ok(bonusesAfter.every((b) => b.status === 'accrued'), 'no clawback on a rejected challenge');
  assert.equal((await valueOf(fxSmall.id, 'batch')).id, v.id, 'the value is not superseded');
  assert.equal(await booksSum(), sum0);
  assert.match((await call(auditor, 'challenge_verdict', [ch.id, 'UPHELD', 'again'])).body, /is rejected, not auditing/);
});

test('UPHELD withdraws the value, refunds the order, claws back bonuses and opens a compile ticket', { timeout: 3 * 60_000 }, async () => {
  const v = await valueOf(fxSmall.id, 'status');
  const { ch, check } = await openAndRecheck(fxSmall.id, v.row, 'status', 'Airbnb status is wrong.');
  const customer = `customer:${fxSmall.id}`;
  assert.equal(await balance(customer), -100n);
  const seats = { coo: await balance('seat:coo'), auditor: await balance('seat:auditor') };
  ok(await call(auditor, 'challenge_verdict', [ch.id, 'UPHELD', 'Test: treat the extractor read as wrong.']));
  assert.equal((await one(`SELECT * FROM challenge WHERE id = ${ch.id}`)).status, 'upheld');

  const recs = await sql(founder, `SELECT * FROM value_record WHERE order_id = ${fxSmall.id}`);
  const next = recs.find((r) => opt(r.supersedes_id) === v.id);
  assert.ok(next, 'a new record supersedes the challenged one');
  if (check.corrected_value) assert.deepEqual([next.status, next.value], ['corrected', check.corrected_value]);
  else assert.deepEqual([next.status, next.value], ['unverifiable', '']);

  const [refund] = (await sql(founder, 'SELECT * FROM refund')).filter((r) => r.order_id === fxSmall.id);
  assert.deepEqual([refund.status, refund.amount_cents], ['issued', 100]);
  assert.equal(await balance(customer), 0n, 'the test-mode payment is refunded');
  const bonuses = (await sql(founder, 'SELECT * FROM bonus')).filter((b) => opt(b.order_id) === fxSmall.id);
  assert.ok(bonuses.length && bonuses.every((b) => b.status === 'clawed_back'));
  assert.equal(await balance('seat:coo'), seats.coo - 5n);
  assert.equal(await balance('seat:auditor'), seats.auditor - 5n);
  const ticket = (await sql(founder, 'SELECT * FROM ticket')).find((t) => opt(t.api_id) === fxSmall.api_id[1] && t.label === 'compile' && t.status === 'open');
  assert.ok(ticket, 'a compile ticket is open for yc-directory');
  assert.equal(await booksSum(), 0n);

  // The withdrawn value is no longer a fact, so it cannot be challenged again; a second upheld challenge refunds nothing more.
  assert.match((await call(desk, 'open_challenge', [fxSmall.id, SENDER, v.row, 'status', 'again'])).body, /not delivered as a fact \(status unverifiable\)/);
  const v2 = await valueOf(fxSmall.id, 'website');
  const second = await openAndRecheck(fxSmall.id, v2.row, 'website', 'Website is wrong.');
  ok(await call(auditor, 'challenge_verdict', [second.ch.id, 'UPHELD', 'Test: second upheld challenge on the same order.']));
  assert.equal((await sql(founder, 'SELECT * FROM refund')).filter((r) => r.order_id === fxSmall.id).length, 1);
  assert.equal((await sql(founder, 'SELECT * FROM ticket')).filter((t) => opt(t.api_id) === fxSmall.api_id[1] && t.label === 'compile' && t.status === 'open').length, 1);
  assert.equal(await booksSum(), 0n);
});

test('a refund over refund_limit_cents waits for the founder approval', { timeout: 3 * 60_000 }, async () => {
  const limit = Number((await one("SELECT * FROM config WHERE key = 'refund_limit_cents'")).value);
  assert.ok(fxLarge.price_cents > limit, `fixture price ${fxLarge.price_cents} is over the limit ${limit}`);
  const v = await valueOf(fxLarge.id, 'name');
  const { ch } = await openAndRecheck(fxLarge.id, v.row, 'name', 'The company name is wrong.');
  const customer = `customer:${fxLarge.id}`;
  ok(await call(auditor, 'challenge_verdict', [ch.id, 'UPHELD', 'Test: refund over the limit.']));
  const [refund] = (await sql(founder, 'SELECT * FROM refund')).filter((r) => r.order_id === fxLarge.id);
  assert.deepEqual([refund.status, refund.amount_cents], ['pending_approval', 600]);
  assert.equal(await balance(customer), -600n, 'nothing is refunded before the approval');
  const ap = (await sql(founder, 'SELECT * FROM approval')).find((a) => a.kind === 'refund_over_limit' && a.ref_id === refund.id);
  assert.deepEqual([ap.status, ap.amount_cents], ['pending', 600]);
  assert.equal(await booksSum(), 0n);

  ok(await call(founder, 'decide_approval', [ap.id, true]));
  assert.equal((await one(`SELECT * FROM approval WHERE id = ${ap.id}`)).status, 'approved');
  assert.equal((await one(`SELECT * FROM refund WHERE id = ${refund.id}`)).status, 'issued');
  assert.equal(await balance(customer), 0n);
  assert.match((await call(founder, 'decide_approval', [ap.id, true])).body, /is approved/);
  assert.equal(await booksSum(), 0n);
});
