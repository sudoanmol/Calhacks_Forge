import { schema, table, t, SenderError, Router, SyncResponse, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp, type Identity } from 'spacetimedb';

const LEASE_MS = 10 * 60 * 1000;
const LEASE_SWEEP_EVERY_MICROS = 15_000_000n;

const ROLES = ['founder', 'front_desk', 'coo', 'research', 'cfo', 'auditor', 'droid_runner', 'canary'] as const;

// Founder levers (AGENTS.md §8). Values are strings; reducers parse what they need.
const CONFIG_DEFAULTS: Record<string, string> = {
  creao_max_concurrency: '2',
  refund_limit_cents: '500',
  page_cap: '25',
  blocked_domains: JSON.stringify(['linkedin.com', 'facebook.com', 'instagram.com']),
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

const leaseSweepSchedule = table(
  { name: 'lease_sweep_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);

const spacetimedb = schema({ config, staff, task, event, leaseSweepSchedule });
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

export const routes = spacetimedb.httpRouter(new Router().post('/ping', ping));
