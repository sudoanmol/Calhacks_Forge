import { useMemo, useState, type ReactNode } from 'react';
import { useReducer } from 'spacetimedb/react';
import { useTable } from './db';
import { reducers, tables } from './module_bindings';
import type { Approval, Event, Run } from './module_bindings/types';
import { clock, list, payloadObj, short, usd } from './format';
import { microsUsd } from './scene';
import { runLink } from './feedText';
import { Avatar } from './Avatar';
import { DroidConsole, PatchView } from './DroidConsole';
import {
  buildTimeline, compileCost, compileStatusSentence, MESSAGE_KINDS, MONEY_STATUSES, toolChips, triggerSummary,
  type Attempt, type Timeline,
} from './engText';

const RECORDED = new Set(['shipped', 'failed', 'closed']);
const LIVE_BUILD = new Set(['compiling', 'rework']);
const CLOSABLE = new Set(['awaiting_cfo', 'awaiting_approval', 'queued', 'ineligible', 'auditing', 'rework', 'ship_pending']);

const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const cents = (v: unknown) => usd(num(v) ?? 0);
const Test = () => <span className="badge test">TEST MODE</span>;

type Props = { founder: boolean; jobId: bigint | null; onJob: (ticketId: bigint) => void };

export function EngineeringTab({ founder, jobId, onJob }: Props) {
  const [jobs] = useTable(tables.compileJob);
  const [apis] = useTable(tables.api);
  const [retired] = useTable(tables.apiRetired);
  const [events] = useTable(tables.event);
  const [tasks] = useTable(tables.task);
  const [runs] = useTable(tables.run);
  const [approvals] = useTable(tables.approval);
  const [versions] = useTable(tables.apiVersion);
  const [budgets] = useTable(tables.budget);
  const [apiCosts] = useTable(tables.apiCost);
  const [runCosts] = useTable(tables.runCost);
  const [orders] = useTable(tables.orders);
  const [showRetired, setShowRetired] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const close = useReducer(reducers.closeCompile);

  const hidden = new Set(retired.map((r) => r.apiId));
  const visible = jobs.filter((j) => showRetired || !hidden.has(j.apiId)).sort((a, b) => (a.ticketId > b.ticketId ? -1 : 1));
  const job = visible.find((j) => j.ticketId === jobId) ?? visible[0];
  const api = apis.find((a) => a.id === job?.apiId);
  const version = job?.versionId !== undefined ? versions.find((v) => v.id === job.versionId) : undefined;
  const timeline = useMemo(() => (job ? buildTimeline(job, events, tasks, approvals) : undefined), [job, events, tasks, approvals]);
  const runOfTask = (taskId: bigint | undefined): Run | undefined =>
    taskId === undefined ? undefined : runs.filter((r) => r.taskId === taskId).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const cfoTask = tasks.filter((t) => t.ticketId === job?.ticketId && t.role === 'cfo').sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const budget = budgets.find((b) => b.name === 'engineering');

  return <section className="engineering eng" data-testid="engineering">
    <div className="eng-bar">
      <label htmlFor="compile-job" className="picker-title">Compile job</label>
      <select id="compile-job" value={job ? String(job.ticketId) : ''} onChange={(e) => onJob(BigInt(e.target.value))} data-testid="compile-job">
        {visible.map((j) => <option key={String(j.ticketId)} value={String(j.ticketId)}>#{String(j.ticketId)} · {apis.find((a) => a.id === j.apiId)?.name ?? `api ${j.apiId}`} · {j.status.replace(/_/g, ' ')}{hidden.has(j.apiId) ? ' · retired' : ''}</option>)}
      </select>
      <label className="toggle"><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} data-testid="show-retired-jobs" /> Show retired API jobs</label>
    </div>
    {!job || !timeline ? <p className="muted">No engineering work yet.</p> : <>
      <header className="eng-head">
        <h2>Build a dedicated extractor for {api?.name ?? `API ${job.apiId}`}</h2>
        {RECORDED.has(job.status)
          ? <span className="badge recorded" data-testid="eng-recorded">RECORDED {clock(job.createdAt)} → {clock(job.updatedAt)}</span>
          : <span className="badge live">LIVE</span>}
        {hidden.has(job.apiId) && <span className="badge testtraffic">RETIRED API</span>}
      </header>
      <p className="eng-sub muted">compile ticket #{String(job.ticketId)} · Tier 0 → Tier 1 · attempt {job.attempt}</p>
      <p className="eng-status" data-testid="eng-status">
        {compileStatusSentence(job, { budget, events, version: version?.version })}{MONEY_STATUSES.has(job.status) && <> <Test /></>}
      </p>

      <ol className="eng-timeline" data-testid="eng-timeline" key={String(job.ticketId)}>
        <TriggerStep tl={timeline} trigger={job.trigger} detail={job.triggerDetail} />
        {timeline.cfo.length > 0 && <Step kind="cfo" title="CFO decision" at={timeline.cfo[0].at} actor="cfo">
          {timeline.cfo.map((e) => <CfoLine key={String(e.id)} e={e} run={runOfTask(cfoTask?.id)} />)}
        </Step>}
        {timeline.budget.length > 0 && <Step kind="budget" title="Engineering budget" at={timeline.budget[0].at} actor="treasurer">
          {timeline.budget.map((e) => <Line key={String(e.id)} e={e} actor={e.actor}>{budgetText(e, timeline.approvals)} <Test /></Line>)}
        </Step>}
        {timeline.attempts.map((a) => (
          <AttemptStep key={a.n} a={a} auditRun={runOfTask(a.auditTaskId)}
            live={LIVE_BUILD.has(job.status) && a === timeline.attempts.at(-1)}
            diff={a.verdict?.kind === 'compile_accepted' || (!timeline.attempts.some((x) => x.verdict?.kind === 'compile_accepted') && a === timeline.attempts.at(-1)) ? job.testResults : undefined}
            diffLabel={a.verdict?.kind === 'compile_accepted' ? 'Extractor diff' : 'Latest submitted diff'} />
        ))}
        {timeline.publish.length > 0 && <Step kind="publish" title="Founder publish approval" at={timeline.publish[0].at} actor="founder">
          {[...timeline.publish].sort(publishOrder).map((e) => <Line key={String(e.id)} e={e} actor={e.actor}>{publishText(e, timeline.approvals)}</Line>)}
        </Step>}
        {timeline.ship.length > 0 && <Step kind="ship" title="Ship" at={timeline.ship[0].at} actor="droid">
          {timeline.ship.map((e) => <ShipLine key={String(e.id)} e={e} prevFields={(v) => {
            const prev = versions.find((x) => x.apiId === job.apiId && x.version === v);
            return prev ? list(prev.fields) : undefined;
          }} />)}
        </Step>}
        <CostStep cost={compileCost(job, {
          api, apiCost: apiCosts.find((c) => c.apiId === job.apiId), runCosts,
          orderVersion: (id) => orders.find((o) => o.id === id)?.apiVersionId,
        })} />
      </ol>

      {timeline.other.length > 0 && <details className="eng-raw">
        <summary>Job history · {timeline.other.length} more event{timeline.other.length === 1 ? '' : 's'} (task bookkeeping)</summary>
        <ul className="eng-other">{timeline.other.map((e) => <li key={String(e.id)}><RawEvent e={e} /></li>)}</ul>
      </details>}

      {CLOSABLE.has(job.status) && <form className="control-row" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setMessage('');
        try { await close({ ticketId: job.ticketId, reason }); setMessage('Compile closed. Its remaining reservation was settled.'); setReason(''); }
        catch (err) { setMessage(String(err)); }
        finally { setBusy(false); }
      }}>
        <label htmlFor="close-compile-reason">Reason to close this idle compile</label>
        <input id="close-compile-reason" required value={reason} onChange={(e) => setReason(e.target.value)} disabled={!founder || busy} />
        <button disabled={!founder || busy || !reason.trim()}>Close compile</button>
        {!founder && <p className="muted">Founder identity required</p>}
      </form>}
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}

