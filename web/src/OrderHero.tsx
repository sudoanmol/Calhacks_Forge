import { Timestamp } from 'spacetimedb';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Orders as Order } from './module_bindings/types';
import { byIdAsc, parseJson, usd } from './format';
import { TERMINAL } from './flow';
import { durationText } from './scene';
import { useNow } from './Office';
import type { Scope } from './scope';

const CHECKED = new Set(['verified', 'stale', 'mismatch', 'unverifiable', 'corrected']);

export const STATUS_TEXT: Record<string, string> = {
  quoted: 'Quoted, unpaid', paid: 'Paid, waiting for the COO', triaging: 'COO deciding', researching: 'Research checking the source',
  accepted: 'Accepted, starting the extractor', running: 'Extractor running', verifying: 'Bright Data verifying', auditing: 'Auditor reviewing',
  delivered: 'Delivered', rejected: 'Rejected by the COO', rejected_at_desk: 'Rejected at the desk', counteroffered: 'Counteroffer sent',
  audit_rejected: 'Audit rejected', failed: 'Failed',
};
export const statusText = (s: string) => STATUS_TEXT[s] ?? s.replace(/_/g, ' ');

function paramSummary(params: string): string {
  const v = parseJson(params);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== '' && x !== null && x !== undefined);
  const s = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x));
  if (entries.length === 1) return ` for ${s(entries[0][1])}`;
  return entries.slice(0, 2).map(([k, x]) => ` · ${k}: ${s(x)}`).join('');
}

export function OrderHero({ order, scope }: { order: Order; scope: Scope }) {
  const [apis] = useTable(tables.api);
  const [values] = useTable(tables.valueRecord);
  const [customers] = useTable(tables.customer);
  const [events] = useTable(tables.event);
  const now = useNow(1000);
  const api = order.apiId !== undefined ? apis.find((a) => a.id === order.apiId) : undefined;
  const title = api?.name ?? (order.requestText.length > 60 ? `${order.requestText.slice(0, 60)}…` : order.requestText || '(no request text)');
  const checked = values.filter((v) => v.orderId === order.id && CHECKED.has(v.status));
  const verified = checked.filter((v) => v.status === 'verified').length;
  const simulated = order.stripeSessionId.startsWith('demo-simulated:');
  const customer = customers.find((c) => c.id === order.customerId);
  const terminal = TERMINAL.has(order.status);
  const last = terminal ? events.filter((e) => e.refType === 'order' && e.refId === order.id).sort(byIdAsc).at(-1) : undefined;
  const elapsed = terminal
    ? durationText(order.createdAt, last?.at ?? order.updatedAt)
    : durationText(order.createdAt, new Timestamp(BigInt(now) * 1000n));
  const elapsedText = terminal ? elapsed : order.status === 'quoted' ? `quoted ${elapsed} ago` : `running for ${elapsed}`;

  return (
    <section className="hero" data-testid="order-hero" aria-label={`Order ${order.id}`}>
      <h1>
        <span className="hero-id">#{String(order.id)}</span> · {title}{api ? paramSummary(order.params) : ''}
      </h1>
      <div className="hero-chips">
        <span className={`status s-${order.status}`} data-testid="hero-status">{statusText(order.status)}</span>
        {checked.length > 0 && <span className="hero-chip">{verified}/{checked.length} verified</span>}
        <span className="hero-chip">{usd(order.priceCents)} <span className="badge test">TEST MODE</span>{simulated && <> <span className="badge test">SIMULATED PAYMENT</span></>}</span>
        {elapsed && <span className="hero-chip muted">{elapsedText}</span>}
        {customer && <span className="hero-chip muted" title={customer.asiSender}>customer {customer.asiSender.slice(0, 10)}…</span>}
        {!scope.isReal(order) && <span className="badge testtraffic">TEST TRAFFIC</span>}
        {scope.canaryIds.has(order.id) && <span className="badge canary">canary</span>}
      </div>
    </section>
  );
}
