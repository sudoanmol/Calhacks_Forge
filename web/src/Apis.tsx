import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { byIdAsc, list, usd } from './format';

export function ApisTab() {
  const [apis, ready] = useTable(tables.api);
  const [versions] = useTable(tables.apiVersion);
  if (!ready) return <p className="muted">Loading catalog…</p>;
  if (!apis.length) return <p className="muted">No APIs yet.</p>;
  return (
    <div className="scroll">
      <table className="apis" data-testid="apis">
        <thead><tr><th>name</th><th>tier</th><th>version</th><th>sources</th><th>fields</th><th>volatility</th><th>verified</th><th>buyers</th><th>cost/call</th></tr></thead>
        <tbody>
          {[...apis].sort(byIdAsc).map((a) => {
            const v = a.currentVersionId !== undefined ? versions.find((x) => x.id === a.currentVersionId) : undefined;
            return (
              <tr key={String(a.id)}>
                <td><b>{a.name}</b><div className="muted">{a.description}</div></td>
                <td><span className={`badge tier${a.tier}`}>Tier {a.tier}</span></td>
                <td>{v ? `${v.version} (${v.engine})` : '—'}</td>
                <td className="srcs">{list(a.sources).map((s) => <div key={s}>{s}</div>)}</td>
                <td>{v ? list(v.fields).join(', ') : ''}</td>
                <td>{a.volatility}{a.volatility === 'volatile' && a.freshnessWindowMin ? ` (${a.freshnessWindowMin} min)` : ''}</td>
                <td>{(a.verifiedRateBp / 100).toFixed(0)}%</td>
                <td>{a.buyerCount}</td>
                <td>{usd(a.costPerCallCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
