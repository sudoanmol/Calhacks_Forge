// Runs against a real SpacetimeDB server (default: local `spacetime start` + `pnpm publish:local`).
// SPACETIME_HOST / SPACETIME_DB / FOUNDER_TOKEN point it at Maincloud.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, route, newIdentity, identityArg, founderToken } from './client.mjs';

let founder, w1, w2, stranger;
const kind = `test-${Date.now()}`;

before(async () => {
  founder = founderToken();
  [w1, w2, stranger] = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
  for (const [w, label] of [[w1, 'w1'], [w2, 'w2']]) {
    const r = await call(founder, 'set_staff', [identityArg(w.identity), 'droid_runner', label]);
    assert.equal(r.status, 200, r.body);
  }
});

test('init seeded config and the founder', async () => {
  const cfg = await sql(founder, "SELECT * FROM config WHERE key = 'compile_min_buyers'");
  assert.equal(cfg.length, 1);
  const founders = await sql(founder, "SELECT * FROM staff WHERE role = 'founder'");
  assert.equal(founders.length, 1);
});

test('unknown identity is rejected', async () => {
  const r = await call(stranger.token, 'claim_task', [kind]);
  assert.equal(r.ok, false);
  assert.match(r.body, /unknown identity/);
});

test('only the founder can change config or staff', async () => {
  const a = await call(w1.token, 'set_config', ['page_cap', '1']);
  assert.equal(a.ok, false);
  assert.match(a.body, /may not/);
  const b = await call(w1.token, 'set_staff', [identityArg(stranger.identity), 'coo', 'x']);
  assert.equal(b.ok, false);
  const c = await call(founder, 'set_config', ['page_cap', '30']);
  assert.equal(c.status, 200, c.body);
  const [row] = await sql(founder, "SELECT * FROM config WHERE key = 'page_cap'");
  assert.equal(row.value, '30');
  await call(founder, 'set_config', ['page_cap', '25']);
});

test('unknown config key is rejected', async () => {
  const r = await call(founder, 'set_config', ['not_a_lever', '1']);
  assert.equal(r.ok, false);
});

test('double claim: two workers race, exactly one wins', async () => {
  const q = await call(founder, 'enqueue_task', [kind, 'droid_runner', '{}']);
  assert.equal(q.status, 200, q.body);
  const [a, b] = await Promise.all([call(w1.token, 'claim_task', [kind]), call(w2.token, 'claim_task', [kind])]);
  assert.equal(a.status, 200, a.body);
  assert.equal(b.status, 200, b.body);
  const rows = await sql(founder, `SELECT * FROM task WHERE kind = '${kind}'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'claimed');
  assert.equal(rows[0].attempt, 1);
  const owner = rows[0].lease_owner;
  const ownerHex = JSON.stringify(owner);
  const winners = [w1, w2].filter((w) => ownerHex.includes(w.identity));
  assert.equal(winners.length, 1, `lease owner ${ownerHex}`);
});

test('only the lease owner can complete a task', async () => {
  const [row] = await sql(founder, `SELECT * FROM task WHERE kind = '${kind}'`);
  const ownerHex = JSON.stringify(row.lease_owner);
  const [winner, loser] = ownerHex.includes(w1.identity) ? [w1, w2] : [w2, w1];
  const bad = await call(loser.token, 'complete_task', [row.id, '{"ok":true}']);
  assert.equal(bad.ok, false);
  assert.match(bad.body, /lease owner/);
  const good = await call(winner.token, 'complete_task', [row.id, '{"ok":true}']);
  assert.equal(good.status, 200, good.body);
  const [done] = await sql(founder, `SELECT * FROM task WHERE id = ${row.id}`);
  assert.equal(done.status, 'done');
  assert.equal(done.output, '{"ok":true}');
});

test('claim with an empty queue is a no-op', async () => {
  const r = await call(w1.token, 'claim_task', [`${kind}-empty`]);
  assert.equal(r.status, 200, r.body);
});

test('a worker only claims tasks for its own role', async () => {
  const k = `${kind}-coo`;
  await call(founder, 'enqueue_task', [k, 'coo', '{}']);
  await call(w1.token, 'claim_task', [k]);
  const [row] = await sql(founder, `SELECT * FROM task WHERE kind = '${k}'`);
  assert.equal(row.status, 'queued');
});

test('every state change appends an event', async () => {
  const ev = await sql(founder, "SELECT * FROM event WHERE kind = 'task_claimed'");
  assert.ok(ev.some((e) => e.payload.includes(kind)));
});

test('route receives a callback and records it', async () => {
  const marker = `m${Date.now()}`;
  const r = await route(`/ping?token=${marker}`, { method: 'POST', body: 'hello' });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'pong');
  const ev = await sql(founder, "SELECT * FROM event WHERE kind = 'route_ping'");
  assert.ok(ev.some((e) => e.payload.includes(marker)), 'query string reaches the handler');
});

test('procedure makes an outbound HTTP call', async () => {
  const url = `https://www.google.com/generate_204?m=${Date.now()}`;
  const r = await call(founder, 'http_smoke', [url]);
  assert.equal(r.status, 200, r.body);
  const ev = await sql(founder, "SELECT * FROM event WHERE kind = 'http_smoke'");
  const mine = ev.map((e) => JSON.parse(e.payload)).find((p) => p.url === url);
  assert.ok(mine, 'procedure logged its fetch');
  assert.equal(mine.error, '');
  assert.equal(mine.status, 204);
});

test('non-staff cannot run the smoke procedure', async () => {
  const r = await call(stranger.token, 'http_smoke', ['https://example.com']);
  assert.equal(r.ok, false);
});
