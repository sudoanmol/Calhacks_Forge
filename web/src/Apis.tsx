import { useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Api, ApiRetired } from './module_bindings/types';
import { byIdDesc, clock, list, usd } from './format';
import { microsUsd } from './scene';
import { compileStatusSentence, MONEY_STATUSES } from './engText';
import type { Scope } from './scope';

const domain = (s: string) => {
  try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return s; }
};

export function ApisTab({ scope, onEngineering }: { scope: Scope; onEngineering: () => void }) {
  const [apis, ready] = useTable(tables.api);
  const [versions] = useTable(tables.apiVersion);
  const [costs] = useTable(tables.apiCost);
  const [retired] = useTable(tables.apiRetired);
  const [orders] = useTable(tables.orders);
  const [jobs] = useTable(tables.compileJob);
  const [budgets] = useTable(tables.budget);
  const [events] = useTable(tables.event);
  const [showRetired, setShowRetired] = useState(false);
  if (!ready) return <p className="muted">Loading catalog…</p>;

  const gone = new Set(retired.map((r) => r.apiId));
  const live = apis.filter((a) => !gone.has(a.id)).sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
  const budget = budgets.find((b) => b.name === 'engineering');
  const delivered = orders.filter((o) => o.status === 'delivered' && o.datasetUrl && scope.isVisible(o)).sort(byIdDesc);

  return (
    <div className="catalog" data-testid="catalog">
      {!live.length && <p className="muted">No APIs for sale yet.</p>}
      <div className="cards">
        {live.map((a) => {
          const v = a.currentVersionId !== undefined ? versions.find((x) => x.id === a.currentVersionId) : undefined;
          const cost = costs.find((c) => c.apiId === a.id && c.runs > 0);
          const dataset = delivered.find((o) => o.apiId === a.id);
          const job = jobs.filter((j) => j.apiId === a.id).sort((x, y) => (x.ticketId < y.ticketId ? 1 : -1))[0];
          const jobVersion = job?.versionId !== undefined ? versions.find((x) => x.id === job.versionId)?.version : undefined;
          return (
            <article key={String(a.id)} className={`api-card tier${a.tier}`} data-testid={`api-${a.name}`}>
              <header>
                <h3>{a.name}</h3>
                <span className={`badge tier${a.tier}`}>{a.tier >= 1 ? 'Tier 1 · compiled by Droid' : 'Tier 0 · generic extractor'}</span>
              </header>
              <p className="api-desc" title={a.description}>{a.description}</p>
              <p className="muted api-ver">{v ? `v${v.version} · ${v.engine === 'actor' ? 'Actor' : 'Task'}` : 'no version recorded'}</p>
              <dl className="api-stats">
                <div><dt>verified</dt><dd>{(a.verifiedRateBp / 100).toFixed(0)}%</dd></div>
                <div><dt>buyers</dt><dd>{a.buyerCount}</dd></div>
                <div><dt>per call · TEST MODE</dt><dd>{cost ? microsUsd(cost.costPerCallMicros) : usd(a.costPerCallCents)}</dd></div>
                <div><dt>volatility</dt><dd>{a.volatility === 'volatile' && a.freshnessWindowMin ? `volatile · ${a.freshnessWindowMin} min window` : a.volatility}</dd></div>
              </dl>
              <p className="api-srcs">{[...new Set(list(a.sources).map(domain))].join(' · ')}</p>
              <p className="api-fields">{(v ? list(v.fields) : []).map((f) => <span key={f} className="field">{f}</span>)}</p>
              <footer>
                {dataset ? <a href={dataset.datasetUrl} target="_blank" rel="noreferrer">Dataset ↗ <span className="muted">order #{String(dataset.id)}</span></a> : <span className="muted">No delivered dataset in this scope</span>}
                {job && (
                  <button className="linkish" onClick={onEngineering} title="Open the Engineering tab">
                    Engineering: {compileStatusSentence(job, { budget, events, version: jobVersion })}{MONEY_STATUSES.has(job.status) ? ' · TEST MODE' : ''}
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>
      <label className="toggle">
        <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} data-testid="show-retired" /> Show retired ({retired.length})
      </label>
      {showRetired && <RetiredTable rows={[...retired].sort((x, y) => (x.retiredAt.microsSinceUnixEpoch < y.retiredAt.microsSinceUnixEpoch ? 1 : -1))} apis={apis} />}
    </div>
  );
}

function RetiredTable({ rows, apis }: { rows: ApiRetired[]; apis: readonly Api[] }) {
  return (
    <table className="retired" data-testid="retired">
      <thead><tr><th>name</th><th>retired at</th><th>reason</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.apiId)}>
            <td>{r.name || apis.find((a) => a.id === r.apiId)?.name}</td>
            <td>{clock(r.retiredAt)}</td>
            <td>{r.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
