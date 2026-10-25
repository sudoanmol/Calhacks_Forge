import type { Event, Run } from './module_bindings/types';
import { payloadObj, short, usd } from './format';
import { microsUsd } from './scene';
import { triggerSummary } from './engText';

export type FeedClass = 'story' | 'plumbing' | 'system' | 'failure';
export type ActorKey =
  | 'front_desk' | 'coo' | 'research' | 'cfo' | 'auditor' | 'droid' | 'treasurer' | 'rules' | 'founder'
  | 'warehouse' | 'brightdata' | 'canary' | 'system';
export type FeedLink = { href: string; label: string } | { station: 'verify' | 'delivered'; label: string } | { none: string };
export type FeedLine = { cls: FeedClass; actor: ActorKey; text: string; link?: FeedLink };

export type FeedCtx = {
  // API name, or the start of the request text, for an order id.
  orderLabel: (orderId: bigint) => string;
  datasetUrl: (orderId: bigint) => string | undefined;
  runById: (runId: bigint) => Run | undefined;
  roleOfRun: (runId: bigint) => string | undefined;
  // The CREAO run behind a decision event made by `role`.
  runFor: (e: Event, role: string) => Run | undefined;
  // True when the named API was created for this order (after the order arrived), not taken from the catalog.
  isNewApi: (orderId: bigint, apiName: string) => boolean;
};

const ACTOR_OF: Record<string, ActorKey> = {
  front_desk: 'front_desk', coo: 'coo', research: 'research', cfo: 'cfo', auditor: 'auditor', droid: 'droid', droid_runner: 'droid',
  treasurer: 'treasurer', rules: 'rules', founder: 'founder', canary: 'canary',
};
const WAREHOUSE_KINDS = new Set(['api_run_started', 'api_run_ingested', 'api_run_waiting_for_task', 'apify_task_queued', 'apify_task_created', 'apify_task_failed', 'order_run_retried']);
const BRIGHTDATA_KINDS = new Set(['values_verified', 'challenge_rechecked', 'research_fetched']);

const PLUMBING = new Set([
  'order_params_set', 'admission_started', 'research_fetched', 'audit_skipped_canary', 'run_cost_booked', 'run_cost_settled',
  'engineering_spend_booked', 'task_queued', 'task_dispatched', 'task_claimed', 'task_done', 'task_cancelled', 'orphan_dispatch_recovered',
  'creao_run_started', 'creao_run_completed',
]);
const SYSTEM = new Set(['customer_registered', 'staff_set', 'module_init', 'defaults_ensured', 'canary_orders_backfilled', 'http_smoke', 'route_ping', 'verify_probe']);
const FAILURE = new Set([
  'admission_rejected', 'apify_task_failed', 'audit_rejected', 'order_failed', 'compile_failed', 'task_lease_expired', 'task_ended_without_decision',
  'task_requeued', 'creao_run_timed_out', 'creao_run_start_failed', 'creao_callback_rejected', 'creao_refresh_failed', 'apify_callback_rejected', 'apify_refresh_failed',
]);
// Decisions made inside a CREAO run; their feed row links to that run.
const CREAO_DECISIONS = new Set([
  'coo_accepted', 'coo_rejected', 'coo_counteroffered', 'coo_requested_research', 'research_reported', 'cfo_proposed',
  'audit_accepted', 'audit_rejected', 'challenge_rejected', 'challenge_upheld', 'compile_rejected', 'compile_accepted',
]);

export const AGENT_DECISIONS = new Set([
  'coo_accepted', 'coo_rejected', 'coo_counteroffered', 'coo_requested_research', 'research_reported', 'cfo_proposed',
  'audit_accepted', 'audit_rejected', 'challenge_upheld', 'challenge_rejected', 'compile_accepted', 'compile_rejected',
]);
export const FOUNDER_APPROVALS = new Set(['approval_approved', 'approval_rejected']);

export const humanize = (s: string) => s.replace(/_/g, ' ');
const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const cents = (v: unknown) => usd(num(v) ?? 0);
const micros = (v: unknown) => microsUsd(num(v) ?? 0);
const quoted = (v: unknown) => (str(v) ? ` "${str(v)}"` : '');

