import type { Budget, CompileJob, Event } from './module_bindings/types';
import { payloadObj, usd } from './format';

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
