// CREAO run plumbing against the real CREAO API. Needs CREAO_API_KEY published to the module.
// A real end-to-end run also needs CREAO_APP_ID (a saved agent); without it that test is skipped.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, route, newIdentity, founderToken } from './client.mjs';

let founder, stranger;
const marker = `test-app-${Date.now()}`;

before(async () => {
  founder = founderToken();
  stranger = await newIdentity();
});

test('only founder or canary can start a CREAO run', async () => {
  const r = await call(stranger.token, 'creao_start', [marker, '{}', `${marker}-x`, '']);
  assert.equal(r.ok, false);
  assert.match(r.body, /unknown identity/);
});

test('a run CREAO refuses is recorded as start_failed with its HTTP status', async () => {
  const r = await call(founder, 'creao_start', [marker, '{"prompt":"hi"}', `${marker}-key`, '']);
  assert.equal(r.status, 200, r.body);
  const [row] = await sql(founder, `SELECT * FROM run WHERE app_id = '${marker}'`);
  assert.equal(row.status, 'start_failed');
  assert.ok(row.result_text.length > 0, 'CREAO error body is kept');
  const ev = await sql(founder, "SELECT * FROM event WHERE kind = 'creao_run_start_failed'");
  const mine = ev.map((e) => JSON.parse(e.payload)).find((p) => p.appId === marker);
  assert.ok(mine.httpStatus >= 400 && mine.httpStatus < 500, `httpStatus ${mine.httpStatus}`);
  assert.equal(mine.webhook, true);
});

test('separate starts create a callback token scoped to each run', async () => {
  for (const suffix of ['first', 'second']) {
    const app = `${marker}-${suffix}`;
    const r = await call(founder, 'creao_start', [app, '{}', app, '']);
    assert.equal(r.status, 200, r.body);
    const [run] = await sql(founder, `SELECT * FROM run WHERE app_id = '${app}'`);
    const [token] = await sql(founder, `SELECT * FROM callback_token WHERE run_ref = ${run.id}`);
    assert.equal(token.provider, 'creao');
    assert.ok(token.token.endsWith(`-${run.id}`));
    assert.equal(run.status, 'start_failed', 'invalid test apps do not start a paid run');
  }
});

test('callback with an unknown token is rejected and logged', async () => {
  const r = await route(`/creao-callback?token=nope-${Date.now()}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId: 'forged', status: 'completed', result: { text: 'forged' } }),
  });
  assert.equal(r.status, 403);
  const ev = await sql(founder, "SELECT * FROM event WHERE kind = 'creao_callback_rejected'");
  assert.ok(ev.length > 0);
});

test('real CREAO run: started, webhook lands, status re-fetched', { skip: !process.env.CREAO_APP_ID, timeout: 15 * 60_000 }, async () => {
  const appId = process.env.CREAO_APP_ID;
  const key = `gate0-${Date.now()}`;
  const inputs = process.env.CREAO_INPUTS ?? '{"prompt":"Reply with the single word: pong"}';
  const r = await call(founder, 'creao_start', [appId, inputs, key, '']);
  assert.equal(r.status, 200, r.body);
  const rows = await sql(founder, `SELECT * FROM run WHERE app_id = '${appId}'`);
  const row = rows.sort((a, b) => Number(b.id) - Number(a.id))[0];
  assert.notEqual(row.status, 'start_failed', row.result_text);
  assert.ok(row.external_id, 'CREAO returned a run id');
  // Wait for the webhook only (no polling), so a pass proves the callback route works.
  const deadline = Date.now() + 14 * 60_000;
  let cur = row;
  while (Date.now() < deadline && !['completed', 'failed', 'cancelled'].includes(cur.status)) {
    await new Promise((res) => setTimeout(res, 10_000));
    [cur] = await sql(founder, `SELECT * FROM run WHERE id = ${row.id}`);
  }
  assert.equal(cur.status, 'completed', `final status ${cur.status}`);
  assert.ok(cur.thread_id, 'threadId stored');
  const ev = await sql(founder, `SELECT * FROM event WHERE ref_type = 'run' AND ref_id = ${row.id}`);
  assert.ok(ev.some((e) => e.actor === 'route' && e.kind === 'creao_run_completed'), 'completion came through the webhook route');
  console.log(JSON.stringify({ runRef: String(row.id), externalId: cur.external_id, threadId: cur.thread_id, result: cur.result_text.slice(0, 200) }));
});
