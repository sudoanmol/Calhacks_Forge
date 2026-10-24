import { schema, table, t, SenderError, Router, SyncResponse, type InferSchema, type ReducerCtx, type ProcedureCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp, type Identity } from 'spacetimedb';

const LEASE_MS = 10 * 60 * 1000;
const LEASE_SWEEP_EVERY_MICROS = 15_000_000n;

const ROLES = ['founder', 'front_desk', 'coo', 'research', 'cfo', 'auditor', 'droid_runner', 'canary'] as const;

// Founder levers (AGENTS.md §8). Values are strings; reducers parse what they need.
const CONFIG_DEFAULTS: Record<string, string> = {
  creao_max_concurrency: '2',
  refund_limit_cents: '500',
  page_cap: '25',
  blocked_domains: JSON.stringify(['facebook.com', 'instagram.com']),
  classify_min_confidence: '0.7',
  compile_min_buyers: '2',
  compile_min_verified_rate: '0.8',
  compile_window_runs: '5',
  markup_pct: '40',
  'bonus_rate.coo': '5',
  'bonus_rate.research': '5',
  'bonus_rate.cfo': '5',
  'bonus_rate.auditor': '5',
  'bonus_rate.droid_runner': '10',
};

const config = table(
  { name: 'config', public: true },
  {
    key: t.string().primaryKey(),
    value: t.string(),
    updatedAt: t.timestamp(),
  },
);

const staff = table(
  { name: 'staff', public: true },
  {
    identity: t.identity().primaryKey(),
    role: t.string(),
    label: t.string(),
    addedAt: t.timestamp(),
  },
);