type ActorRole = 'cfo' | 'treasurer' | 'droid' | 'auditor' | 'founder' | 'rules';
const ROLE_OF: Record<string, ActorRole> = { cfo: 'cfo', treasurer: 'treasurer', droid: 'droid', droid_runner: 'droid', auditor: 'auditor', founder: 'founder', rules: 'rules' };

function Step({ kind, title, at, actor, children, outcome }: { kind: string; title: ReactNode; at?: Event['at']; actor: ActorRole; children: ReactNode; outcome?: ReactNode }) {
  return <li className={`eng-step k-${kind}`} data-step={kind}>
    <div className="eng-step-head">
      <Avatar actor={actor} />
      <h3>{title}</h3>
      {outcome}
      {at && <span className="eng-time">{clock(at)}</span>}
    </div>
    <div className="eng-step-body">{children}</div>
  </li>;
}

function Line({ e, children, actor, failure }: { e: Event; children: ReactNode; actor?: string; failure?: boolean }) {
  const role = actor ? ROLE_OF[actor] : undefined;
  return <div className={`eng-line${failure ? ' fail' : ''}`}>
    <span className="eng-time">{clock(e.at)}</span>
    {role ? <Avatar actor={role} /> : <span className="avatar none" aria-hidden="true" />}
    <span className="eng-text">{failure && '✕ '}{children}</span>
  </div>;
}

