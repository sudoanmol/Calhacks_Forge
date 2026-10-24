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