const task = table(
  { name: 'task', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string().index('btree'),
    role: t.string(),
    status: t.string(), // queued | claimed | done | failed
    orderId: t.option(t.u64()),
    ticketId: t.option(t.u64()),
    leaseOwner: t.option(t.identity()),
    leaseUntil: t.option(t.timestamp()),
    attempt: t.u32(),
    input: t.string(),
    output: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const event = table(
  { name: 'event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    at: t.timestamp(),
    actor: t.string(),
    kind: t.string(),
    refType: t.string(),
    refId: t.u64(),
    payload: t.string(),
  },
);

// One row per external run (CREAO, Apify, Bright Data, Droid).
const run = table(
  { name: 'run', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    provider: t.string(),
    externalId: t.string().index('btree'),
    appId: t.string(),
    taskId: t.option(t.u64()),
    threadId: t.string(),
    status: t.string(), // starting | pending | running | completed | failed | cancelled | start_failed
    resultText: t.string(),
    shareUrl: t.string(),
    costCents: t.u32(),
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
  },
);

// One-time tokens in webhook URLs. Private: only procedures and routes read them.
const callbackToken = table(
  { name: 'callback_token' },
  {
    token: t.string().primaryKey(),
    provider: t.string(),
    runRef: t.u64(),
    usedAt: t.option(t.timestamp()),
  },
);
const leaseSweepSchedule = table(
  { name: 'lease_sweep_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);

const spacetimedb = schema(
  { config, staff, task, event, run, callbackToken, leaseSweepSchedule },
  // Set at publish time from the shell environment (spacetime publish reads declared names).
  { env: { CREAO_API_KEY: t.option(t.string()), PUBLIC_ROUTE_BASE: t.option(t.string()) } },
);
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function roleOf(ctx: Ctx, who: Identity): string | undefined {
  return ctx.db.staff.identity.find(who)?.role;
}

function requireRole(ctx: Ctx, ...allowed: string[]): string {
  const role = roleOf(ctx, ctx.sender);
  if (!role) throw new SenderError('unknown identity');
  if (!allowed.includes(role)) throw new SenderError(`role ${role} may not do this`);
  return role;
}

function logEvent(ctx: Ctx, actor: string, kind: string, refType: string, refId: bigint, payload: unknown) {
  ctx.db.event.insert({
    id: 0n, at: ctx.timestamp, actor, kind, refType, refId,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function addMs(ts: Timestamp, ms: number): Timestamp {
  return new Timestamp(ts.microsSinceUnixEpoch + BigInt(ms) * 1000n);
}

export const init = spacetimedb.init((ctx) => {
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    ctx.db.config.insert({ key, value, updatedAt: ctx.timestamp });
  }
  ctx.db.staff.insert({ identity: ctx.sender, role: 'founder', label: 'founder', addedAt: ctx.timestamp });
  ctx.db.leaseSweepSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(LEASE_SWEEP_EVERY_MICROS) });
  logEvent(ctx, 'founder', 'module_init', 'config', 0n, { configKeys: Object.keys(CONFIG_DEFAULTS).length });
});

export const set_staff = spacetimedb.reducer(
  { identity: t.identity(), role: t.string(), label: t.string() },
  (ctx, { identity, role, label }) => {
    requireRole(ctx, 'founder');
    if (!(ROLES as readonly string[]).includes(role)) throw new SenderError(`unknown role ${role}`);
    if (identity.isEqual(ctx.sender) && role !== 'founder') throw new SenderError('founder cannot demote itself');
    const existing = ctx.db.staff.identity.find(identity);
    if (existing) ctx.db.staff.identity.update({ ...existing, role, label });
    else ctx.db.staff.insert({ identity, role, label, addedAt: ctx.timestamp });
    logEvent(ctx, 'founder', 'staff_set', 'staff', 0n, { identity: identity.toHexString(), role, label });
  },
);

export const set_config = spacetimedb.reducer(
  { key: t.string(), value: t.string() },
  (ctx, { key, value }) => {
    requireRole(ctx, 'founder');
    const existing = ctx.db.config.key.find(key);
    if (!existing) throw new SenderError(`unknown config key ${key}`);
    ctx.db.config.key.update({ ...existing, value, updatedAt: ctx.timestamp });
    logEvent(ctx, 'founder', 'config_set', 'config', 0n, { key, from: existing.value, to: value });
  },
);

// Flows create tasks internally; this entry point exists for the canary and the founder.
export const enqueue_task = spacetimedb.reducer(
  { kind: t.string(), role: t.string(), input: t.string() },
  (ctx, { kind, role, input }) => {
    const actor = requireRole(ctx, 'founder', 'canary');
    if (!(ROLES as readonly string[]).includes(role)) throw new SenderError(`unknown role ${role}`);
    const row = ctx.db.task.insert({
      id: 0n, kind, role, status: 'queued', orderId: undefined, ticketId: undefined,
      leaseOwner: undefined, leaseUntil: undefined, attempt: 0, input, output: '',
      createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
    logEvent(ctx, actor, 'task_queued', 'task', row.id, { kind, role });
  },
);

export const claim_task = spacetimedb.reducer({ kind: t.string() }, (ctx, { kind }) => {
  const role = requireRole(ctx, ...ROLES.filter((r) => r !== 'founder'));
  const next = [...ctx.db.task.kind.filter(kind)]
    .filter((r) => r.role === role && r.status === 'queued')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (!next) return;
  ctx.db.task.id.update({
    ...next, status: 'claimed', leaseOwner: ctx.sender, leaseUntil: addMs(ctx.timestamp, LEASE_MS),
    attempt: next.attempt + 1, updatedAt: ctx.timestamp,
  });
  logEvent(ctx, role, 'task_claimed', 'task', next.id, { kind, attempt: next.attempt + 1 });
});

export const complete_task = spacetimedb.reducer(
  { id: t.u64(), output: t.string() },
  (ctx, { id, output }) => {
    const role = requireRole(ctx, ...ROLES.filter((r) => r !== 'founder'));
    const row = ctx.db.task.id.find(id);
    if (!row) throw new SenderError(`no task ${id}`);
    if (row.status !== 'claimed' || !row.leaseOwner || !row.leaseOwner.isEqual(ctx.sender)) {
      throw new SenderError('not the lease owner');
    }
    if (row.leaseUntil && row.leaseUntil.microsSinceUnixEpoch < ctx.timestamp.microsSinceUnixEpoch) {
      throw new SenderError('lease expired');
    }
    ctx.db.task.id.update({ ...row, status: 'done', output, leaseUntil: undefined, updatedAt: ctx.timestamp });
    logEvent(ctx, role, 'task_done', 'task', id, { kind: row.kind });
  },
);

export const lease_sweep = spacetimedb.reducer(
  { onSchedule: leaseSweepSchedule },
  { arg: leaseSweepSchedule.rowType },
  (ctx, _args) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;
    for (const row of ctx.db.task.iter()) {
      if (row.status === 'claimed' && row.leaseUntil && row.leaseUntil.microsSinceUnixEpoch < now) {
        ctx.db.task.id.update({ ...row, status: 'queued', leaseOwner: undefined, leaseUntil: undefined, updatedAt: ctx.timestamp });
        logEvent(ctx, 'schedule', 'task_lease_expired', 'task', row.id, { attempt: row.attempt });
      }
    }
  },
);

// Gate 0 smoke test: a procedure that calls the outside world with no transaction open.
export const http_smoke = spacetimedb.procedure({ url: t.string() }, t.unit(), (ctx, { url }) => {
  ctx.withTx((tx) => requireRole(tx, 'founder', 'canary'));
  let status = 0;
  let bytes = 0;
  let error = '';
  try {
    const res = ctx.http.fetch(url, { method: 'GET' });
    status = res.status;
    bytes = res.text().length;
  } catch (err) {
    error = String(err);
  }
  ctx.withTx((tx) => logEvent(tx, 'procedure', 'http_smoke', 'url', 0n, { url, status, bytes, error }));
  return {};
});

export const ping = spacetimedb.httpHandler((ctx, req) => {
  const body = req.text();
  ctx.withTx((tx) => logEvent(tx, 'route', 'route_ping', 'route', 0n, { uri: String(req.uri), bytes: body.length }));
  return new SyncResponse('pong', { status: 200, headers: { 'content-type': 'text/plain' } });
});

const CREAO_BASE = 'https://agent.creao.ai';
const CREAO_TERMINAL = ['completed', 'failed', 'cancelled'];
const RESULT_TEXT_MAX = 20_000;

type CreaoRun = { id?: string; runId?: string; status?: string; threadId?: string; result?: { text?: string; chatText?: string } };

function creaoKey(env: IoCtx['env']): string {
  const key = env.get('CREAO_API_KEY');
  if (!key) throw new SenderError('CREAO_API_KEY is not set on the module');
  return key;
}

// Starts a CREAO run with a one-time webhook token. Gate 0 entry point; the dispatch schedule
// replaces direct calls once orders exist.
export const creao_start = spacetimedb.procedure(
  { appId: t.string(), inputs: t.string(), idempotencyKey: t.string(), threadId: t.string() },
  t.unit(),
  (ctx, { appId, inputs, idempotencyKey, threadId }) => {
    const token = ctx.newUuidV4().toString();
    const runId = ctx.withTx((tx) => {
      requireRole(tx, 'founder', 'canary');
      const row = tx.db.run.insert({
        id: 0n, provider: 'creao', externalId: '', appId, taskId: undefined, threadId, status: 'starting',
        resultText: '', shareUrl: '', costCents: 0, startedAt: tx.timestamp, endedAt: undefined,
      });
      tx.db.callbackToken.insert({ token, provider: 'creao', runRef: row.id, usedAt: undefined });
      return row.id;
    });
    const base = ctx.env.get('PUBLIC_ROUTE_BASE');
    const body: Record<string, unknown> = { appId, inputs: JSON.parse(inputs), idempotencyKey };
    if (base) body.webhookUrl = `${base}/creao-callback?token=${token}`;
    if (threadId) body.threadId = threadId;
    let status = 0;
    let text = '';
    try {
      const res = ctx.http.fetch(`${CREAO_BASE}/api/v1/runs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creaoKey(ctx.env)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      status = res.status;
      text = res.text();
    } catch (err) {
      text = String(err);
    }
    ctx.withTx((tx) => {
      const row = tx.db.run.id.find(runId)!;
      let parsed: CreaoRun = {};
      try { parsed = JSON.parse(text); } catch { /* error body */ }
      const ok = status === 202 || status === 200;
      tx.db.run.id.update({
        ...row,
        externalId: parsed.id ?? parsed.runId ?? '',
        status: ok ? (parsed.status ?? 'pending') : 'start_failed',
        resultText: ok ? '' : text.slice(0, 2000),
      });
      logEvent(tx, 'procedure', ok ? 'creao_run_started' : 'creao_run_start_failed', 'run', runId,
        { appId, httpStatus: status, externalId: parsed.id ?? parsed.runId ?? '', webhook: Boolean(base) });
    });
    return {};
  },
);

// Re-fetches a CREAO run with our key and stores the trusted status. Shared by the webhook
// route and the poll fallback. Webhook bodies are never trusted.
type IoCtx = Pick<ProcedureCtx<InferSchema<typeof spacetimedb>>, 'http' | 'env' | 'withTx'>;

function refreshCreaoRun(ctx: IoCtx, runRef: bigint, actor: string) {
  const row = ctx.withTx((tx) => tx.db.run.id.find(runRef));
  if (!row || !row.externalId) return { changed: false, status: row?.status ?? 'missing' };
  if (CREAO_TERMINAL.includes(row.status)) return { changed: false, status: row.status };
  const res = ctx.http.fetch(`${CREAO_BASE}/api/v1/runs/${encodeURIComponent(row.externalId)}`, {
    method: 'GET', headers: { Authorization: `Bearer ${creaoKey(ctx.env)}` },
  });
  const text = res.text();
  if (res.status !== 200) {
    ctx.withTx((tx) => logEvent(tx, actor, 'creao_refresh_failed', 'run', runRef, { httpStatus: res.status }));
    return { changed: false, status: row.status };
  }
  const fresh = JSON.parse(text) as CreaoRun;
  return ctx.withTx((tx) => {
    const cur = tx.db.run.id.find(runRef)!;
    const status = fresh.status ?? cur.status;
    if (status === cur.status) return { changed: false, status };
    const done = CREAO_TERMINAL.includes(status);
    const result = fresh.result?.text ?? fresh.result?.chatText ?? '';
    tx.db.run.id.update({
      ...cur, status, threadId: fresh.threadId ?? cur.threadId,
      resultText: result.slice(0, RESULT_TEXT_MAX), endedAt: done ? tx.timestamp : cur.endedAt,
    });
    logEvent(tx, actor, `creao_run_${status}`, 'run', runRef, { externalId: cur.externalId, threadId: fresh.threadId ?? '', resultChars: result.length });
    return { changed: true, status };
  });
}

export const creao_poll = spacetimedb.procedure({ runRef: t.u64() }, t.unit(), (ctx, { runRef }) => {
  ctx.withTx((tx) => requireRole(tx, 'founder', 'canary'));
  refreshCreaoRun(ctx, runRef, 'procedure');
  return {};
});

export const creao_callback = spacetimedb.httpHandler((ctx, req) => {
  const token = /[?&]token=([^&]+)/.exec(String(req.uri))?.[1] ?? '';
  const claim = ctx.withTx((tx) => {
    const row = token ? tx.db.callbackToken.token.find(decodeURIComponent(token)) : undefined;
    if (!row || row.provider !== 'creao') return { ok: false as const, reason: 'unknown token' };
    if (row.usedAt) return { ok: false as const, reason: 'token already used' };
    return { ok: true as const, runRef: row.runRef };
  });
  if (!claim.ok) {
    ctx.withTx((tx) => logEvent(tx, 'route', 'creao_callback_rejected', 'run', 0n, { reason: claim.reason }));
    return new SyncResponse(claim.reason, { status: 403 });
  }
  const { status } = refreshCreaoRun(ctx, claim.runRef, 'route');
  // The token is spent only once the run is terminal, so CREAO's retries and any
  // intermediate notifications still get through.
  if (CREAO_TERMINAL.includes(status)) {
    ctx.withTx((tx) => {
      const row = tx.db.callbackToken.token.find(decodeURIComponent(token))!;
      tx.db.callbackToken.token.update({ ...row, usedAt: tx.timestamp });
    });
  }
  return new SyncResponse('ok', { status: 200 });
});
export const routes = spacetimedb.httpRouter(
  new Router().post('/ping', ping).post('/creao-callback', creao_callback),
);
