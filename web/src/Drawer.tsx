import { useEffect } from 'react';
import { STATION_META, durationText, verifyEvidence, microsUsd, DESK_CHECKS, type Scene, type SceneData, type StationId } from './scene';
import { SPONSOR_COLOR, STATE_COLOR } from './Floor';
import { ChallengesTable, CountBadges, EvidenceTable, GateTable, RunsTable, Section, ValuesTable } from './Detail';
import { byIdAsc, clock, payloadObj, short, usd } from './format';

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
      {id !== 'coo' && id !== 'auditor' && (v.detail || v.caption) && <p className="drawer-cap">{v.detail || v.caption}</p>}
      <Body id={id} d={data} />
    </aside>
  );
}

function Body({ id, d }: { id: StationId; d: SceneData }) {
  const o = d.order;
  const creaoRuns = (role: string) => {
    const ids = new Set(d.tasks.filter((t) => t.role === role).map((t) => t.id));
    return d.runs.filter((r) => r.provider === 'creao' && r.taskId !== undefined && ids.has(r.taskId));
  };
  const tasksOf = (role: string) => d.tasks.filter((t) => t.role === role).sort(byIdAsc);
  const TaskList = ({ role }: { role: string }) => {
    const ts = tasksOf(role);
    return ts.length ? (
      <table><thead><tr><th>task</th><th>kind</th><th>status</th><th>attempt</th><th>updated</th></tr></thead>
        <tbody>{ts.map((t) => <tr key={String(t.id)}><td>#{String(t.id)}</td><td>{t.kind}</td><td>{t.status}</td><td>{t.attempt}</td><td className="muted">{clock(t.updatedAt)}</td></tr>)}</tbody></table>
    ) : <p className="muted">No tasks.</p>;
  };

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
      return (
        <>
          <Section title="Decision"><p><DecisionText d={d} prefix="coo_" /></p></Section>
          <Section title="CREAO runs"><RunsTable runs={creaoRuns('coo')} /></Section>
          <Section title="Tasks"><TaskList role="coo" /></Section>
        </>
      );
    case 'research':
      return (
        <>
          <Section title="Gate findings (layer 3)"><GateTable gates={d.gates.filter((g) => !DESK_CHECKS.has(g.check))} /></Section>
          <Section title="CREAO runs"><RunsTable runs={creaoRuns('research')} /></Section>
          <Section title="Tasks"><TaskList role="research" /></Section>
        </>
      );
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
      return (
        <>
          <Section title="Verdict"><p><DecisionText d={d} prefix="audit_" /></p></Section>
          <Section title="CREAO runs"><RunsTable runs={creaoRuns('auditor')} /></Section>
          <Section title="Tasks"><TaskList role="auditor" /></Section>
        </>
      );
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
    case 'cfo': {
      const b = d.budget;
      const pending = d.approvals.filter((a) => a.status === 'pending');
      return (
        <>
          <dl className="decisions">
            <dt>Engineering cap</dt><dd>{b ? usd(b.capCents) : '—'} <span className="badge test">TEST MODE</span></dd>
            <dt>Reserved</dt><dd>{b ? usd(b.reservedCents) : '—'}</dd>
            <dt>Spent</dt><dd>{b ? usd(b.spentCents) : '—'}</dd>
          </dl>
          <Section title={`Pending approvals (${pending.length})`}>
            {pending.length ? <table><thead><tr><th>kind</th><th>ref</th><th>amount</th><th>detail</th></tr></thead>
              <tbody>{pending.map((a) => <tr key={String(a.id)}><td>{a.kind}</td><td>{a.refType} #{String(a.refId)}</td><td>{usd(a.amountCents)}</td><td>{a.detail}</td></tr>)}</tbody></table> : <p className="muted">None.</p>}
          </Section>
        </>
      );
    }
    case 'droid': {
      const ts = d.allTasks.filter((t) => t.role === 'droid_runner' && ['compile', 'enhancement', 'warranty'].includes(t.kind)).sort(byIdAsc);
      const tk = d.tickets.filter((t) => ['compile', 'warranty', 'enhancement'].includes(t.label)).sort(byIdAsc);
      return (
        <>
          <Section title={`Engineering tasks (${ts.length})`}>
            {ts.length ? <table><thead><tr><th>task</th><th>kind</th><th>status</th><th>attempt</th></tr></thead>
              <tbody>{ts.map((t) => <tr key={String(t.id)}><td>#{String(t.id)}</td><td>{t.kind}</td><td>{t.status}</td><td>{t.attempt}</td></tr>)}</tbody></table> : <p className="muted">No compile, enhancement or warranty task yet. Droid is sleeping.</p>}
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

function DecisionText({ d, prefix }: { d: SceneData; prefix: string }) {
  const e = [...d.orderEvents].reverse().find((x) => x.kind.startsWith(prefix));
  if (!e) return <span className="muted">pending</span>;
  const r = payloadObj(e.payload).reason;
  return <><b>{e.kind.replace(prefix, '').toUpperCase()}</b> {typeof r === 'string' ? r : ''} <span className="muted">{clock(e.at)}</span></>;
}
