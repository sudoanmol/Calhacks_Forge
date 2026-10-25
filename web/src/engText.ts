import type { Api, ApiCost, Approval, Budget, CompileJob, Event, RunCost, Task } from './module_bindings/types';
import { micros, payloadObj, usd } from './format';

export function triggerSummary(trigger: string, detailJson: string): string {
  const d = payloadObj(detailJson);
  if (trigger === 'buyers') return `${d.buyers} distinct buyers (threshold ${d.minBuyers})`;
  if (trigger === 'verified_rate') return `${d.verified}/${d.total} verified over ${d.runs} runs (${d.verifiedRate}) below ${d.minVerifiedRate}`;
  if (trigger === 'challenge_upheld') return `Challenge #${d.challengeId} upheld on order #${d.orderId}: the extractor misread row ${d.row} (${d.metric})`;
  return trigger.replace(/_/g, ' ');
}

const reasonOf = (events: readonly Event[], ticketId: bigint, kind: string) => {
  const e = events.filter((x) => x.refType === 'ticket' && x.refId === ticketId && x.kind === kind).at(-1);
  const r = e ? payloadObj(e.payload).reason : undefined;
  return typeof r === 'string' ? r : 'no reason recorded';
};

export function compileStatusSentence(job: CompileJob, ctx: { budget?: Budget; events: readonly Event[]; version?: string }): string {
  switch (job.status) {
    case 'awaiting_cfo': return `CFO reviewing: ${triggerSummary(job.trigger, job.triggerDetail)}`;
    case 'awaiting_approval': return `Blocked: ${usd(job.amountCents)} is over the engineering cap; waiting for the founder`;
    case 'queued': return `Funded: ${usd(job.amountCents)} reserved; waiting for a worker to claim it`;
    case 'ineligible': return `Blocked: over the engineering cap (${ctx.budget ? usd(ctx.budget.capCents) : 'unknown'}); raise the cap to requeue`;
    case 'compiling': return `Droid is building attempt ${job.attempt}`;
    case 'auditing': return `Auditor reviewing attempt ${job.attempt}`;
    case 'rework': return 'Sent back by the Auditor; Droid resumes the same session';
    case 'ship_pending': return "Accepted; waiting for the founder's publish approval";
    case 'shipping': return 'Publishing to Apify';
    case 'shipped': return `Shipped as v${ctx.version ?? '?'} · Tier 1`;
    case 'failed': return `Failed: ${reasonOf(ctx.events, job.ticketId, 'compile_failed')}`;
    case 'closed': return `Closed by the founder: ${reasonOf(ctx.events, job.ticketId, 'compile_closed')}`;
    default: return job.status;
  }
}

// Sentences above that mention money; the caller appends TEST MODE to these.
export const MONEY_STATUSES = new Set(['awaiting_approval', 'queued', 'ineligible']);

const ATTEMPT_KINDS = new Set(['compile_started', 'compile_submitted', 'compile_rejected', 'compile_accepted']);
const TRIGGER_KINDS = new Set(['ticket_opened', 'compile_triggered']);
const BUDGET_KINDS = new Set(['budget_reserved', 'compile_over_cap', 'spend_over_cap_approved', 'compile_ineligible', 'compile_eligible_again']);
const SHIP_KINDS = new Set(['droid_ship_push_started', 'droid_ship_push_finished', 'droid_ship_build_confirmed', 'api_version_shipped', 'engineering_spend_booked']);
export const MESSAGE_KINDS = new Set(['droid_droid_message', 'droid_assistant']);

export type Attempt = {
  n: number;
  events: Event[]; // oldest first
  approvals: Approval[]; // droid_action approvals raised by this attempt's compile task
  taskIds: bigint[];
  auditTaskId?: bigint;
  submitted?: Event;
  verdict?: Event; // compile_rejected or compile_accepted
};

export type Timeline = {
  trigger: Event[];
  cfo: Event[];
  budget: Event[];
  attempts: Attempt[];
  publish: Event[];
  ship: Event[];
  // Task bookkeeping and anything without a step; kept so nothing is dropped.
  other: Event[];
  approvals: Approval[];
};

