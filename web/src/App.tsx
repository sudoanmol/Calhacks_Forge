import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { usd } from './format';
import { TERMINAL } from './flow';
import { OfficeTab } from './Office';
import { microsUsd } from './scene';
import { ApisTab } from './Apis';
import { EventsPanel } from './Events';

const TABS = ['Office', 'APIs'] as const;
type Tab = (typeof TABS)[number];
const CHECKED = new Set(['verified', 'stale', 'mismatch', 'unverifiable', 'corrected']);

function Stats({ db }: { db: string }) {
  const conn = useSpacetimeDB();
  const [books] = useTable(tables.books);
  const [budget] = useTable(tables.budget);
  const [values] = useTable(tables.valueRecord);
  const [orders] = useTable(tables.orders);
  const [apiCosts] = useTable(tables.apiCost);
  const [retired] = useTable(tables.apiRetired);

  // Payments debit customer:<orderId>, so the sum of those balances is revenue received.
  const revenue = -books.filter((b) => b.account.startsWith('customer:')).reduce((s, b) => s + b.balanceCents, 0n);
  const treasury = books.find((b) => b.account === 'treasury')?.balanceCents ?? 0n;
  const eng = budget.find((b) => b.name === 'engineering');
  const checked = values.filter((v) => CHECKED.has(v.status));
  const verified = checked.filter((v) => v.status === 'verified').length;
  const openOrders = orders.filter((o) => !TERMINAL.has(o.status)).length;
  const gone = new Set(retired.map((r) => r.apiId));
  const perCall = apiCosts.filter((c) => c.runs > 0 && !gone.has(c.apiId)).map((c) => c.costPerCallMicros);
  const lo = perCall.reduce<bigint | undefined>((m, x) => (m === undefined || x < m ? x : m), undefined);
  const hi = perCall.reduce<bigint | undefined>((m, x) => (m === undefined || x > m ? x : m), undefined);
  const connText = conn.isActive ? 'connected' : conn.connectionError ? `error: ${conn.connectionError.message}` : 'connecting…';

  return (
    <header className="stats" data-testid="stats">
      <span className="badge test">TEST MODE</span>
      <span className="stat"><small>revenue</small><b>{usd(revenue)}</b></span>
      <span className="stat"><small>treasury</small><b>{usd(treasury)}</b></span>
      <span className="stat"><small>eng budget cap / reserved / spent</small><b>{eng ? `${usd(eng.capCents)} / ${usd(eng.reservedCents)} / ${usd(eng.spentCents)}` : '—'}</b></span>
      <span className="stat"><small>verified</small><b>{checked.length ? `${Math.round((verified / checked.length) * 100)}%` : '—'}</b><small>{verified}/{checked.length}</small></span>
      <span className="stat"><small>cost / call</small><b>{lo === undefined ? '—' : lo === hi ? microsUsd(lo) : `${microsUsd(lo)}–${microsUsd(hi!)}`}</b></span>
      <span className="stat"><small>open orders</small><b data-testid="open-orders">{openOrders}</b></span>
      <span className="right">
        <span className={`conn ${conn.isActive ? 'ok' : 'bad'}`} data-testid="conn">{connText}</span>
        <span className="muted">db {db}</span>
        <span className="muted" title={conn.identity?.toHexString()}>{conn.identity ? `you ${conn.identity.toHexString().slice(0, 8)}…` : ''}</span>
        <span className="badge live">LIVE</span>
      </span>
    </header>
  );
}

export function App({ db }: { db: string }) {
  const [tab, setTab] = useState<Tab>('Office');
  return (
    <div className="app">
      <Stats db={db} />
      <main>
        <section className="panel mainpanel">
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
            ))}
          </nav>
          {tab === 'Office' ? <OfficeTab /> : <ApisTab />}
        </section>
        <EventsPanel />
      </main>
    </div>
  );
}
