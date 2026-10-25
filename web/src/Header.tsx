import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { usd } from './format';
import { microsUsd } from './scene';
import type { Scope } from './scope';

const CHECKED = new Set(['verified', 'stale', 'mismatch', 'unverifiable', 'corrected']);

export function Header({ scope, founder, onControls }: { scope: Scope; founder: boolean; onControls: () => void }) {
  const conn = useSpacetimeDB();
  const [books] = useTable(tables.books);
  const [values] = useTable(tables.valueRecord);
  const [orders] = useTable(tables.orders);
  const [apis] = useTable(tables.api);
  const [apiCosts] = useTable(tables.apiCost);
  const [retired] = useTable(tables.apiRetired);

  const visible = orders.filter(scope.isVisible);
  const visibleIds = new Set(visible.map((o) => String(o.id)));
  // Payments debit customer:<orderId>, so the sum of those balances is revenue received.
  const revenue = -books
    .filter((b) => b.account.startsWith('customer:') && visibleIds.has(b.account.slice('customer:'.length)))
    .reduce((s, b) => s + b.balanceCents, 0n);
  const checked = values.filter((v) => CHECKED.has(v.status) && visibleIds.has(String(v.orderId)));
  const verified = checked.filter((v) => v.status === 'verified').length;
  const gone = new Set(retired.map((r) => r.apiId));
  const forSale = apis.filter((a) => !gone.has(a.id)).length;
  const perCall = apiCosts.filter((c) => c.runs > 0 && !gone.has(c.apiId)).map((c) => c.costPerCallMicros);
  const lo = perCall.reduce<bigint | undefined>((m, x) => (m === undefined || x < m ? x : m), undefined);
  const hi = perCall.reduce<bigint | undefined>((m, x) => (m === undefined || x > m ? x : m), undefined);
  const simulated = visible.some((o) => o.stripeSessionId.startsWith('demo-simulated:'));
  const connText = conn.isActive ? 'Connected to the live database' : conn.connectionError ? `Connection error: ${conn.connectionError.message}` : 'Connecting…';

  return (
    <header className="stats" data-testid="stats">
      <span className="brand">
        <b>FORGE</b>
        <small>a one-person company</small>
      </span>
      <span className="badge test">TEST MODE</span>
      {simulated && <span className="badge test">SIMULATED PAYMENTS</span>}
      <span className="stat-row" title={`Scope: ${scope.label}`}>
        <span className="stat"><small>revenue · TEST MODE</small><b data-testid="stat-revenue">{usd(revenue)}</b></span>
        <span className="stat"><small>verified</small><b>{checked.length ? `${Math.round((verified / checked.length) * 100)}%` : '—'} <em>{verified}/{checked.length}</em></b></span>
        <span className="stat"><small>cost / call · TEST MODE</small><b>{lo === undefined ? '—' : lo === hi ? microsUsd(lo) : `${microsUsd(lo)}–${microsUsd(hi!)}`}</b></span>
        <span className="stat"><small>APIs for sale</small><b data-testid="stat-apis">{forSale}</b></span>
      </span>
      <span className="right">
        <span className={`conn-dot ${conn.isActive ? 'ok' : 'bad'}`} data-testid="conn" title={connText} aria-label={connText} role="img" />
        <span className="badge live">LIVE</span>
        <span className={`who ${founder ? 'founder' : ''}`} data-testid="who">{founder ? 'Founder' : 'Viewer'}</span>
        <button className="gear" onClick={onControls} aria-label="Company rules" title="Company rules" data-testid="gear">⚙</button>
      </span>
    </header>
  );
}