function RunLinkView({ run }: { run: Run | undefined }) {
  const l = runLink(run);
  return 'href' in l ? <a href={l.href} target="_blank" rel="noreferrer">{l.label}</a> : <span className="muted">{'none' in l ? l.none : ''}</span>;
}

function RawEvent({ e }: { e: Event }) {
  return <details className="eng-json">
    <summary>{clock(e.at)} · {e.kind} · {e.refType} #{String(e.refId)}</summary>
    <pre>{JSON.stringify(payloadObj(e.payload), null, 2)}</pre>
  </details>;
}

function TriggerStep({ tl, trigger, detail }: { tl: Timeline; trigger: string; detail: string }) {
  if (!tl.trigger.length) return null;
  const opened = tl.trigger.find((e) => e.kind === 'ticket_opened');
  return <Step kind="trigger" title="Trigger" at={tl.trigger[0].at} actor="rules">
    <p className="eng-lead">{triggerSummary(trigger, detail)}</p>
    {opened && <p className="muted eng-note">Rules opened a {str(payloadObj(opened.payload).label) || 'compile'} ticket for {str(payloadObj(opened.payload).api)}; the CFO decides whether to invest.</p>}
    <details className="eng-json"><summary>Trigger events ({tl.trigger.length})</summary>{tl.trigger.map((e) => <RawEvent key={String(e.id)} e={e} />)}</details>
  </Step>;
}

function CfoLine({ e, run }: { e: Event; run: Run | undefined }) {
  const p = payloadObj(e.payload);
  const rationale = str(p.rationale);
  return <>
    <p className="eng-lead">Proposed {str(p.decision) || 'a decision'}: {cents(p.amountCents)} <Test /> · <RunLinkView run={run} /></p>
    {rationale && <details className="eng-expand"><summary>Rationale</summary><blockquote className="eng-quote">{rationale}</blockquote></details>}
  </>;
}

function approvalOf(e: Event, approvals: readonly Approval[]) {
  return e.refType === 'approval' ? approvals.find((a) => a.id === e.refId) : undefined;
}

function budgetText(e: Event, approvals: readonly Approval[]): string {
  const p = payloadObj(e.payload);
  switch (e.kind) {
    case 'budget_reserved': return `Reserved ${cents(p.amountCents)} of the ${cents(p.capCents)} cap`;
    case 'compile_over_cap': return `Needs ${cents(p.amountCents)}; ${cents(p.availableCents)} left under the cap → approval #${str(p.approvalId)}`;
    case 'spend_over_cap_approved': return `Founder approved ${cents(p.amountCents)} over the cap`;
    case 'compile_ineligible': return `Ineligible: the cap fell to ${cents(p.capCents)}, below the ${cents(p.amountCents)} needed`;
    case 'compile_eligible_again': return `Eligible again under the ${cents(p.capCents)} cap`;
    case 'approval_requested': return `Asked the founder to spend ${cents(p.amountCents)} over the cap (approval #${String(e.refId)})`;
    case 'approval_approved': case 'approval_rejected': {
      const a = approvalOf(e, approvals);
      return `Founder ${e.kind === 'approval_approved' ? 'approved' : 'rejected'} approval #${String(e.refId)}${a ? ` (${cents(a.amountCents)} over the cap)` : ''}`;
    }
    default: return e.kind.replace(/_/g, ' ');
  }
}

