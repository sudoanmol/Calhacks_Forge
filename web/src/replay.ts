import type { Timestamp } from 'spacetimedb';
import type { Api, Challenge, Event, Orders, Run, Task, ValueRecord } from './module_bindings/types';
import { byIdAsc, micros, payloadObj } from './format';
import type { SceneData } from './scene';

export type Speed = 1 | 4 | 16;
export const SPEEDS: readonly Speed[] = [1, 4, 16];
// cursor null means live: every row is shown and nothing is filtered.
export type ReplayState = { cursor: bigint | null; playing: boolean; speed: Speed };
export const LIVE_STATE: ReplayState = { cursor: null, playing: false, speed: 4 };

const upTo = (ts: Timestamp, cursor: bigint) => micros(ts) <= cursor;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

// Every event that tells the selected order's story: the order itself, an API created for it, its challenges,
// and the task and run rows behind it. The feed's order view and the replay bar's range read the same set.
export function orderTimeline(order: Orders, events: readonly Event[], tasks: readonly Task[], runs: readonly Run[], apis: readonly Api[]): Event[] {
  const id = order.id;
  const taskIds = new Set(tasks.filter((t) => t.orderId === id).map((t) => t.id));
  const runIds = new Set(runs.filter((r) => (r.taskId !== undefined && taskIds.has(r.taskId)) || (r.provider === 'apify' && r.threadId === String(id))).map((r) => r.id));
  const newApi = order.apiId !== undefined ? apis.find((a) => a.id === order.apiId && micros(a.createdAt) >= micros(order.createdAt)) : undefined;
  return events.filter((e) =>
    (e.refType === 'order' && e.refId === id)
    || (newApi !== undefined && e.refType === 'api' && e.refId === newApi.id && micros(e.at) >= micros(order.createdAt))
    || (e.refType === 'challenge' && payloadObj(e.payload).orderId === String(id))
    || (e.refType === 'task' && taskIds.has(e.refId))
    || (e.refType === 'run' && runIds.has(e.refId)),
  ).sort(byIdAsc);
}

// The order row as it stood at the cursor. Every setOrder event carries the new status in its payload, so the
// latest one at or before the cursor is the status then; fields set by later events are cleared.
export function orderAt(o: Orders, orderEvents: readonly Event[], cursor: bigint): Orders {
  const evs = orderEvents.filter((e) => e.refType === 'order' && e.refId === o.id && upTo(e.at, cursor));
  const has = (k: string) => evs.some((e) => e.kind === k);
  let status = o.status === 'rejected_at_desk' ? 'rejected_at_desk' : 'quoted';
  let reason = o.status === 'rejected_at_desk' ? o.decisionReason : '';
  let params: string | undefined;
  for (const e of evs) {
    const p = payloadObj(e.payload);
    status = str(p.status) ?? status;
    reason = str(p.reason) ?? reason;
    if (e.kind === 'order_params_set' && p.params && typeof p.params === 'object') params = JSON.stringify(p.params);
  }
  const paramsLater = params === undefined && orderEvents.some((e) => e.refType === 'order' && e.refId === o.id && e.kind === 'order_params_set');
  const accepted = has('coo_accepted');
  return {
    ...o,
    status,
    decisionReason: reason,
    params: params ?? (paramsLater ? '{}' : o.params),
    apiId: accepted ? o.apiId : undefined,
    apiVersionId: accepted ? o.apiVersionId : undefined,
    stripeSessionId: has('order_paid') ? o.stripeSessionId : '',
    apifyRunId: has('api_run_started') ? o.apifyRunId : '',
    datasetUrl: has('api_run_ingested') ? o.datasetUrl : '',
    updatedAt: evs.at(-1)?.at ?? o.createdAt,
  };
}

// Values observed by the cursor. A value verified after the cursor shows its extraction status; the extractor's
// quote anchor already marked unanchored values unverifiable, so those keep that status.
export function valuesAt(values: readonly ValueRecord[], cursor: bigint): ValueRecord[] {
  return values
    .filter((v) => upTo(v.observedAt, cursor) && (v.supersedesId === undefined || (v.verifiedAt !== undefined && upTo(v.verifiedAt, cursor))))
    .map((v) => (v.verifiedAt !== undefined && !upTo(v.verifiedAt, cursor)
      ? { ...v, verifiedAt: undefined, freshValue: '', status: v.status === 'unverifiable' ? 'unverifiable' : 'extracted' }
      : v));
}

const TASK_STATUS: Record<string, string> = {
  task_queued: 'queued', task_lease_expired: 'queued', task_claimed: 'claimed', task_dispatched: 'dispatched',
  task_done: 'done', task_cancelled: 'cancelled', task_ended_without_decision: 'failed',
};
const CHALLENGE_STATUS: Record<string, string> = {
  challenge_opened: 'rechecking', challenge_rechecked: 'auditing', challenge_rejected: 'rejected', challenge_upheld: 'upheld',
};

function statusFrom(map: Record<string, string>, evs: readonly Event[], refType: string, id: bigint, cursor: bigint): string | undefined {
  let s: string | undefined;
  for (const e of evs) if (e.refType === refType && e.refId === id && upTo(e.at, cursor) && map[e.kind]) s = map[e.kind];
  return s;
}

// The scene's inputs with every row newer than the cursor removed and every status rolled back to what the
// stored events say it was then. `related` holds the task and challenge events (see orderTimeline).
// The back office (budget, approvals, tickets, compile jobs) stays live: it is company state, not this order's.
export function replaySlice(data: SceneData, cursor: bigint, related: readonly Event[] = []): SceneData {
  const order = orderAt(data.order, data.orderEvents, cursor);
  const tasks: Task[] = data.tasks.filter((t) => upTo(t.createdAt, cursor)).map((t) => (upTo(t.updatedAt, cursor) ? t : {
    ...t, status: statusFrom(TASK_STATUS, related, 'task', t.id, cursor) ?? 'queued', updatedAt: t.createdAt, output: '',
  }));
  const runs: Run[] = data.runs.filter((r) => upTo(r.startedAt, cursor)).map((r) => (r.endedAt === undefined || upTo(r.endedAt, cursor) ? r : {
    ...r, endedAt: undefined, status: 'running', resultText: '',
  }));
  const challenges: Challenge[] = data.challenges.filter((c) => upTo(c.createdAt, cursor)).map((c) => (c.resolvedAt === undefined || upTo(c.resolvedAt, cursor) ? c : {
    ...c, resolvedAt: undefined, verdict: '', auditorReason: '', status: statusFrom(CHALLENGE_STATUS, related, 'challenge', c.id, cursor) ?? 'rechecking',
  }));
  return {
    ...data,
    order,
    orderEvents: data.orderEvents.filter((e) => upTo(e.at, cursor)),
    api: order.apiId !== undefined ? data.api : undefined,
    apiVersion: order.apiId !== undefined ? data.apiVersion : undefined,
    gates: data.gates.filter((g) => upTo(g.at, cursor)),
    values: valuesAt(data.values, cursor),
    evidence: data.evidence.filter((x) => upTo(x.fetchedAt, cursor)),
    runs,
    tasks,
    challenges,
    runCosts: data.runCosts.filter((r) => upTo(r.at, cursor)),
    bonuses: data.bonuses.filter((b) => upTo(b.createdAt, cursor)),
    // A balance updated after the cursor has no stored earlier value, so it is hidden rather than guessed.
    books: data.books.filter((b) => upTo(b.updatedAt, cursor)),
  };
}