const big = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : undefined);
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
const order = (a: Event, b: Event) => (micros(a.at) < micros(b.at) ? -1 : micros(a.at) > micros(b.at) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The compile job's story, from ticket events, the events of the ticket's tasks and the approvals raised for either.
export function buildTimeline(job: CompileJob, all: readonly Event[], tasks: readonly Task[], approvals: readonly Approval[]): Timeline {
  const jobTasks = tasks.filter((t) => t.ticketId === job.ticketId);
  const taskIds = new Set(jobTasks.map((t) => t.id));
  const mine = approvals.filter((a) => (a.refType === 'ticket' && a.refId === job.ticketId) || (a.refType === 'task' && taskIds.has(a.refId)));
  const approvalById = new Map(mine.map((a) => [a.id, a]));
  const events = all.filter((e) =>
    (e.refType === 'ticket' && e.refId === job.ticketId) || (e.refType === 'task' && taskIds.has(e.refId)) || (e.refType === 'approval' && approvalById.has(e.refId)),
  ).sort(order);

  // compile_started names the task that runs each attempt; droid events without an attempt number inherit it from their task.
  const attemptOfTask = new Map<bigint, number>();
  for (const e of events) {
    if (e.kind !== 'compile_started') continue;
    const p = payloadObj(e.payload);
    const n = int(p.attempt);
    const t = big(p.taskId);
    if (n !== undefined && t !== undefined) attemptOfTask.set(t, n);
  }
  const attempts = new Map<number, Attempt>();
  const attemptFor = (n: number) => {
    let a = attempts.get(n);
    if (!a) { a = { n, events: [], approvals: [], taskIds: [] }; attempts.set(n, a); }
    return a;
  };
  for (const [t, n] of attemptOfTask) attemptFor(n).taskIds.push(t);

  const tl: Timeline = { trigger: [], cfo: [], budget: [], attempts: [], publish: [], ship: [], other: [], approvals: mine };
  let lastAttempt: number | undefined;
  for (const e of events) {
    const k = e.kind;
    const p = payloadObj(e.payload);
    if (TRIGGER_KINDS.has(k)) { tl.trigger.push(e); continue; }
    if (k === 'cfo_proposed') { tl.cfo.push(e); continue; }
    if (BUDGET_KINDS.has(k)) { tl.budget.push(e); continue; }
    if (SHIP_KINDS.has(k)) { tl.ship.push(e); continue; }
    if (k === 'api_ship_approved') { tl.publish.push(e); continue; }
    if (e.refType === 'approval') {
      const a = approvalById.get(e.refId)!;
      if (a.kind === 'api_ship') tl.publish.push(e);
      else if (a.kind === 'spend_over_cap') tl.budget.push(e);
      else if (a.kind === 'droid_action') {
        const n = attemptOfTask.get(a.refId);
        if (n !== undefined) attemptFor(n).events.push(e); else tl.other.push(e);
      } else tl.other.push(e);
      continue;
    }
    if (ATTEMPT_KINDS.has(k) || k.startsWith('droid_') || (k === 'compile_failed' && int(p.attempt) !== undefined)) {
      const n = int(p.attempt) ?? (e.refType === 'task' ? attemptOfTask.get(e.refId) : undefined) ?? lastAttempt;
      if (n === undefined) { tl.other.push(e); continue; }
      lastAttempt = n;
      const a = attemptFor(n);
      a.events.push(e);
      if (k === 'compile_submitted') a.submitted = e;
      if (k === 'compile_rejected' || k === 'compile_accepted') a.verdict = e;
      continue;
    }
    tl.other.push(e);
  }

  for (const a of mine) {
    if (a.kind !== 'droid_action' || a.refType !== 'task') continue;
    const n = attemptOfTask.get(a.refId);
    if (n !== undefined) attemptFor(n).approvals.push(a);
  }

  // Each submission is audited by the next audit task queued after it.
  const auditTasks = jobTasks.filter((t) => t.kind === 'audit_compile').sort((a, b) => (a.id < b.id ? -1 : 1));
  const queuedAt = (t: Task) => events.find((e) => e.refType === 'task' && e.refId === t.id && e.kind === 'task_queued');
  const used = new Set<bigint>();
  tl.attempts = [...attempts.values()].sort((a, b) => a.n - b.n);
  for (const a of tl.attempts) {
    if (!a.submitted) continue;
    const audit = auditTasks.find((t) => {
      if (used.has(t.id)) return false;
      const q = queuedAt(t);
      return q ? order(q, a.submitted!) > 0 : t.createdAt.microsSinceUnixEpoch >= a.submitted!.at.microsSinceUnixEpoch;
    });
    if (audit) { used.add(audit.id); a.auditTaskId = audit.id; }
  }
  return tl;
}

export type TestView = { name: string; status: string; label: string; ok: boolean | undefined; ms?: number; output: string };

// `fixtures ✓ 1/1`, `live ✕ 1 failed`. Prefers the per-test droid_tests events; falls back to the tests map on compile_submitted.
export function attemptTests(a: Attempt): TestView[] {
  const fromEvents = a.events.filter((e) => e.kind === 'droid_tests').map((e) => {
    const p = payloadObj(e.payload);
    return testView(typeof p.test === 'string' ? p.test : 'test', p);
  });
  if (fromEvents.length) return fromEvents;
  const tests = a.submitted ? payloadObj(a.submitted.payload).tests : undefined;
  if (!tests || typeof tests !== 'object') return [];
  return Object.entries(tests as Record<string, unknown>).map(([name, t]) => testView(name, t && typeof t === 'object' ? (t as Record<string, unknown>) : {}));
}

function testView(name: string, p: Record<string, unknown>): TestView {
  const status = typeof p.status === 'string' ? p.status : 'unknown';
  const pass = int(p.pass);
  const fail = int(p.fail);
  const ms = int(p.ms);
  const output = typeof p.output === 'string' && p.output ? p.output : JSON.stringify(p, null, 2);
  if (status === 'pass') return { name, status, ok: true, ms, output, label: `${name} ✓${pass !== undefined ? ` ${pass}/${pass + (fail ?? 0)}` : ''}` };
  if (status === 'fail') return { name, status, ok: false, ms, output, label: `${name} ✕${fail ? ` ${fail} failed` : ' failed'}` };
  return { name, status, ok: undefined, ms, output, label: `${name} · ${status.replace(/_/g, ' ')}` };
}

export type ToolChip = { key: string; tool: string; outcome: 'auto-allowed' | 'denied' | 'founder-approved' | 'needs-approval' | string; tip: string };

// droid_tool_decision rows, plus droid_action approvals that the worker did not also log as a decision.
export function toolChips(a: Attempt): ToolChip[] {
  const chips: ToolChip[] = a.events.filter((e) => e.kind === 'droid_tool_decision').map((e) => {
    const p = payloadObj(e.payload);
    const tool = typeof p.tool === 'string' ? p.tool : 'tool';
    const outcome = typeof p.outcome === 'string' ? p.outcome : 'unknown';
    const tip = [typeof p.detail === 'string' ? p.detail : '', typeof p.reason === 'string' ? `Reason: ${p.reason}` : '', int(p.exitCode) !== undefined ? `exit ${p.exitCode}` : '']
      .filter(Boolean).join('\n');
    return { key: `e${e.id}`, tool, outcome, tip };
  });
  for (const ap of a.approvals) {
    const d = payloadObj(ap.detail);
    const tool = typeof d.tool === 'string' ? d.tool : 'tool';
    const detail = typeof d.detail === 'string' ? d.detail : '';
    const outcome = ap.status === 'approved' ? 'founder-approved' : ap.status === 'rejected' ? 'denied' : 'needs-approval';
    if (chips.some((c) => c.tool === tool && c.outcome === outcome && c.tip.startsWith(detail))) continue;
    const tip = [detail, typeof d.reason === 'string' ? `Reason: ${d.reason}` : '', `Approval #${ap.id}: ${ap.status === 'pending' ? 'waiting for the founder' : `founder ${ap.status}`}`]
      .filter(Boolean).join('\n');
    chips.push({ key: `a${ap.id}`, tool, outcome, tip });
  }
  return chips;
}

export type CostView = { before: bigint; after?: { micros: bigint; runs: number }; shipped: boolean };

// After-compile cost is only shown when finalized runs exist on the compiled version itself; api_cost falls back to
// older-version runs when the new version has none, so it is used only when it is measured on that version.
export function compileCost(job: CompileJob, ctx: { api?: Api; apiCost?: ApiCost; runCosts: readonly RunCost[]; orderVersion: (orderId: bigint) => bigint | undefined }): CostView {
  const shipped = job.versionId !== undefined && job.status === 'shipped';
  if (!shipped) return { before: job.costBeforeMicros, shipped };
  const onVersion = ctx.runCosts.filter((r) => r.finalized && r.apiId === job.apiId && ctx.orderVersion(r.orderId) === job.versionId);
  if (!onVersion.length) return { before: job.costBeforeMicros, shipped };
  if (ctx.api?.currentVersionId === job.versionId && ctx.apiCost && ctx.apiCost.runs > 0) {
    return { before: job.costBeforeMicros, shipped, after: { micros: ctx.apiCost.costPerCallMicros, runs: ctx.apiCost.runs } };
  }
  const sum = onVersion.reduce((s, r) => s + r.totalMicros, 0n);
  return { before: job.costBeforeMicros, shipped, after: { micros: sum / BigInt(onVersion.length), runs: onVersion.length } };
}

export const ACTIVE_STATUSES = new Set(['awaiting_cfo', 'awaiting_approval', 'queued', 'ineligible', 'compiling', 'auditing', 'rework', 'ship_pending', 'shipping']);
