import { useMemo, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { useTable } from './db';
import { reducers, tables } from './module_bindings';
import type { Approval, Event } from './module_bindings/types';
import { byIdDesc, clock, micros, payloadObj, usd } from './format';
import { AGENT_DECISIONS, FOUNDER_APPROVALS, humanize, type ActorKey } from './feedText';
import { Avatar, ROLE_META } from './Avatar';
import { useEventScope, type Scope } from './scope';

// Counts events, not unique decisions: a compile that is sent back and then accepted counts twice.
export function useDecisionCounts(scope: Scope, sinceMicros?: bigint) {
  const [events] = useTable(tables.event);
  const inScope = useEventScope(scope);
  return useMemo(() => {
    let decisions = 0;
    let approvals = 0;
    for (const e of events) {
      if (sinceMicros !== undefined && micros(e.at) < sinceMicros) continue;
      if (AGENT_DECISIONS.has(e.kind) && inScope(e)) decisions++;
      else if (FOUNDER_APPROVALS.has(e.kind) && inScope(e)) approvals++;
    }
    return { decisions, approvals };
  }, [events, inScope, sinceMicros]);
}

const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);

type CardText = { title: string; body: string; consequence?: string };

export function NeedsYou({ scope, founder }: { scope: Scope; founder: boolean }) {
  const [approvals] = useTable(tables.approval);
  const [events, eventsReady] = useTable(tables.event);
  const [jobs] = useTable(tables.compileJob);
  const [apis] = useTable(tables.api);
  const [budgets] = useTable(tables.budget);
  const [refunds] = useTable(tables.refund);
  const [config] = useTable(tables.config);
  // Pending approvals show whatever the toggle says (the founder has to act on them either way);
  // ones outside the real scope carry the TEST TRAFFIC badge.
  const realScope = useMemo(() => ({ ...scope, showTest: false }), [scope]);
  const isRealEvent = useEventScope(realScope);
  const { decisions } = useDecisionCounts(scope);

  const pending = approvals.filter((a) => a.status === 'pending').sort(byIdDesc);
  const requestOf = (id: bigint) => events.find((e) => e.kind === 'approval_requested' && e.refType === 'approval' && e.refId === id);
  const lastTicketEvent = (ticketId: bigint, kind: string) =>
    events.filter((e) => e.refType === 'ticket' && e.refId === ticketId && e.kind === kind).sort(byIdDesc)[0];
  const budget = budgets.find((b) => b.name === 'engineering');
  const refundLimit = config.find((c) => c.key === 'refund_limit_cents')?.value;

  function text(a: Approval, req: Event | undefined): CardText {
    const detail = payloadObj(a.detail);
    const reqP = req ? payloadObj(req.payload) : {};
    const job = a.refType === 'ticket' ? jobs.find((j) => j.ticketId === a.refId) : undefined;
    const api = (job ? apis.find((x) => x.id === job.apiId)?.name : undefined) ?? (str(detail.api) || str(reqP.api) || 'the API');
    switch (a.kind) {
      case 'api_ship': {
        const accepted = job ? lastTicketEvent(job.ticketId, 'compile_accepted') : undefined;
        const reason = str(accepted ? payloadObj(accepted.payload).reason : undefined) || str(detail.auditorReason);
        const attempt = job?.attempt ?? num(detail.attempt);
        const tests = job ? payloadObj(job.testResults).tests : undefined;
        const statuses = tests && typeof tests === 'object' ? Object.entries(tests as Record<string, { status?: string }>) : [];
        const allPass = statuses.length > 0 && statuses.every(([, t]) => t?.status === 'pass');
        const testLine = allPass
          ? `passed ${statuses.map(([k]) => k).join(', ')} tests`
          : statuses.length ? `test results: ${statuses.map(([k, t]) => `${k} ${t?.status ?? '?'}`).join(', ')}` : 'has no stored test results';
        return {
          title: `Publish the compiled ${api}?`,
          body: `Droid's attempt ${attempt ?? '?'} ${testLine}; the Auditor accepted it${reason ? `: "${reason}"` : '.'}`,
          consequence: "Every buyer's next call uses the compiled version. The worker runs apify push only after this.",
        };
      }
      case 'spend_over_cap': {
        const amount = usd(job?.amountCents ?? a.amountCents);
        const cap = budget?.capCents ?? num(detail.capCents);
        const available = budget ? budget.capCents - budget.reservedCents - budget.spentCents : num(detail.availableCents);
        const proposed = a.refType === 'ticket' ? lastTicketEvent(a.refId, 'cfo_proposed') : undefined;
        const rationale = job?.rationale || str(proposed ? payloadObj(proposed.payload).rationale : undefined);
        return {
          title: `Spend ${amount} over the engineering cap on ${api}?`,
          body: `The CFO proposed ${amount} to build a dedicated extractor${rationale ? `: "${rationale}"` : '.'}${available !== undefined && cap !== undefined ? ` Only ${usd(available)} is left under the ${usd(cap)} cap.` : ''}`,
          consequence: 'Approving reserves the money and queues Droid.',
        };
      }
      case 'droid_action': {
        const tool = str(reqP.tool) || str(detail.tool) || 'a command';
        const cmd = str(reqP.detail) || str(detail.detail);
        const reason = str(reqP.reason) || str(detail.reason);
        return {
          title: `Let Droid run ${tool}${cmd ? ` ${cmd}` : ''}?`,
          body: `Outside the auto-allowed test commands.${reason ? ` Reason: ${reason}.` : ''}`,
          consequence: 'Rejecting denies this one call; Droid continues without it.',
        };
      }
      case 'refund_over_limit': {
        const refund = a.refType === 'refund' ? refunds.find((r) => r.id === a.refId) : undefined;
        const orderId = refund ? String(refund.orderId) : str(detail.orderId) || '?';
        const challengeId = refund ? String(refund.challengeId) : str(detail.challengeId) || '?';
        const limit = num(refundLimit) ?? num(detail.limitCents);
        return {
          title: `Refund ${usd(refund?.amountCents ?? a.amountCents)} on order #${orderId}?`,
          body: `Challenge #${challengeId} was upheld.${limit !== undefined ? ` The refund is above the ${usd(limit)} limit.` : ''}`,
          consequence: 'The customer account is credited; the responsible bonus is clawed back.',
        };
      }
      default:
        return { title: `${humanize(a.kind)} #${a.id}`, body: a.detail };
    }
  }

  return (
    <section className="panel needs" aria-label="Needs you" data-testid="needs-you">
      <h2 className="picker-title">Needs you{pending.length ? ` · ${pending.length}` : ''}</h2>
      {pending.length === 0 ? (
        <div className="needs-empty" data-testid="needs-empty">
          <p>Nothing is waiting on the founder.</p>
          {eventsReady
            ? <p className="muted"><b className="num">{decisions}</b> agent decision{decisions === 1 ? '' : 's'} so far without you.</p>
            : <p className="muted">Counting agent decisions…</p>}
        </div>
      ) : (
        pending.map((a) => {
          const req = requestOf(a.id);
          return (
            <ApprovalCard
              key={String(a.id)} approval={a} text={text(a, req)} founder={founder}
              requester={req ? { actor: actorKey(req.actor), at: clock(req.at) } : undefined}
              testTraffic={req ? !isRealEvent(req) : false}
            />
          );
        })
      )}
    </section>
  );
}

