import { useEffect, type ReactNode } from 'react';
import { useTable } from './db';
import { tables } from './module_bindings';
import type { Event, Run, Task } from './module_bindings/types';
import { STATION_META, durationText, verifyEvidence, microsUsd, DESK_CHECKS, type Scene, type SceneData, type StationId, type StationView } from './scene';
import { SPONSOR_COLOR, STATE_COLOR } from './Floor';
import { ChallengesTable, CountBadges, EvidenceTable, GateTable, RunsTable, Section, ValuesTable } from './Detail';
import { byIdAsc, clock, micros, payloadObj, short, usd } from './format';
import { runLink, type ActorKey } from './feedText';
import { Avatar, ROLE_META } from './Avatar';

type Props = { id: StationId; data: SceneData; scene: Scene; onClose: () => void };

export function StationDrawer({ id, data, scene, onClose }: Props) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const v = scene.stations[id];
  const m = STATION_META[id];
  const dur = durationText(v.start, v.end);
  return (
    <aside className="drawer" data-testid="drawer" aria-label={`${m.name} details`}>
      <header>
        <div>
          <h2>{m.name} <span className="pl-sponsor" style={{ color: SPONSOR_COLOR[m.sponsor] }}>{m.sponsor}</span></h2>
          <p className="muted">{m.role}</p>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <p className="drawer-state">
        <span className="state-pill" style={{ background: STATE_COLOR[v.state] }}>{v.state}</span>
        <span>order #{String(data.order.id)}</span>
        {v.start && <span className="muted">{clock(v.start)}{v.end ? ` → ${clock(v.end)}` : ''}</span>}
        {dur && <span className="muted">({dur})</span>}
      </p>
      {!DECISION_ROLES.has(id) && (v.detail || v.caption) && <p className="drawer-cap">{v.detail || v.caption}</p>}
      <Body id={id} d={data} v={v} />
    </aside>
  );
}