export function runLink(run: Run | undefined): FeedLink {
  if (run?.shareUrl) return { href: run.shareUrl, label: 'Open run ↗' };
  if (run?.threadId) return { href: `https://agent.creao.ai/chat?threadId=${encodeURIComponent(run.threadId)}`, label: 'Open CREAO run (account login) ↗' };
  return { none: 'no run link recorded' };
}

export function actorOf(e: Event, ctx: FeedCtx): ActorKey {
  if (WAREHOUSE_KINDS.has(e.kind)) return 'warehouse';
  if (BRIGHTDATA_KINDS.has(e.kind)) return 'brightdata';
  if (ACTOR_OF[e.actor]) return ACTOR_OF[e.actor];
  if (e.kind.startsWith('creao_run_')) {
    const role = str(payloadObj(e.payload).role) || (e.refType === 'run' ? ctx.roleOfRun(e.refId) : undefined);
    if (role && ACTOR_OF[role]) return ACTOR_OF[role];
  }
  return 'system';
}

export function classOf(e: Event): FeedClass {
  const p = payloadObj(e.payload);
  if (FAILURE.has(e.kind)) return 'failure';
  if (e.kind === 'api_run_ingested' && num(p.values) === 0) return 'failure';
  if (e.kind === 'values_verified') {
    const c = (p.counts && typeof p.counts === 'object' ? p.counts : {}) as Record<string, number>;
    const total = Object.values(c).reduce((s, n) => s + n, 0);
    if (total > 0 && !(c.verified > 0)) return 'failure';
  }
  if (SYSTEM.has(e.kind)) return 'system';
  if (PLUMBING.has(e.kind) || e.kind.startsWith('droid_')) return 'plumbing';
  return 'story';
}

