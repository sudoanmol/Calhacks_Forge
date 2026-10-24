// Live tests against the deployed module. Run from the repo root:
//   node --env-file=.env --test skills/forge-cli/test/forge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../forge.mjs', import.meta.url));
const { SPACETIME_HOST, SPACETIME_DB } = process.env;
const DB_URL = `${SPACETIME_HOST}/v1/database/${SPACETIME_DB}`;
const seat = (role) => {
  const tok = process.env[`SPACETIME_TOKEN_${role.toUpperCase()}`];
  assert.ok(tok, `SPACETIME_TOKEN_${role.toUpperCase()} missing from .env`);
  return tok;
};

const forge = (token, ...args) => runCli({ FORGE_SEAT_TOKEN: token }, ...args);
const runCli = (seatEnv, ...args) => new Promise((resolve) => {
  execFile('node', [CLI, ...args], { env: { ...process.env, FORGE_DB_URL: DB_URL, ...seatEnv } },
    (err, stdout, stderr) => resolve({
      code: err ? err.code : 0,
      out: stdout ? JSON.parse(stdout) : null,
      err: stderr ? JSON.parse(stderr) : null,
    }));
});

const call = async (token, reducer, args) => {
  const r = await fetch(`${DB_URL}/call/${reducer}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  assert.equal(r.status, 200, `${reducer}: ${await r.text()}`);
};
const sqlRows = async (token, q) => {
  const r = await fetch(`${DB_URL}/sql`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: q });
  const body = await r.text();
  assert.ok(r.ok, body);
  return JSON.parse(body)[0].rows;
};

test('catalog lists yc-directory with its fields', async () => {
  const r = await forge(seat('coo'), 'catalog');
  assert.equal(r.code, 0, JSON.stringify(r.err));
  const yc = r.out.find((a) => a.name === 'yc-directory');
  assert.ok(yc, 'yc-directory in catalog');
  assert.ok(yc.fields.includes('one_liner'));
  assert.equal(yc.tier, 0);
  assert.ok(Array.isArray(yc.sources));
});

test('catalog hides retired APIs and shows params and micro-USD cost per call', async () => {
  const r = await forge(seat('coo'), 'catalog');
  assert.equal(r.code, 0, JSON.stringify(r.err));
  const retired = (await sqlRows(seat('coo'), 'SELECT name FROM api_retired')).map((x) => x[0]);
  assert.ok(retired.includes('test-1792875081507'), 'the leftover test API is retired');
  for (const name of retired) assert.ok(!r.out.some((a) => a.name === name), `${name} is hidden`);
  const roles = r.out.find((a) => a.name === 'open-roles');
  assert.equal(roles.params.board.default, 'discord');
  assert.deepEqual(roles.sources, ['https://boards-api.greenhouse.io/v1/boards/{board}/departments']);
  assert.ok(roles.costPerCallMicroUsd > 0, 'open-roles has a measured cost per call');
});

test('order <id> reads a real order with decoded columns', async () => {
  const rows = await sqlRows(seat('auditor'), "SELECT id FROM orders WHERE status = 'auditing'");
  assert.ok(rows.length, 'an order in auditing exists');
  const orderId = Math.max(...rows.map((r) => r[0]));
  const r = await forge(seat('auditor'), 'order', String(orderId));
  assert.equal(r.code, 0, JSON.stringify(r.err));
  assert.equal(r.out.order.id, orderId);
  assert.equal(r.out.order.status, 'auditing');
  assert.equal(typeof r.out.order.apiVersionId, 'number');
  assert.ok(r.out.order.apiDescription, 'the API description is shown so agents can judge fit');
  assert.ok(r.out.order.apiFields.length > 0);
  assert.match(r.out.order.createdAt, /^\d{4}-\d\d-\d\dT/);
  assert.ok(Array.isArray(r.out.values));
  const total = Object.values(r.out.valueCounts).reduce((s, n) => s + n, 0);
  assert.equal(total, r.out.values.length);
});

test('order with a missing id fails cleanly', async () => {
  const r = await forge(seat('coo'), 'order', '999999999');
  assert.equal(r.code, 1);
  assert.match(r.err.error, /no order 999999999/);
});

test('task prints the next steps for a dispatched task', async () => {
  const r = await forge(seat('coo'), 'task', JSON.stringify({ kind: 'audit', taskId: '3', orderId: '7', input: { orderId: '7', counts: { verified: 5 } } }));
  assert.equal(r.code, 0, JSON.stringify(r.err));
  assert.equal(r.out.role, 'auditor');
  assert.ok(r.out.next.some((s) => s.includes('forge verdict 7')));
  const bad = await forge(seat('coo'), 'task', 'not json');
  assert.equal(bad.code, 1);
});

test('decide surfaces reducer errors: invalid decision and wrong seat', async () => {
  const invalid = await forge(seat('coo'), 'decide', '1', 'MAYBE', '-', 'because');
  assert.equal(invalid.code, 1);
  assert.match(invalid.err.error, /coo_decide failed \(530\): decision must be one of/);
  const wrongSeat = await forge(seat('auditor'), 'decide', '1', 'REJECT', '-', 'because');
  assert.equal(wrongSeat.code, 1);
  assert.match(wrongSeat.err.error, /role auditor may not do this/);
});

test('without FORGE_SEAT_TOKEN each write command uses its own seat variable', async () => {
  // Only the auditor's variable is set, so decide (a COO command) must refuse before calling anything.
  const noCoo = await runCli({ FORGE_SEAT_TOKEN_AUDITOR: seat('auditor') }, 'decide', '1', 'REJECT', '-', 'because');
  assert.equal(noCoo.code, 1);
  assert.match(noCoo.err.error, /FORGE_SEAT_TOKEN_COO is not set/);
  // With both set, verdict picks the auditor token: the reducer answers about the order, not the role.
  const both = await runCli({ FORGE_SEAT_TOKEN_COO: seat('coo'), FORGE_SEAT_TOKEN_AUDITOR: seat('auditor') }, 'verdict', '1', 'REJECT', 'test');
  assert.equal(both.code, 1);
  assert.match(both.err.error, /order 1 is rejected, not auditing/);
  const read = await runCli({ FORGE_SEAT_TOKEN_COO: seat('coo') }, 'catalog');
  assert.equal(read.code, 0, JSON.stringify(read.err));
});

test('happy path: front desk order, COO rejects through the CLI, verdict error paths', async () => {
  const ref = `cli-test-${Date.now()}`;
  const desk = seat('front_desk');
  await call(desk, 'create_order', [ref, `cli-test-sender-${ref}`, 'Cheapest flights SFO to JFK next Friday', '{"fields":["fare"]}', 100]);
  await call(desk, 'record_payment', [ref, 'cs_test_cli']);
  const [[orderId, status]] = await sqlRows(desk, `SELECT id, status FROM orders WHERE ref = '${ref}'`);
  assert.equal(status, 'paid');

  const reason = 'Fares only exist after a search form and cannot be re-fetched to verify (cli test).';
  const r = await forge(seat('coo'), 'decide', String(orderId), 'REJECT', '-', reason);
  assert.equal(r.code, 0, JSON.stringify(r.err));
  assert.equal(r.out.order.status, 'rejected');
  assert.equal(r.out.order.decisionReason, reason);

  const again = await forge(seat('coo'), 'decide', String(orderId), 'REJECT', '-', reason);
  assert.equal(again.code, 1);
  assert.match(again.err.error, /is rejected; nothing to decide/);

  const notAuditing = await forge(seat('auditor'), 'verdict', String(orderId), 'REJECT', 'test');
  assert.equal(notAuditing.code, 1);
  assert.match(notAuditing.err.error, /audit_verdict failed \(530\): order \d+ is rejected, not auditing/);
  const wrongSeat = await forge(seat('coo'), 'verdict', String(orderId), 'ACCEPT', 'test');
  assert.equal(wrongSeat.code, 1);
  assert.match(wrongSeat.err.error, /role coo may not do this/);
});

test('task prints the challenge steps for an audit_challenge task', async () => {
  const r = await forge(seat('auditor'), 'task', JSON.stringify({ kind: 'audit_challenge', taskId: '9', orderId: '7', input: { challengeId: '5', orderId: '7', row: 0, metric: 'batch' } }));
  assert.equal(r.code, 0, JSON.stringify(r.err));
  assert.equal(r.out.role, 'auditor');
  assert.equal(r.out.challengeId, '5');
  assert.ok(r.out.next.some((s) => s.includes('forge challenge 5')));
  assert.ok(r.out.next.some((s) => s.includes('forge challenge-verdict 5')));
  assert.ok(r.out.next.some((s) => s.includes('SAVED page')));
});

test('challenge <id> reads a rechecked challenge with saved and fresh results', async () => {
  const rows = await sqlRows(seat('auditor'), "SELECT id FROM challenge WHERE status = 'rejected'");
  assert.ok(rows.length, 'a rejected challenge exists (module/test/challenge.test.mjs makes one)');
  const challengeId = Math.max(...rows.map((r) => r[0]));
  const r = await forge(seat('auditor'), 'challenge', String(challengeId));
  assert.equal(r.code, 0, JSON.stringify(r.err));
  assert.equal(r.out.challenge.id, challengeId);
  assert.equal(r.out.challenge.verdict, 'REJECTED');
  assert.match(r.out.challenge.resolvedAt, /^\d{4}-\d\d-\d\dT/);
  assert.ok(r.out.value.excerpt && r.out.value.sourceUrl);
  assert.ok(['match', 'changed', 'missing', 'unavailable'].includes(r.out.recheck.saved.result));
  assert.ok(['match', 'changed', 'missing', 'unavailable'].includes(r.out.recheck.fresh.result));
  assert.match(r.out.recheck.saved.observedAt, /^\d{4}-/);
  assert.match(r.out.recheck.fresh.fetchedAt, /^\d{4}-/);
  assert.equal(r.out.supersededBy, null);
  const missing = await forge(seat('auditor'), 'challenge', '999999999');
  assert.equal(missing.code, 1);
  assert.match(missing.err.error, /no challenge 999999999/);
});

test('challenge-verdict surfaces reducer errors: invalid verdict, wrong seat, not auditing', async () => {
  const rows = await sqlRows(seat('auditor'), "SELECT id FROM challenge WHERE status = 'rejected'");
  const challengeId = String(Math.max(...rows.map((r) => r[0])));
  const invalid = await forge(seat('auditor'), 'challenge-verdict', challengeId, 'MAYBE', 'because');
  assert.equal(invalid.code, 1);
  assert.match(invalid.err.error, /challenge_verdict failed \(530\): verdict must be UPHELD or REJECTED/);
  const wrongSeat = await forge(seat('coo'), 'challenge-verdict', challengeId, 'REJECTED', 'because');
  assert.match(wrongSeat.err.error, /role coo may not do this/);
  const done = await runCli({ FORGE_SEAT_TOKEN_AUDITOR: seat('auditor') }, 'challenge-verdict', challengeId, 'UPHELD', 'test');
  assert.equal(done.code, 1);
  assert.match(done.err.error, /is rejected, not auditing/);
});

test('research commands: usage errors, seat checks and a non-researching order', async () => {
  for (const args of [['robots', '1'], ['research-fetch', '1'], ['search', '1'], ['gate-check', '1', 'robots', 'pass', 'https://x.com/robots.txt'], ['report', '1'], ['create-api', 'not json']]) {
    const r = await forge(seat('research'), ...args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err.error, /usage: forge/);
  }
  const wrongSeat = await forge(seat('coo'), 'robots', '1', 'https://www.ycombinator.com/companies/airbnb');
  assert.match(wrongSeat.err.error, /research_fetch failed \(5\d\d\): .*role coo may not do this/);
  const notResearching = await forge(seat('research'), 'robots', '1', 'https://www.ycombinator.com/companies/airbnb');
  assert.match(notResearching.err.error, /order 1 is \w+; research fetches are only for an order in researching/);
  const noSeat = await runCli({ FORGE_SEAT_TOKEN_COO: seat('coo') }, 'search', '1', 'anything');
  assert.match(noSeat.err.error, /FORGE_SEAT_TOKEN_RESEARCH is not set/);
});

test('research flow through the CLI on a canary order: robots, search, fetch with --find, gate checks, report', { timeout: 4 * 60_000 }, async () => {
  const ref = `cli-research-${Date.now()}`;
  const canary = seat('canary');
  await call(canary, 'create_order', [ref, 'canary', 'YC company page for Airbnb: name, batch, status', '{"origin":"cli test"}', 0]);
  await call(canary, 'record_payment', [ref, 'canary-no-payment']);
  const [[orderId]] = await sqlRows(canary, `SELECT id FROM orders WHERE ref = '${ref}'`);
  const oid = String(orderId);
  const src = 'https://www.ycombinator.com/companies/airbnb';
  try {
    const d = await forge(seat('coo'), 'decide', oid, 'REQUEST_RESEARCH', '-', 'CLI test: research the YC page.');
    assert.equal(d.code, 0, JSON.stringify(d.err));
    assert.equal(d.out.order.status, 'researching');

    const robots = await runCli({ FORGE_SEAT_TOKEN_RESEARCH: seat('research') }, 'robots', oid, src);
    assert.equal(robots.code, 0, JSON.stringify(robots.err));
    assert.equal(robots.out.url, 'https://www.ycombinator.com/robots.txt');
    assert.equal(robots.out.allowed, true);
    assert.equal(robots.out.rule, 'Allow: /');
    assert.match(robots.out.robotsTxt, /Disallow: \/companies\?\*/);
    assert.equal(robots.out.text, undefined, 'robots prints robotsTxt, not the raw text field');

    const query = ['ycombinator', 'terms', 'of', 'use'];
    let search = await forge(seat('research'), 'search', oid, ...query);
    // Bright Data SERP refuses a query for at least 15 s after it last failed upstream.
    if (search.code === 0 && !search.out.ok && /try again later/i.test(search.out.reason)) {
      assert.deepEqual(search.out.results, []);
      await new Promise((r) => setTimeout(r, 16_000));
      search = await forge(seat('research'), 'search', oid, ...query);
    }
    assert.equal(search.code, 0, JSON.stringify(search.err));
    assert.equal(search.out.ok, true, search.out.reason);
    assert.ok(search.out.results.length >= 3);
    assert.equal(search.out.text, undefined);

    const page = await forge(seat('research'), 'research-fetch', oid, src, '--find', 'Winter 2009', '--max', '200');
    assert.equal(page.code, 0, JSON.stringify(page.err));
    assert.equal(page.out.ok, true, page.out.reason);
    assert.ok(page.out.text.length <= 200);
    assert.ok(page.out.chars > 1000);
    const [hit] = page.out.found;
    assert.equal(hit.find, 'Winter 2009');
    assert.ok(hit.matches >= 1, 'the batch is on the page');
    const snippet = hit.passages[0].slice(hit.passages[0].indexOf('Winter 2009') - 20, hit.passages[0].indexOf('Winter 2009') + 11);

    const g1 = await forge(seat('research'), 'gate-check', oid, 'robots', 'pass', robots.out.url, 'Allow: /');
    assert.equal(g1.code, 0, JSON.stringify(g1.err));
    assert.ok(g1.out.gateChecks.some((g) => g.check === 'robots' && g.result === 'pass'));
    const bad = await forge(seat('research'), 'gate-check', oid, 'reachability', 'pass', src, 'Founded in 1999 by robots');
    assert.match(bad.err.error, /not on the page fetched/);
    assert.equal((await forge(seat('research'), 'gate-check', oid, 'reachability', 'pass', src, snippet)).code, 0);
    assert.equal((await forge(seat('research'), 'gate-check', oid, 'terms', 'unclear', src, 'CLI test: no terms page fetched.')).code, 0);
    assert.equal((await forge(seat('research'), 'gate-check', oid, 'volatility', 'unclear', src, 'CLI test: fetched once, not measured.')).code, 0);

    const o = await forge(seat('research'), 'order', oid);
    assert.deepEqual([...new Set(o.out.research.fetches.map((f) => f.kind))], ['robots', 'search', 'page']);
    assert.equal(o.out.research.fetches[0].allowed, true);

    const rep = await forge(seat('research'), 'report', oid, JSON.stringify({ summary: 'CLI test report.', sources: [src], fields: ['name', 'batch'], volatility: 'stable', freshnessWindowMin: 0, confidence: 0.5 }));
    assert.equal(rep.code, 0, JSON.stringify(rep.err));
    assert.equal(rep.out.order.status, 'triaging');
    assert.equal(rep.out.report.checks.terms.result, 'unclear');
    assert.deepEqual(rep.out.report.fields, ['name', 'batch']);

    const t = await forge(seat('coo'), 'task', JSON.stringify({ kind: 'coo_triage', taskId: '1', orderId: oid, input: { orderId: oid, researchReportId: String(rep.out.report.id) } }));
    assert.ok(t.out.next.some((s) => s.includes('forge create-api')));
    const create = await forge(seat('coo'), 'create-api', JSON.stringify({ name: `cli-${Date.now()}`, description: 'x', sources: [src], outputSchema: { type: 'object', properties: { name: { type: 'string' } } }, volatility: 'stable', pageCap: 1 }));
    assert.match(create.err.error, /ycombinator.com has no research report with robots, terms and reachability all passing/);
  } finally {
    await forge(seat('coo'), 'decide', oid, 'REJECT', '-', 'CLI test cleanup: the terms check is unclear.');
  }
});