const actorKey = (actor: string): ActorKey => (actor === 'droid_runner' ? 'droid' : actor in ROLE_META ? (actor as ActorKey) : 'system');

function ApprovalCard({ approval: a, text, founder, requester, testTraffic }: {
  approval: Approval; text: CardText; founder: boolean; requester?: { actor: ActorKey; at: string }; testTraffic: boolean;
}) {
  const decide = useReducer(reducers.decideApproval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(approve: boolean) {
    setBusy(true); setError('');
    try { await decide({ id: a.id, approve }); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  const money = text.title.includes('$') || text.body.includes('$') || a.amountCents > 0;
  return (
    <article className="needs-card" data-testid={`approval-${a.id}`}>
      <header>
        <h3>{text.title}</h3>
        <span className="muted">#{String(a.id)}</span>
      </header>
      <p className="needs-meta">
        {requester
          ? <><Avatar actor={requester.actor} /> Asked by {ROLE_META[requester.actor].label} at {requester.at}</>
          : <span className="muted">No request event recorded</span>}
        {money && <span className="badge test">TEST MODE</span>}
        {testTraffic && <span className="badge testtraffic">TEST TRAFFIC</span>}
      </p>
      <p className="needs-body">{text.body}</p>
      {a.amountCents > 0 && <p className="needs-amount">Amount <b>{usd(a.amountCents)}</b> <span className="badge test">TEST MODE</span></p>}
      {text.consequence && <p className="needs-consequence">{text.consequence}</p>}
      <div className="needs-actions">
        <button disabled={!founder || busy} onClick={() => act(true)}>{busy ? 'Sending…' : 'Approve'}</button>
        <button disabled={!founder || busy} onClick={() => act(false)}>{busy ? 'Sending…' : 'Reject'}</button>
        {!founder && <span className="muted">Founder identity required</span>}
      </div>
      {error && <p role="status" className="bad">{error}</p>}
    </article>
  );
}
