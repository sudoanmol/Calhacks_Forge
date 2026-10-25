import { useSpacetimeDB } from 'spacetimedb/react';
import { useTable } from './db';
import { tables } from './module_bindings';
import { usd } from './format';
import { microsUsd } from './scene';
import type { Scope } from './scope';
import { useDecisionCounts } from './NeedsYou';

const CHECKED = new Set(['verified', 'stale', 'mismatch', 'unverifiable', 'corrected']);

export function Header({ scope, founder, onControls, replaying }: { scope: Scope; founder: boolean; replaying: boolean; onControls: () => void }) {
  const conn = useSpacetimeDB();
  const [books] = useTable(tables.books);
  const [values, heavyReady] = useTable(tables.valueRecord);
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
  const simulatedIds = new Set(visible.filter((o) => o.stripeSessionId.startsWith('demo-simulated:')).map((o) => String(o.id)));
  const simulated = -books.filter((b) => b.account.startsWith('customer:') && simulatedIds.has(b.account.slice(9))).reduce((s, b) => s + b.balanceCents, 0n);
  const checked = values.filter((v) => CHECKED.has(v.status) && visibleIds.has(String(v.orderId)));
  const verified = checked.filter((v) => v.status === 'verified').length;
  const gone = new Set(retired.map((r) => r.apiId));
  const forSale = apis.filter((a) => !gone.has(a.id)).length;
  const perCall = apiCosts.filter((c) => c.runs > 0 && !gone.has(c.apiId)).map((c) => c.costPerCallMicros);
  const lo = perCall.reduce<bigint | undefined>((m, x) => (m === undefined || x < m ? x : m), undefined);
  const hi = perCall.reduce<bigint | undefined>((m, x) => (m === undefined || x > m ? x : m), undefined);
  const pair = useDecisionCounts(scope);
  const pairTitle = `Counted over stored events in scope: ${scope.label}. Counts events, not unique decisions: a rework counts twice (sent back, then accepted).`;
  const connText = conn.isActive ? 'Connected to the live database' : conn.connectionError ? `Connection error: ${conn.connectionError.message}` : 'Connecting…';

  return (
    <header className="stats" data-testid="stats">
      <span className="brand">
        <b>FORGE</b>
        <small>a one-person company</small>
      </span>
      <span className="badge test">TEST MODE</span>
      <span className="stat-row" title={`Scope: ${scope.label}`}>
        <span className="stat" title="Payments minus ledger refunds on the visible orders, including orders still in progress. TEST MODE."><small>revenue · TEST MODE</small><b data-testid="stat-revenue">{usd(revenue)}</b>{simulated > 0n && <em>incl. {usd(simulated)} SIMULATED</em>}</span>
        <span className="stat"><small>verified</small><b>{!heavyReady ? '…' : checked.length ? `${Math.round((verified / checked.length) * 100)}%` : '—'} {heavyReady && <em>{verified}/{checked.length}</em>}</b></span>
        <span className="stat"><small>cost / call · TEST MODE</small><b>{lo === undefined ? '—' : lo === hi ? microsUsd(lo) : `${microsUsd(lo)}–${microsUsd(hi!)}`}</b></span>
        <span className="stat"><small>APIs for sale</small><b data-testid="stat-apis">{forSale}</b></span>
        <span className="stat stat-pair" title={pairTitle} data-testid="stat-pair">
          <small>one-person company</small>
          <span>Agent decisions <b data-testid="stat-decisions">{heavyReady ? pair.decisions : '…'}</b> · Founder approvals <b data-testid="stat-approvals">{heavyReady ? pair.approvals : '…'}</b></span>
        </span>
      </span>
      <span className="right">
        <span className={`conn-dot ${conn.isActive ? 'ok' : 'bad'}`} data-testid="conn" title={connText} aria-label={connText} role="img" />
        <span className={`badge ${!conn.isActive ? 'offline' : replaying ? 'replay' : 'live'}`} data-testid="connection-mode">{!conn.isActive ? 'OFFLINE' : replaying ? 'REPLAY' : 'LIVE'}</span>
        {!founder && <span className="who" data-testid="who" title="This browser is not signed in as the founder, so approvals are read-only">Viewer · read-only</span>}
        <button className="gear" onClick={onControls} aria-label="Company rules" title="Company rules" data-testid="gear">⚙</button>
      </span>
    </header>
  );
}