function sentence(e: Event, p: Record<string, unknown>, ctx: FeedCtx): { text: string; link?: FeedLink } {
  const orderId = e.refType === 'order' ? e.refId : num(p.orderId) !== undefined ? BigInt(num(p.orderId)!) : undefined;
  switch (e.kind) {
    case 'order_quoted': return { text: `Quoted ${cents(p.priceCents)} for ${orderId !== undefined ? ctx.orderLabel(orderId) : 'the request'}` };
    case 'order_params_set': {
      const params = p.params && typeof p.params === 'object' ? Object.entries(p.params as Record<string, unknown>) : [];
      return { text: `Parameters set: ${params.map(([k, v]) => `${k}: ${str(v)}`).join(', ') || 'none'}` };
    }
    case 'order_paid': return { text: `Customer paid ${cents(p.priceCents)}${p.simulated === true ? ' · SIMULATED PAYMENT' : ''}` };
    case 'order_rejected_at_desk': return { text: `Rejected at the desk: ${humanize(str(p.check) || 'gate')}. ${str(p.reason)}` };
    case 'admission_started': return { text: `Checking admission for ${Array.isArray(p.sources) ? p.sources.length : 0} source(s)` };
    case 'admission_waiting': return { text: `First fetch saved; waiting to measure volatility (${str(p.volatility) || 'unknown'} so far)` };
    case 'admission_passed': return { text: `Admission passed: ${str(p.volatility) || 'unknown'} source` };
    case 'admission_rejected': return { text: `Admission rejected at ${str(p.check)}: ${str(p.reason)}`, link: str(p.source) ? { href: str(p.source), label: 'source ↗' } : undefined };
    case 'gate_check_recorded':
      return {
        text: `Gate check ${humanize(str(p.check))}: ${str(p.result)}${e.actor === 'rules' ? ' (automatic)' : ''}${p.citationText ? ` — "${str(p.citationText)}"` : ''}`,
        link: str(p.citationUrl) ? { href: str(p.citationUrl), label: 'citation ↗' } : undefined,
      };
    case 'research_fetched': return { text: `Fetched for Research (${str(p.kind) || 'page'}): ${str(p.target || p.url)} (${p.ok === false ? 'failed' : `HTTP ${str(p.httpStatus)}`})` };
    case 'research_reported': {
      const checks = p.checks && typeof p.checks === 'object' ? Object.entries(p.checks as Record<string, { result?: string }>) : [];
      const vol = str(p.volatility);
      return { text: `Research filed its report: ${checks.map(([k, v]) => `${humanize(k)} ${v?.result ?? '?'}`).join(', ') || 'no checks listed'}${vol ? `; volatility ${vol}` : ''}` };
    }
    case 'coo_accepted':
      return orderId !== undefined && ctx.isNewApi(orderId, str(p.api))
        ? { text: `Accepted: create a new ${str(p.api)} API.${quoted(p.reason)}` }
        : { text: `Accepted: use the existing ${str(p.api) || 'catalog'} API.${quoted(p.reason)}` };
    case 'coo_rejected': return { text: `Rejected the order.${quoted(p.reason)}` };
    case 'coo_counteroffered': return { text: `Counteroffered.${quoted(p.reason)}` };
    case 'coo_requested_research': return { text: `Sent to Research.${quoted(p.reason)}` };
    case 'api_created': return { text: `Created the ${str(p.name)} API (Tier ${str(p.tier) || '0'})` };
    case 'apify_task_queued': return { text: `Creating the Apify Task for ${str(p.name)}` };
    case 'apify_task_created': return { text: `Apify Task ${str(p.apifyTaskId)} created for ${str(p.name)}` };
    case 'apify_task_failed': return { text: `Apify Task failed for ${str(p.name)}: ${str(p.error || p.reason)}` };
    case 'api_run_started': return { text: `Started the ${p.engine === 'actor' ? 'compiled Actor' : 'forge-extract Task'} run` };
    case 'api_run_waiting_for_task': return { text: "Waiting for the API's Apify Task to exist" };
    case 'api_run_ingested': {
      const url = orderId !== undefined ? ctx.datasetUrl(orderId) : undefined;
      return { text: `${str(p.values) || '0'} values extracted (${str(p.extracted) || '0'} anchored to a quote)`, link: url ? { href: url, label: 'Dataset ↗' } : undefined };
    }
    case 'values_verified': {
      const c = (p.counts && typeof p.counts === 'object' ? p.counts : {}) as Record<string, number>;
      const total = Object.values(c).reduce((s, n) => s + n, 0);
      const rest = Object.entries(c).filter(([k, n]) => k !== 'verified' && n > 0).map(([k, n]) => `${n} ${k}`);
      return { text: `Re-fetched ${str(p.pages) || '?'} page(s): ${c.verified ?? 0}/${total} verified${rest.length ? `, ${rest.join(', ')}` : ''}`, link: { station: 'verify', label: 'Verify details' } };
    }
    case 'audit_skipped_canary': return { text: 'Audit skipped: canary order' };
    case 'audit_accepted': return { text: `Accepted the deliverable.${quoted(p.reason)}` };
    case 'audit_rejected': return { text: `Rejected the deliverable.${quoted(p.reason)}` };
    case 'order_failed': return { text: `Order failed: ${str(p.reason)}` };
    case 'order_refunded':
      return { text: `${p.status === 'pending_approval' ? 'Requested a ledger refund of' : 'Refunded'} ${cents(p.amountCents)}${p.status === 'pending_approval' ? " (waiting for the founder's approval)" : ' to the customer in the ledger'}` };
    case 'order_run_retried': return { text: `The run ${str(p.reason)}; retrying (attempt ${str(p.attempt)})` };
    case 'order_refund_requested': return { text: `Founder ${p.status === 'issued' ? 'booked a ledger refund' : 'asked for a refund (waiting for approval)'}:${quoted(p.reason)}` };
    case 'order_refund_approved': return { text: `Founder approved the ledger refund of ${cents(p.amountCents)}` };
    case 'order_refund_declined': return { text: `Founder declined the refund of ${cents(p.amountCents)}` };
    case 'run_share_linked': return { text: 'Linked a public CREAO run', link: runLink(ctx.runById(e.refId)) };
    case 'challenge_opened': return { text: `Customer challenged row ${str(p.row)} (${str(p.metric)} = "${str(p.value)}"): ${str(p.reason)}` };
    case 'challenge_rechecked':
      return {
        text: `Recheck in ${((num(p.totalMs) ?? 0) / 1000).toFixed(1)}s: saved page ${str(p.savedResult)} ("${str(p.savedValue)}"), fresh page ${str(p.freshResult)} ("${str(p.freshValue)}") after ${str(p.freshAttempts) || '?'} attempt(s)`,
        link: { station: 'delivered', label: 'Delivered details' },
      };
    case 'challenge_rejected': return { text: `Rejected the challenge:${quoted(p.reason)}${p.savedQuote ? ` (saved quote: "${str(p.savedQuote)}")` : ''}` };
    case 'challenge_upheld': {
      const refund = p.refund && typeof p.refund === 'object' ? (p.refund as Record<string, unknown>) : {};
      const clawed = Array.isArray(p.clawedBack) && p.clawedBack.length > 0;
      return { text: `Upheld the challenge:${quoted(p.reason)}. Value superseded (${str(p.newStatus)}); refund ${cents(refund.amountCents)}${clawed ? '; bonus clawed back' : ''}` };
    }
    case 'run_cost_booked': return { text: `Booked run cost ${micros(p.totalMicros)} (Apify ${micros(p.apifyMicros)}, LLM ${micros(p.llmMicros)}, Bright Data ${micros(p.brightdataMicros)})` };
    case 'run_cost_settled': return { text: `Settled run cost ${micros(p.totalMicros)}` };
    case 'approval_requested': return { text: `Asked the founder: ${humanize(str(p.kind))}${num(p.amountCents) ? ` ${cents(p.amountCents)}` : ''}${p.tool ? ` (${str(p.tool)} ${str(p.detail)})` : ''}` };
    case 'approval_approved': return { text: `Founder approved ${humanize(str(p.kind))}` };
    case 'approval_rejected': return { text: `Founder rejected ${humanize(str(p.kind))}` };
    case 'budget_cap_set': {
      const inel = Array.isArray(p.ineligible) ? p.ineligible.length : 0;
      const again = Array.isArray(p.eligibleAgain) ? p.eligibleAgain.length : 0;
      return { text: `Set the engineering cap ${cents(p.from)} → ${cents(p.to)}; ${inel} compile(s) became ineligible, ${again} eligible again` };
    }
    case 'config_set': return { text: `Changed ${str(p.key)}: ${str(p.from)} → ${str(p.to)}` };
    case 'ticket_opened':
      if (str(p.label) === 'compile') return { text: `Compile ticket #${e.refId} created` };
      return { text: `Opened a ${str(p.label) || ''} ticket${p.api ? ` for ${str(p.api)}` : ''}` };
    case 'compile_triggered': return { text: `Opened a compile ticket for ${str(p.api)}: ${triggerSummary(str(p.trigger), e.payload)}` };
    case 'cfo_proposed': return { text: `Proposed ${str(p.decision)}: ${cents(p.amountCents)}.${quoted(p.rationale)}` };
    case 'budget_reserved': return { text: `Reserved ${cents(p.amountCents)} of the ${cents(p.capCents)} cap for ${str(p.api)}` };
    case 'compile_over_cap': return { text: `${str(p.api)} needs ${cents(p.amountCents)}; ${cents(p.availableCents)} left under the cap → approval #${str(p.approvalId)}` };
    case 'compile_ineligible': return { text: `${str(p.api)} compile ineligible: cap ${cents(p.capCents)} below ${cents(p.amountCents)}` };
    case 'compile_eligible_again': return { text: `${str(p.api)} compile eligible again under the ${cents(p.capCents)} cap` };
    case 'spend_over_cap_approved': return { text: `Founder approved ${cents(p.amountCents)} over the cap for ${str(p.api)}` };
    case 'compile_started': return { text: `Droid started attempt ${str(p.attempt)} on ${str(p.api)}` };
    case 'compile_submitted': {
      const tests = p.tests && typeof p.tests === 'object' ? Object.entries(p.tests as Record<string, { status?: string }>) : [];
      return { text: `Attempt ${str(p.attempt)} submitted: tests ${p.passed ? 'passed' : 'failed'} (${tests.map(([k, v]) => `${k} ${v?.status ?? '?'}`).join(', ')})` };
    }
    case 'compile_rejected': return { text: `Sent attempt ${str(p.attempt)} back (${str(p.attempt)}/${str(p.maxAttempts)}):${quoted(p.reason)}` };
    case 'compile_accepted': return { text: `Accepted attempt ${str(p.attempt)}:${quoted(p.reason)}` };
    case 'compile_failed': return { text: `Build failed: ${str(p.reason)}` };
    case 'compile_closed': return { text: `Founder closed the compile: ${str(p.reason)}` };
    case 'api_ship_approved': return { text: `Founder approved publishing ${str(p.api)}` };
    case 'api_version_shipped':
      return { text: `${str(p.api)} v${str(p.version)} shipped (Tier ${str(p.tier)}, ${Array.isArray(p.fields) ? p.fields.length : '?'} fields); cost per call before: ${micros(p.costBeforeMicros)}` };
    case 'engineering_spend_booked': return { text: `Booked ${cents(p.amountCents)} engineering spend for ${str(p.api)}` };
    case 'api_retired': return { text: `Retired ${str(p.name)}: ${str(p.reason)}` };
    case 'api_updated': return { text: `Updated ${str(p.name)}` };
    case 'task_queued': return { text: `Task #${e.refId} queued for ${humanize(str(p.role) || '?')} (${humanize(str(p.kind))})` };
    case 'task_dispatched': return { text: `Task #${e.refId} dispatched to run #${str(p.runRef)}` };
    case 'task_claimed': return { text: `Task #${e.refId} claimed (attempt ${str(p.attempt) || '1'})` };
    case 'task_done': return { text: `Task #${e.refId} done` };
    case 'task_cancelled': return { text: `Task #${e.refId} cancelled: ${str(p.reason)}` };
    case 'orphan_dispatch_recovered': return { text: `Recovered an orphaned dispatch for task #${str(p.taskId)}` };
    case 'task_lease_expired': return { text: `Task #${e.refId} lease expired; requeued` };
    case 'task_ended_without_decision': return { text: `A CREAO run ended without a decision (${str(p.why)}); task #${e.refId} failed` };
    case 'task_requeued': return { text: `Task #${e.refId} gets one more CREAO run (${str(p.why)})` };
    case 'creao_run_timed_out': return { text: 'A CREAO run timed out after 15 min' };
    case 'creao_run_started': return { text: `CREAO run ${short(str(p.externalId), 8, 0)} started for ${humanize(str(p.role) || ctx.roleOfRun(e.refId) || '?')}`, link: runLink(ctx.runById(e.refId)) };
    case 'creao_run_completed': return { text: `CREAO run ${short(str(p.externalId), 8, 0)} completed (${str(p.resultChars) || '?'} chars)`, link: runLink(ctx.runById(e.refId)) };
    case 'creao_run_start_failed':
    case 'creao_callback_rejected':
    case 'creao_refresh_failed':
    case 'apify_callback_rejected':
    case 'apify_refresh_failed': return { text: `${humanize(e.kind)}: ${str(p.reason) || `HTTP ${str(p.httpStatus)}`}` };
  }
  if (e.kind.startsWith('droid_')) return { text: `Droid ${humanize(e.kind.slice(6))}${p.attempt !== undefined ? ` · attempt ${str(p.attempt)}` : ''}` };
  if (SYSTEM.has(e.kind)) return { text: humanize(e.kind) };
  const fields = Object.entries(p).filter(([, v]) => v !== '' && v !== null && v !== undefined).slice(0, 3)
    .map(([k, v]) => `${k}: ${short(str(v), 60, 0)}`).join(', ');
  return { text: `${humanize(e.kind)}${fields ? ` — ${fields}` : ''}` };
}

export function describe(e: Event, ctx: FeedCtx): FeedLine {
  const p = payloadObj(e.payload);
  const actor = actorOf(e, ctx);
  const { text, link } = sentence(e, p, ctx);
  const withRun = !link && CREAO_DECISIONS.has(e.kind) ? runLink(ctx.runFor(e, e.actor)) : link;
  // Every dollar amount on screen carries TEST MODE on the same line.
  return { cls: classOf(e), actor, text: text.includes('$') ? `${text} · TEST MODE` : text, link: withRun };
}

// Consecutive events of these kinds collapse into one feed row.
export function groupSentence(kind: string, events: readonly Event[]): string | undefined {
  if (kind === 'research_fetched') {
    const kinds = [...new Set(events.map((e) => str(payloadObj(e.payload).kind)).filter(Boolean))];
    return `Fetched ${events.length} pages for Research${kinds.length ? ` (${kinds.join(', ')})` : ''}`;
  }
  if (kind === 'droid_droid_message') return `Droid · ${events.length} messages`;
  return undefined;
}