// Same-second publish rows read request → founder decision → job moved to shipping.
const PUBLISH_RANK = (e: Event) => (e.kind === 'approval_requested' ? 0 : e.kind === 'api_ship_approved' ? 2 : 1);
const publishOrder = (x: Event, y: Event) => {
  const d = x.at.microsSinceUnixEpoch - y.at.microsSinceUnixEpoch;
  return d < 0n ? -1 : d > 0n ? 1 : PUBLISH_RANK(x) - PUBLISH_RANK(y);
};

function publishText(e: Event, approvals: readonly Approval[]): ReactNode {
  const p = payloadObj(e.payload);
  const a = approvalOf(e, approvals);
  switch (e.kind) {
    case 'approval_requested': return <>{e.actor === 'auditor' ? 'The Auditor' : e.actor} asked the founder to publish {str(p.api)} (approval #{String(e.refId)}){a?.status === 'pending' && <> · <b>waiting in Needs you</b></>}</>;
    case 'approval_approved': return <>Founder approved approval #{String(e.refId)}: publish {str(payloadObj(a?.detail ?? '').api) || 'the compiled version'}</>;
    case 'approval_rejected': return <>Founder rejected approval #{String(e.refId)}: do not publish</>;
    case 'api_ship_approved': return <>Publish approved; the worker may now run <code>apify push</code></>;
    default: return e.kind.replace(/_/g, ' ');
  }
}

function ShipLine({ e, prevFields }: { e: Event; prevFields: (version: string) => string[] | undefined }) {
  const p = payloadObj(e.payload);
  switch (e.kind) {
    case 'droid_ship_push_started': return <Line e={e} actor={e.actor}><code>apify push</code> started: {str(p.actor)} v{str(p.version)}</Line>;
    case 'droid_ship_push_finished': {
      const ok = num(p.exitCode) === 0;
      return <Line e={e} actor={e.actor} failure={!ok}>
        <code>apify push</code> finished: exit {str(p.exitCode)} in {((num(p.ms) ?? 0) / 1000).toFixed(1)} s
        {str(p.output) && <details className="eng-expand"><summary>Push output</summary><pre>{str(p.output)}</pre></details>}
      </Line>;
    }
    case 'droid_ship_build_confirmed':
      return <Line e={e} actor={e.actor} failure={str(p.status) !== 'SUCCEEDED'}>Apify build {str(p.buildNumber)}: {str(p.status)} · Actor <code>{str(p.actorId)}</code></Line>;
    case 'engineering_spend_booked': return <Line e={e} actor={e.actor}>Booked {cents(p.amountCents)} engineering spend <Test /></Line>;
    case 'api_version_shipped': {
      const fields = Array.isArray(p.fields) ? p.fields.map(String) : [];
      const prevV = str(p.previousVersion);
      const prev = prevV ? prevFields(prevV) : undefined;
      const superset = prev ? prev.every((f) => fields.includes(f)) : undefined;
      return <Line e={e} actor={e.actor} failure={superset === false}>
        <b>v{str(p.version)} · Tier {str(p.tier)}</b> · {fields.length} field{fields.length === 1 ? '' : 's'}
        {prevV && (superset === undefined ? `, previous v${prevV}` : superset ? `, superset of v${prevV}` : `, not a superset of v${prevV}`)}
        {str(p.apifyId) && <> · Actor <code>{str(p.apifyId)}</code></>}
      </Line>;
    }
    default: return <Line e={e} actor={e.actor}>{e.kind.replace(/_/g, ' ')}</Line>;
  }
}

function CostStep({ cost }: { cost: ReturnType<typeof compileCost> }) {
  if (cost.before === 0n && !cost.shipped) return null;
  return <Step kind="cost" title="Cost per call" actor="treasurer">
    <p className="eng-lead" data-testid="eng-cost">
      Before: {cost.before > 0n ? `${microsUsd(cost.before)} per call (measured over Tier 0 runs)` : 'not measured'}.{' '}
      {!cost.shipped ? 'After: not shipped yet.'
        : cost.after ? `After: ${microsUsd(cost.after.micros)} per call, measured over ${cost.after.runs} Tier 1 run${cost.after.runs === 1 ? '' : 's'}.`
          : 'After: no Tier 1 runs yet.'} <Test />
    </p>
    <p className="muted eng-note">Vendor costs per run (Apify, LLM, Bright Data) from the Treasurer's run_cost rows.</p>
  </Step>;
}

// Rendered by the Droid console; everything else in the attempt stays a timeline line.
const CONSOLE_KINDS = new Set(['droid_session_created', 'droid_session_resumed', 'droid_compile_started', 'droid_fixtures_written', 'droid_rework_started',
  'droid_harness_updated', 'droid_prompt', 'droid_tool_decision', 'droid_tests', 'droid_files_changed', 'droid_compile_finished', ...MESSAGE_KINDS]);

function AttemptStep({ a, auditRun, diff, diffLabel, live }: { a: Attempt; auditRun: Run | undefined; diff?: string; diffLabel: string; live: boolean }) {
  const [replaying, setReplaying] = useState(false);
  // Founder approvals for off-list commands are approval rows, not tool decisions; they keep their chips.
  const chips = toolChips(a).filter((c) => c.key.startsWith('a'));
  const consoleEvents = a.events.filter((e) => CONSOLE_KINDS.has(e.kind));
  const files = a.events.filter((e) => e.kind === 'droid_files_changed').flatMap((e) => {
    const f = payloadObj(e.payload).files;
    return Array.isArray(f) ? f.map(String) : [];
  });
  const shown = new Set([...CONSOLE_KINDS, 'compile_submitted', 'compile_rejected', 'compile_accepted', 'approval_requested', 'approval_approved', 'approval_rejected']);
  const verdict = a.verdict;
  const vp = verdict ? payloadObj(verdict.payload) : {};
  const accepted = verdict?.kind === 'compile_accepted';
  const outcome = verdict
    ? <span className={`eng-outcome ${accepted ? 'o-ok' : 'o-bad'}`}>{accepted ? '✓ Accepted' : '✕ Sent back'}</span>
    : a.submitted ? <span className="eng-outcome o-warn">● Auditor reviewing</span> : <span className="eng-outcome o-warn">● Building</span>;
  const res = diff ? payloadObj(diff) : {};
  const diffText = typeof res.diff === 'string' ? res.diff : '';
  const diffFiles = Array.isArray(res.files) ? res.files.map(String) : files;
  const sp = a.submitted ? payloadObj(a.submitted.payload) : {};

  return <Step kind="attempt" title={`Attempt ${a.n}`} at={a.events[0]?.at} actor="droid" outcome={outcome}>
    <div data-testid={`attempt-${a.n}`}>
      {a.events.filter((e) => !shown.has(e.kind)).map((e) => <AttemptLine key={String(e.id)} e={e} />)}
      <DroidConsole events={consoleEvents} live={live} onReplayChange={setReplaying} />
      {!replaying && <>
      {chips.length > 0 && <div className="eng-row"><span className="eng-label">Founder decisions</span>
        <span className="eng-chips">{chips.map((c) => (
          <span key={c.key} className={`tool-chip o-${c.outcome}`} title={c.tip} tabIndex={0} aria-label={`${c.tool} ${c.outcome}. ${c.tip}`}>
            {c.outcome === 'auto-allowed' ? '✓' : c.outcome === 'denied' ? '✕' : c.outcome === 'founder-approved' ? '★' : '!'} {c.tool} · {c.outcome}
          </span>
        ))}</span>
      </div>}
      {a.submitted && <Line e={a.submitted} actor={a.submitted.actor} failure={sp.passed === false}>
        Submitted for audit: tests {sp.passed === true ? 'passed' : 'failed'}
      </Line>}
      {verdict && <div className={`eng-verdict ${accepted ? 'v-ok' : 'v-bad'}`} data-testid={`verdict-${a.n}`}>
        <div className="eng-line">
          <span className="eng-time">{clock(verdict.at)}</span>
          <Avatar actor="auditor" />
          <span className="eng-text"><b>Auditor {accepted ? `accepted attempt ${a.n}` : `sent attempt ${a.n} back (${str(vp.attempt)}/${str(vp.maxAttempts) || '?'})`}</b> · <RunLinkView run={auditRun} /></span>
        </div>
        <blockquote className="eng-quote">{str(vp.reason) || 'no reason recorded'}</blockquote>
      </div>}
      {diff !== undefined && diffText && <div className="eng-diff" data-testid={`diff-${a.n}`}>
        <h4 className="eng-diff-title">{diffLabel} · {diffFiles.join(', ')}</h4>
        <PatchView patch={diffText} />
      </div>}
      </>}
    </div>
  </Step>;
}

function AttemptLine({ e }: { e: Event }) {
  const p = payloadObj(e.payload);
  const sid = str(p.sessionId);
  switch (e.kind) {
    case 'compile_started': return <Line e={e} actor={e.actor}>Droid runner claimed task #{str(p.taskId)} and started attempt {str(p.attempt)}</Line>;
    case 'droid_compile_started': return <Line e={e} actor={e.actor}>Worker prepared the worktree{p.rebuilt === true ? ' (rebuilt)' : ''}</Line>;
    case 'droid_fixtures_written': {
      const fx = Array.isArray(p.fixtures) ? p.fixtures.length : 0;
      const fields = Array.isArray(p.fields) ? p.fields.map(String).join(', ') : '';
      return <Line e={e} actor={e.actor}>Fixtures written from order #{str(p.orderId)}: {fx} saved Tier 0 page{fx === 1 ? '' : 's'} with audited values ({fields})</Line>;
    }
    case 'droid_session_created':
      return <div className="eng-session" data-testid="session-header"><span className="eng-time">{clock(e.at)}</span><b>New Droid session</b> <code title={sid}>{short(sid, 8, 4)}</code>
        {Array.isArray(p.keptTools) && <span className="muted"> · tools kept: {p.keptTools.map(String).join(', ')} · {str(p.disabledCount)} disabled</span>}</div>;
    case 'droid_session_resumed':
      return <div className="eng-session" data-testid="session-header"><span className="eng-time">{clock(e.at)}</span><b>Same session, resumed</b> <code title={str(p.resumedSessionId) || sid}>{short(str(p.resumedSessionId) || sid, 8, 4)}</code></div>;
    case 'droid_rework_started': return <Line e={e} actor={e.actor}>Rework started after the Auditor's rejection</Line>;
    case 'droid_harness_updated': return <Line e={e} actor={e.actor}>Test harness updated: <code>{Array.isArray(p.files) ? p.files.map(String).join(', ') : ''}</code>{str(p.reason) && ` · ${str(p.reason)}`}</Line>;
    case 'droid_compile_finished': {
      const turns = Array.isArray(p.turns) ? p.turns : [];
      const summary = turns.map((t) => {
        const r = t && typeof t === 'object' ? (t as Record<string, unknown>).result : undefined;
        return r && typeof r === 'object' ? str((r as Record<string, unknown>).text) : '';
      }).filter(Boolean).join('\n\n');
      return <Line e={e} actor={e.actor} failure={p.passed === false}>
        Droid finished {p.resumed === true ? 'the resumed session' : 'the session'}: tests {p.passed === true ? 'passed' : 'failed'}
        {summary && <details className="eng-expand"><summary>Droid's summary</summary><pre>{summary}</pre></details>}
      </Line>;
    }
    case 'compile_failed': return <Line e={e} actor={e.actor} failure>Build failed: {str(p.reason)}</Line>;
    default: return <Line e={e} actor={e.actor}>{e.kind.replace(/^droid_/, '').replace(/_/g, ' ')}<RawEvent e={e} /></Line>;
  }
}
