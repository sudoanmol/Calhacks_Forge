import { useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import { clock, micros, payloadObj, usd } from './format';
import { microsUsd } from './scene';

export function EngineeringTab({ founder }: { founder: boolean }) {
  const [jobs] = useTable(tables.compileJob);
  const [apis] = useTable(tables.api);
  const [retired] = useTable(tables.apiRetired);
  const [events] = useTable(tables.event);
  const [tasks] = useTable(tables.task);
  const [runs] = useTable(tables.run);
  const [selected, setSelected] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const close = useReducer(reducers.closeCompile);
  const hidden = new Set(retired.map((r) => r.apiId));
  const visible = jobs.filter((j) => showRetired || !hidden.has(j.apiId)).sort((a, b) => a.ticketId > b.ticketId ? -1 : 1);
  const job = visible.find((j) => String(j.ticketId) === selected) ?? visible[0];
  const api = apis.find((a) => a.id === job?.apiId);
  const relatedTasks = tasks.filter((t) => t.ticketId === job?.ticketId);
  const taskIds = new Set(relatedTasks.map((t) => t.id));
  const history = events.filter((e) => (e.refType === 'ticket' && e.refId === job?.ticketId) || (e.refType === 'task' && taskIds.has(e.refId)))
    .sort((a, b) => micros(a.at) < micros(b.at) ? -1 : a.id < b.id ? -1 : 1);
  const result = payloadObj(job?.testResults ?? '');
  const tests = typeof result.tests === 'object' && result.tests !== null ? Object.entries(result.tests) : [];
  const trace = history.filter((e) => e.kind.startsWith('droid_'));
  return <section className="engineering">
    <h2>Engineering <span className="badge test">TEST MODE</span></h2>
    <label><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired API jobs</label>
    <div className="control-row"><label htmlFor="compile-job">Compile job</label>
      <select id="compile-job" value={job ? String(job.ticketId) : ''} onChange={(e) => setSelected(e.target.value)}>
        {visible.map((j) => <option key={String(j.ticketId)} value={String(j.ticketId)}>#{String(j.ticketId)} · {apis.find((a) => a.id === j.apiId)?.name} · {j.status}</option>)}
      </select>
    </div>
    {!job ? <p className="muted">No compile jobs.</p> : <>
      <h3>{api?.name} · <span className="status">{job.status}</span></h3>
      <p>Trigger: {job.trigger.replaceAll('_', ' ')} · attempt {job.attempt} · investment {usd(job.amountCents)} <span className="badge test">TEST MODE</span></p>
      <p>Cost before compile: {microsUsd(job.costBeforeMicros)} per call. Reserved {usd(job.reservedCents)} · spent {usd(job.spentCents)} <span className="badge test">TEST MODE</span></p>
      <p>{job.rationale || 'Waiting for the CFO decision.'}</p>
      {job.droidSessionId && <p>Session <code>{job.droidSessionId}</code></p>}
      {job.feedback && <section><h3>Auditor feedback</h3><p>{job.feedback}</p></section>}
      {runs.filter((r) => r.taskId !== undefined && taskIds.has(r.taskId)).map((r) => <p key={String(r.id)}>
        {r.provider} · {r.status} · {r.shareUrl ? <a href={r.shareUrl} target="_blank" rel="noreferrer">Shared run</a> : r.threadId ? <a href={`https://agent.creao.ai/chat?threadId=${encodeURIComponent(r.threadId)}`} target="_blank" rel="noreferrer">Open CREAO run</a> : r.externalId}
      </p>)}
      <h3>Version tests</h3>
      {!tests.length && <p className="muted">Fixtures, contract, and live tests have not run yet.</p>}
      {tests.map(([name, test]) => {
        const data = test && typeof test === 'object' ? Object.fromEntries(Object.entries(test)) : {};
        return <details key={name}><summary>{name} · {String(data.status ?? 'pending')}</summary><pre>{String(data.output ?? JSON.stringify(test, null, 2))}</pre></details>;
      })}
      <details><summary>Extractor diff</summary><pre>{typeof result.diff === 'string' && result.diff ? result.diff : 'No diff submitted yet.'}</pre></details>
      <h3>Droid trace</h3>
      {!trace.length && <p className="muted">Droid is sleeping. The worker has not emitted any events for this job.</p>}
      {trace.map((e) => {
        const data = payloadObj(e.payload);
        const outcome = typeof data.outcome === 'string' ? data.outcome : '';
        return <details key={String(e.id)}>
          <summary>{clock(e.at)} · {e.kind.replace(/^droid_/, '').replaceAll('_', ' ')} {outcome && <span className={`badge ${outcome === 'denied' ? 'v-mismatch' : outcome === 'founder-approved' ? 'v-verified' : ''}`}>{outcome}</span>} {typeof data.tool === 'string' ? data.tool : ''}</summary>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </details>;
      })}
      <h3>Job history</h3>
      {history.filter((e) => !e.kind.startsWith('droid_')).map((e) => <details key={String(e.id)}><summary>{clock(e.at)} · {e.kind}</summary><pre>{JSON.stringify(payloadObj(e.payload), null, 2)}</pre></details>)}
      {['awaiting_cfo', 'awaiting_approval', 'queued', 'ineligible', 'auditing', 'rework', 'ship_pending'].includes(job.status) && <form className="control-row" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setMessage('');
        try { await close({ ticketId: job.ticketId, reason }); setMessage('Compile closed. Its remaining reservation was settled.'); setReason(''); }
        catch (err) { setMessage(String(err)); }
        finally { setBusy(false); }
      }}>
        <label htmlFor="close-compile-reason">Reason to close this idle compile</label>
        <input id="close-compile-reason" required value={reason} onChange={(e) => setReason(e.target.value)} disabled={!founder || busy} />
        <button disabled={!founder || busy || !reason.trim()}>Close compile</button>
      </form>}
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}