function Body({ id, d, v }: { id: StationId; d: SceneData; v: StationView }) {
  const o = d.order;

  switch (id) {
    case 'customer': {
      const params = payloadObj(o.params);
      return (
        <>
          <Section title="Request"><p className="big">{o.requestText || <i className="muted">(no request text)</i>}</p></Section>
          <dl className="decisions">
            <dt>Customer</dt><dd title={d.customer?.asiSender}>{d.customer ? short(d.customer.asiSender, 14, 6) : `#${o.customerId}`}</dd>
            <dt>Order ref</dt><dd>{o.ref}</dd>
            <dt>Price</dt><dd>{usd(o.priceCents)} <span className="badge test">TEST MODE</span></dd>
            <dt>API</dt><dd>{d.api?.name ?? '—'}</dd>
            {Object.keys(params).length > 0 && <><dt>Params</dt><dd><code>{JSON.stringify(params)}</code></dd></>}
            <dt>Created</dt><dd>{clock(o.createdAt)}</dd>
            {d.isCanary && <><dt>Source</dt><dd><span className="badge canary">canary</span> scripted order</dd></>}
          </dl>
        </>
      );
    }
    case 'desk':
      return (
        <>
          <Section title="Instant gate checks (layer 2)"><GateTable gates={d.gates.filter((g) => DESK_CHECKS.has(g.check))} /></Section>
          <dl className="decisions">
            <dt>Quote</dt><dd>{usd(o.priceCents)} <span className="badge test">TEST MODE</span></dd>
            <dt>Payment</dt><dd>{o.stripeSessionId.startsWith('demo-simulated:') ? 'SIMULATED PAYMENT · TEST MODE · no money charged' : o.stripeSessionId ? `Test payment ${short(o.stripeSessionId, 10, 4)}` : d.orderEvents.some((e) => e.kind === 'order_paid') ? 'recorded' : 'not paid'}</dd>
          </dl>
        </>
      );
    case 'coo':
      return <CooCard d={d} v={v} />;
    case 'research':
      return <ResearchCard d={d} v={v} />;
    case 'apify': {
      const apify = d.runs.filter((r) => r.provider === 'apify');
      return (
        <>
          <dl className="decisions">
            <dt>API</dt><dd>{d.api ? <><b>{d.api.name}</b> <span className={`badge tier${d.api.tier}`}>Tier {d.api.tier}</span></> : '—'}</dd>
            <dt>Engine</dt><dd>{d.apiVersion ? `${d.apiVersion.version} · ${d.apiVersion.engine} ${d.apiVersion.apifyId}` : '—'}</dd>
            <dt>Dataset</dt><dd>{o.datasetUrl ? <a href={o.datasetUrl} target="_blank" rel="noreferrer">Apify dataset JSON</a> : <span className="muted">not yet</span>}</dd>
          </dl>
          <Section title="Apify runs"><RunsTable runs={apify} /></Section>
          <Section title={<>Values extracted ({d.values.length}) <CountBadges values={d.values} /></>}><ValuesTable values={d.values} /></Section>
        </>
      );
    }
    case 'verify': {
      const ev = verifyEvidence(d);
      return (
        <>
          <Section title={<>Values ({d.values.length}) <CountBadges values={d.values} /></>}><ValuesTable values={d.values} /></Section>
          <Section title={`Bright Data fetches for verification (${ev.length})`}><EvidenceTable evidence={ev} /></Section>
          {d.evidence.length > ev.length && <Section title={`Later rechecks (${d.evidence.length - ev.length})`}><EvidenceTable evidence={d.evidence.filter((x) => !ev.includes(x))} /></Section>}
        </>
      );
    }
    case 'auditor':
      return <AuditorCard d={d} v={v} />;
    case 'delivered':
      return (
        <>
          <dl className="decisions">
            <dt>Status</dt><dd><span className={`status s-${o.status}`}>{o.status}</span></dd>
            <dt>Dataset</dt><dd>{o.datasetUrl ? <a href={o.datasetUrl} target="_blank" rel="noreferrer">Apify dataset JSON</a> : <span className="muted">none</span>}</dd>
          </dl>
          <Section title={`Challenges (${d.challenges.length})`}><ChallengesTable challenges={d.challenges} /></Section>
          <Section title={<>Delivered values ({d.values.length}) <CountBadges values={d.values} /></>}><ValuesTable values={d.values} /></Section>
        </>
      );
    case 'cfo':
      return <CfoCard d={d} />;
    case 'droid': {
      const ts = d.allTasks.filter((t) => t.role === 'droid_runner' && ['compile', 'enhancement', 'warranty'].includes(t.kind)).sort(byIdAsc);
      const tk = d.tickets.filter((t) => ['compile', 'warranty', 'enhancement'].includes(t.label)).sort(byIdAsc);
      return (
        <>
          <Section title={`Engineering tasks (${ts.length})`}>
            {ts.length ? <table><thead><tr><th>task</th><th>kind</th><th>status</th><th>attempt</th></tr></thead>
              <tbody>{ts.map((t) => <tr key={String(t.id)}><td>#{String(t.id)}</td><td>{t.kind}</td><td>{t.status}</td><td>{t.attempt}</td></tr>)}</tbody></table> : <p className="muted">No compile, enhancement or warranty task yet. No engineering queued.</p>}
          </Section>
          <Section title={`Tickets (${tk.length})`}>
            {tk.length ? <table><thead><tr><th>ticket</th><th>label</th><th>status</th><th>text</th></tr></thead>
              <tbody>{tk.map((t) => <tr key={String(t.id)}><td>#{String(t.id)}</td><td>{t.label}</td><td>{t.status}</td><td>{t.text}</td></tr>)}</tbody></table> : <p className="muted">None.</p>}
          </Section>
        </>
      );
    }
    case 'treasurer': {
      const cost = d.runCosts.reduce((s, r) => s + r.totalMicros, 0n);
      return (
        <>
          <p><span className="badge test">TEST MODE</span></p>
          <dl className="decisions">
            <dt>Customer account</dt><dd>{d.books.length ? d.books.map((b) => `${b.account} ${usd(b.balanceCents)}`).join(', ') : '—'}</dd>
            <dt>Vendor cost</dt><dd>{d.runCosts.length ? microsUsd(cost) : '—'}</dd>
          </dl>
          <Section title="Run cost breakdown">
            {d.runCosts.length ? <table><thead><tr><th>run</th><th>Apify</th><th>LLM</th><th>Bright Data</th><th>total</th><th>final</th></tr></thead>
              <tbody>{d.runCosts.map((r) => <tr key={String(r.runId)}><td>#{String(r.runId)}</td><td>{microsUsd(r.apifyMicros)}</td><td>{microsUsd(r.llmMicros)}</td><td>{microsUsd(r.brightdataMicros)}</td><td><b>{microsUsd(r.totalMicros)}</b></td><td>{r.finalized ? 'yes' : 'preliminary'}</td></tr>)}</tbody></table> : <p className="muted">None booked.</p>}
          </Section>
          <Section title={`Bonuses (${d.bonuses.length})`}>
            {d.bonuses.length ? <table><thead><tr><th>role</th><th>amount</th><th>status</th></tr></thead>
              <tbody>{d.bonuses.map((b) => <tr key={String(b.id)}><td>{b.role}</td><td>{usd(b.amountCents)}</td><td>{b.status}</td></tr>)}</tbody></table> : <p className="muted">None (bonuses accrue only on accepted work).</p>}
          </Section>
        </>
      );
    }
  }
}

const DECISION_ROLES = new Set<StationId>(['coo', 'research', 'cfo', 'auditor']);
const COO_KINDS = new Set(['coo_accepted', 'coo_rejected', 'coo_counteroffered', 'coo_requested_research']);
const AUDIT_KINDS = new Set(['audit_accepted', 'audit_rejected']);
const VERDICT: Record<string, string> = {
  coo_accepted: 'Accepted', coo_rejected: 'Rejected', coo_counteroffered: 'Counteroffered', coo_requested_research: 'Requested research',
  research_reported: 'Report filed', audit_accepted: 'Accepted', audit_rejected: 'Rejected', audit_skipped_canary: 'Skipped',
};

const text = (v: unknown) => (typeof v === 'string' ? v : '');

// The CREAO run behind a decision: the newest run of that role's task for the same order or ticket that started before the event.
function runOf(e: Event, role: string, runs: readonly Run[], tasks: readonly Task[]): { run?: Run; task?: Task } {
  const orderId = e.refType === 'order' ? e.refId : undefined;
  const ticketId = e.refType === 'ticket' ? e.refId : undefined;
  let best: { run?: Run; task?: Task } = {};
  for (const r of runs) {
    if (r.provider !== 'creao' || r.taskId === undefined) continue;
    const t = tasks.find((x) => x.id === r.taskId);
    if (!t || t.role !== role) continue;
    if (!((orderId !== undefined && t.orderId === orderId) || (ticketId !== undefined && t.ticketId === ticketId))) continue;
    if (micros(r.startedAt) > micros(e.at)) continue;
    if (!best.run || micros(r.startedAt) > micros(best.run.startedAt)) best = { run: r, task: t };
  }
  return best;
}

function RunButton({ run }: { run?: Run }) {
  const link = runLink(run);
  if ('href' in link) return <a className="run-btn" href={link.href} target="_blank" rel="noreferrer">{run?.shareUrl ? 'Open CREAO run ↗' : link.label}</a>;
  return <span className="muted">{'none' in link ? link.none : 'no run link recorded'}</span>;
}

type Card = {
  role: 'coo' | 'research' | 'cfo' | 'auditor';
  verdict: string;
  decision: ReactNode;
  reason?: string;
  noReason?: string;
  evidence: ReactNode;
  next: string;
  event?: Event;
  earlier?: Event[];
  note?: string;
};

function DecisionCard({ card, data }: { card: Card; data: SceneData }) {
  const [runs] = useTable(tables.run);
  const role = card.role;
  const actor: ActorKey = role;
  const { run, task } = card.event ? runOf(card.event, role, runs, data.allTasks) : {};
  const pendingTask = !card.event
    ? data.tasks.filter((t) => t.role === role).sort(byIdAsc).at(-1)
    : undefined;
  return (
    <article className="decision-card" data-testid={`decision-${role}`}>
      <h3 className="decision-title"><Avatar actor={actor} /> {ROLE_META[actor].label} · {card.verdict}</h3>
      {card.note && <p className="muted">{card.note}</p>}
      <dl className="decisions">
        <dt>Decision</dt><dd>{card.decision}</dd>
        <dt>Reason</dt><dd>{card.reason ? <q className="verbatim">{card.reason}</q> : <span className="muted">{card.noReason ?? 'none recorded'}</span>}</dd>
        <dt>Evidence</dt><dd>{card.evidence}</dd>
        <dt>Next</dt><dd>{card.next}</dd>
      </dl>
      <p className="decision-run">{card.event ? <RunButton run={run} /> : <span className="muted">no run link recorded</span>}</p>
      <p className="decision-foot muted">
        {card.event
          ? task
            ? <>task #{String(task.id)} · attempt {task.attempt}{run && run.endedAt ? ` · ${durationText(run.startedAt, run.endedAt)}` : ''} · decided {clock(card.event.at)}</>
            : <>decided {clock(card.event.at)} · no CREAO task recorded</>
          : pendingTask
            ? <>task #{String(pendingTask.id)} · attempt {pendingTask.attempt} · {pendingTask.status}</>
            : 'no task yet'}
      </p>
      {card.earlier && card.earlier.length > 0 && (
        <details className="decision-earlier">
          <summary>Earlier decision{card.earlier.length === 1 ? '' : 's'} ({card.earlier.length})</summary>
          {card.earlier.map((e) => (
            <div key={String(e.id)} className="decision-prev">
              <b>{VERDICT[e.kind] ?? e.kind}</b> <span className="muted">{clock(e.at)}</span>{' '}
              <RunButton run={runOf(e, role, runs, data.allTasks).run} />
              {text(payloadObj(e.payload).reason) && <p><q className="verbatim">{text(payloadObj(e.payload).reason)}</q></p>}
            </div>
          ))}
        </details>
      )}
    </article>
  );
}

function CooCard({ d, v }: { d: SceneData; v: StationView }) {
  const [apis] = useTable(tables.api);
  const [versions] = useTable(tables.apiVersion);
  const decided = d.orderEvents.filter((e) => COO_KINDS.has(e.kind));
  const e = decided.at(-1);
  if (!e) return <DecisionCard data={d} card={{ role: 'coo', verdict: 'Pending', decision: v.caption || 'No decision recorded yet', evidence: '—', next: 'Decided after the COO run' }} />;
  const p = payloadObj(e.payload);
  const apiName = text(p.api);
  const api = apiName ? apis.find((a) => a.name === apiName) : undefined;
  // The order's own version is what the COO matched; the API's current version may have shipped later.
  const version = api && d.api?.id === api.id && d.apiVersion ? d.apiVersion : api ? versions.find((x) => x.id === api.currentVersionId) : undefined;
  const isNew = api !== undefined && micros(api.createdAt) >= micros(d.order.createdAt);
  const decision = e.kind === 'coo_accepted'
    ? isNew ? `Create a new ${apiName} API and run it` : `Use the existing ${apiName || 'catalog'} API`
    : e.kind === 'coo_rejected' ? 'Reject the order'
      : e.kind === 'coo_counteroffered' ? 'Send the customer a counteroffer'
        : 'Send the request to Research before deciding';
  const evidence = api
    ? <><b>{api.name}</b> <span className={`badge tier${version?.tier ?? api.tier}`}>Tier {version?.tier ?? api.tier}</span>{version ? ` v${version.version} · ${version.engine}` : ''}{isNew ? ' · created for this order' : ' · from the catalog'}</>
    : apiName ? <>{apiName} <span className="muted">(not in the catalog)</span></> : <span className="muted">no catalog API named in the decision</span>;
  const next = e.kind === 'coo_accepted' ? 'Warehouse (Apify runs the API)'
    : e.kind === 'coo_requested_research' ? 'Research'
      : e.kind === 'coo_rejected' ? 'Customer (cited rejection in chat)' : 'Customer (counteroffer in chat)';
  return <DecisionCard data={d} card={{ role: 'coo', verdict: VERDICT[e.kind], decision, reason: text(p.reason), evidence, next, event: e, earlier: decided.slice(0, -1).reverse() }} />;
}

function ResearchCard({ d, v }: { d: SceneData; v: StationView }) {
  const gates = d.gates.filter((g) => !DESK_CHECKS.has(g.check));
  const reports = d.orderEvents.filter((e) => e.kind === 'research_reported');
  const e = reports.at(-1);
  const table = <GateTable gates={gates} />;
  if (!e) {
    const skipped = v.state === 'skipped';
    return <DecisionCard data={d} card={{
      role: 'research', verdict: skipped ? 'Not needed' : 'Pending',
      decision: skipped ? 'The COO matched an existing API, so no research was requested' : v.caption || 'No report filed yet',
      evidence: table, next: skipped ? '—' : 'COO (decides on the findings)',
    }} />;
  }
  const p = payloadObj(e.payload);
  const checks = p.checks && typeof p.checks === 'object' ? Object.entries(p.checks as Record<string, { result?: string }>) : [];
  const vol = text(p.volatility);
  const decision = `${checks.map(([k, c]) => `${k.replace(/_/g, ' ')} ${c?.result ?? '?'}`).join(', ') || 'no checks listed'}${vol ? `; volatility ${vol}` : ''}`;
  return <DecisionCard data={d} card={{
    role: 'research', verdict: VERDICT[e.kind], decision, reason: text(p.reason),
    noReason: 'the report stores one citation per check instead of a single reason (table below)',
    evidence: table, next: 'COO (decides on the findings)', event: e, earlier: reports.slice(0, -1).reverse(),
  }} />;
}

function AuditorCard({ d, v }: { d: SceneData; v: StationView }) {
  const verdicts = d.orderEvents.filter((e) => AUDIT_KINDS.has(e.kind));
  const e = verdicts.at(-1);
  const skipped = d.orderEvents.find((x) => x.kind === 'audit_skipped_canary');
  const checked = d.values.filter((x) => x.status !== 'extracted');
  const verified = d.values.filter((x) => x.status === 'verified').length;
  const evidence = d.values.length
    ? <>
        <b>{verified}/{checked.length || d.values.length}</b> verified <CountBadges values={d.values.filter((x) => x.status !== 'verified')} />
        <details className="decision-values"><summary>Values table ({d.values.length})</summary><ValuesTable values={d.values} /></details>
      </>
    : <span className="muted">no values extracted</span>;
  if (!e) {
    return <DecisionCard data={d} card={{
      role: 'auditor', verdict: skipped ? VERDICT.audit_skipped_canary : 'Pending',
      decision: skipped ? 'Canary order: the audit is skipped' : v.caption || 'No verdict recorded yet',
      evidence, next: skipped ? 'Delivered' : 'Decided after the Auditor run', event: undefined,
    }} />;
  }
  const ok = e.kind === 'audit_accepted';
  return <DecisionCard data={d} card={{
    role: 'auditor', verdict: VERDICT[e.kind], decision: ok ? 'Deliver the data to the customer' : 'Do not deliver the data',
    reason: text(payloadObj(e.payload).reason), evidence,
    next: ok ? 'Delivered (data in chat)' : 'None: the order closes as Audit rejected', event: e, earlier: verdicts.slice(0, -1).reverse(),
  }} />;
}

function CfoCard({ d }: { d: SceneData }) {
  const [events] = useTable(tables.event);
  const [jobs] = useTable(tables.compileJob);
  const [apis] = useTable(tables.api);
  const [retired] = useTable(tables.apiRetired);
  const gone = new Set(retired.map((r) => r.apiId));
  const jobOf = (e: Event) => jobs.find((j) => j.ticketId === e.refId);
  const proposals = events
    .filter((e) => e.kind === 'cfo_proposed' && e.refType === 'ticket')
    .filter((e) => { const j = jobOf(e); return j !== undefined && !gone.has(j.apiId); })
    .sort(byIdAsc);
  const mine = d.api ? proposals.filter((e) => jobOf(e)?.apiId === d.api!.id) : [];
  const e = (mine.length ? mine : proposals).at(-1);
  const b = d.budget;
  const budgetLine = b
    ? <>cap {usd(b.capCents)} · reserved {usd(b.reservedCents)} · spent {usd(b.spentCents)} <span className="badge test">TEST MODE</span></>
    : <span className="muted">no budget row</span>;
  if (!e) return <DecisionCard data={d} card={{ role: 'cfo', verdict: 'Pending', decision: 'No CFO decision on a live API yet', evidence: budgetLine, next: '—' }} />;
  const job = jobOf(e)!;
  const p = payloadObj(e.payload);
  const api = apis.find((a) => a.id === job.apiId)?.name ?? text(p.api);
  const decisionWord = text(p.decision) || job.decision;
  const amount = typeof p.amountCents === 'number' ? p.amountCents : job.amountCents;
  const trig = payloadObj(job.triggerDetail);
  const note = !mine.length && d.api ? `The CFO has not reviewed ${d.api.name}; this is its latest decision on a live API.` : undefined;
  return <DecisionCard data={d} card={{
    role: 'cfo', verdict: `Proposed ${decisionWord.toLowerCase() || 'a decision'}`,
    decision: decisionWord === 'COMPILE'
      ? <>Invest {usd(amount)} <span className="badge test">TEST MODE</span> to build a dedicated extractor for <b>{api}</b> (compile ticket #{String(job.ticketId)})</>
      : <>{decisionWord} for <b>{api}</b> (ticket #{String(job.ticketId)})</>,
    reason: text(p.rationale) || job.rationale,
    evidence: <>
      {trig.buyers !== undefined && <div>{String(trig.buyers)} distinct buyers (threshold {String(trig.minBuyers ?? '?')})</div>}
      <div>Tier 0 cost per call before: {microsUsd(job.costBeforeMicros)} <span className="badge test">TEST MODE</span></div>
      <div>Engineering budget now: {budgetLine}</div>
    </>,
    next: decisionWord === 'COMPILE' ? 'Treasurer reserves the budget, then Droid builds' : '—',
    event: e, note,
  }} />;
}
