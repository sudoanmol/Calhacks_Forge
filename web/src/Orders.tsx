import { useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Event, Orders as Order } from './module_bindings/types';
import { byIdAsc, byIdDesc, clock, payloadObj, short, usd } from './format';
import { STEPS, track } from './flow';

export function OrdersTab() {
  const [orders, ready] = useTable(tables.orders);
  const [events] = useTable(tables.event);
  const [customers] = useTable(tables.customer);
  const [apis] = useTable(tables.api);
  const [open, setOpen] = useState<bigint | null>(null);

  const eventsByOrder = useMemo(() => {
    const m = new Map<bigint, Event[]>();
    for (const e of [...events].sort(byIdAsc)) {
      if (e.refType !== 'order') continue;
      const l = m.get(e.refId) ?? [];
      l.push(e);
      m.set(e.refId, l);
    }
    return m;
  }, [events]);

  const sorted = useMemo(() => [...orders].sort(byIdDesc), [orders]);
  if (!ready) return <p className="muted">Loading orders…</p>;
  if (!sorted.length) return <p className="muted">No orders yet.</p>;

  return (
    <div className="orders" data-testid="orders">
      {sorted.map((o) => {
        const c = customers.find((x) => x.id === o.customerId);
        const a = o.apiId !== undefined ? apis.find((x) => x.id === o.apiId) : undefined;
        const t = track(o, eventsByOrder.get(o.id) ?? []);
        const isOpen = open === o.id;
        return (
          <article key={String(o.id)} className={`order ${isOpen ? 'open' : ''}`} data-testid={`order-${o.id}`}>
            <button className="order-head" onClick={() => setOpen(isOpen ? null : o.id)} aria-expanded={isOpen}>
              <div className="order-meta">
                <span className="oid">#{String(o.id)}</span>
                <span className="api">{a?.name ?? 'no API yet'}</span>
                <span className="price">{usd(o.priceCents)}</span>
                <span className={`status s-${o.status}`}>{o.status}</span>
                <span className="muted" title={c?.asiSender}>{c ? short(c.asiSender) : `customer ${o.customerId}`}</span>
                <span className="muted ref">{o.ref}</span>
              </div>
              <div className="request">{o.requestText || <i className="muted">(no request text)</i>}</div>
              <ol className="tracker">
                {STEPS.map((s, i) => (
                  <li key={s} className={`step ${t.states[i]}`}>
                    <span className="dot" />
                    <span className="label">{s}</span>
                    <span className="when">{clock(t.times[i])}</span>
                  </li>
                ))}
              </ol>
            </button>
            {isOpen && <OrderDetail order={o} orderEvents={eventsByOrder.get(o.id) ?? []} />}
          </article>
        );
      })}
    </div>
  );
}

function reasonFrom(orderEvents: Event[], prefix: string): { reason: string; kind: string; at?: Event['at'] } | undefined {
  const e = [...orderEvents].reverse().find((x) => x.kind.startsWith(prefix));
  if (!e) return undefined;
  const r = payloadObj(e.payload).reason;
  return { reason: typeof r === 'string' ? r : '', kind: e.kind, at: e.at };
}

function OrderDetail({ order, orderEvents }: { order: Order; orderEvents: Event[] }) {
  const [gates] = useTable(tables.gateCheck);
  const [values] = useTable(tables.valueRecord);
  const [evidence] = useTable(tables.evidence);
  const [runs] = useTable(tables.run);
  const [tasks] = useTable(tables.task);
  const [challenges] = useTable(tables.challenge);

  const g = gates.filter((x) => x.orderId === order.id).sort(byIdAsc);
  const v = values.filter((x) => x.orderId === order.id).sort((a, b) => a.row - b.row || (a.id < b.id ? -1 : 1));
  const ev = evidence.filter((x) => x.orderId === order.id).sort(byIdAsc);
  const ch = challenges.filter((x) => x.orderId === order.id).sort(byIdAsc);
  const taskIds = new Set(tasks.filter((x) => x.orderId === order.id).map((x) => x.id));
  const r = runs
    .filter((x) => (x.provider === 'apify' && x.threadId === String(order.id)) || (x.taskId !== undefined && taskIds.has(x.taskId)))
    .sort(byIdAsc);
  const coo = reasonFrom(orderEvents, 'coo_');
  const audit = reasonFrom(orderEvents, 'audit_');
  const deskReject = reasonFrom(orderEvents, 'order_rejected_at_desk');
  const failed = reasonFrom(orderEvents, 'order_failed');
  const counts = v.reduce<Record<string, number>>((m, x) => ((m[x.status] = (m[x.status] ?? 0) + 1), m), {});

  return (
    <div className="detail">
      <section>
        <h3>Decisions</h3>
        <dl className="decisions">
          {deskReject && <><dt>Front Desk</dt><dd><b className="bad">rejected at desk</b> {deskReject.reason}</dd></>}
          <dt>COO</dt><dd>{coo ? <><b>{coo.kind.replace('coo_', '')}</b> {coo.reason} <span className="muted">{clock(coo.at)}</span></> : <span className="muted">pending</span>}</dd>
          <dt>Auditor</dt><dd>{audit ? <><b>{audit.kind.replace('audit_', '')}</b> {audit.reason} <span className="muted">{clock(audit.at)}</span></> : <span className="muted">pending</span>}</dd>
          {failed && <><dt>Failure</dt><dd className="bad">{failed.reason}</dd></>}
          {order.datasetUrl && <><dt>Dataset</dt><dd><a href={order.datasetUrl} target="_blank" rel="noreferrer">Apify dataset JSON</a></dd></>}
        </dl>
      </section>

      <section>
        <h3>Gate checks ({g.length})</h3>
        {g.length ? (
          <table><thead><tr><th>check</th><th>result</th><th>citation</th><th>at</th></tr></thead>
            <tbody>{g.map((x) => (
              <tr key={String(x.id)}>
                <td>{x.check}</td><td><span className={`badge r-${x.result}`}>{x.result}</span></td>
                <td>{x.citationUrl ? <a href={x.citationUrl} target="_blank" rel="noreferrer">{x.citationText || x.citationUrl}</a> : x.citationText}</td>
                <td className="muted">{clock(x.at)}</td>
              </tr>))}</tbody></table>
        ) : <p className="muted">None.</p>}
      </section>

      <section>
        <h3>Values ({v.length}) {Object.entries(counts).map(([k, n]) => <span key={k} className={`badge v-${k}`}>{n} {k}</span>)}</h3>
        {v.length ? (
          <div className="scroll"><table className="values" data-testid="values"><thead><tr><th>row</th><th>entity</th><th>metric</th><th>value</th><th>excerpt</th><th>source</th><th>status</th></tr></thead>
            <tbody>{v.map((x) => (
              <tr key={String(x.id)}>
                <td>{x.row}</td><td>{x.entity}</td><td>{x.metric}</td><td className="val">{x.value}</td>
                <td className="excerpt">“{x.excerpt}”</td>
                <td>{x.sourceUrl ? <a href={x.sourceUrl} target="_blank" rel="noreferrer">{short(x.sourceUrl.replace(/^https?:\/\//, ''), 24, 8)}</a> : ''}</td>
                <td><span className={`badge v-${x.status}`}>{x.status}</span>{x.freshValue && <div className="muted">fresh: {x.freshValue}</div>}</td>
              </tr>))}</tbody></table></div>
        ) : <p className="muted">None yet.</p>}
      </section>

      <section>
        <h3>Bright Data evidence ({ev.length})</h3>
        {ev.length ? (
          <table><thead><tr><th>#</th><th>method</th><th>country</th><th>http</th><th>ms</th><th>url</th><th>reason</th><th>at</th></tr></thead>
            <tbody>{ev.map((x) => (
              <tr key={String(x.id)}>
                <td>{x.attempt}</td><td>{x.method}</td><td>{x.country}</td>
                <td><span className={`badge ${x.httpStatus === 200 && !x.reason ? 'v-verified' : 'v-mismatch'}`}>{x.httpStatus || '—'}</span></td>
                <td>{x.ms}</td><td>{short(x.url.replace(/^https?:\/\//, ''), 28, 8)}</td>
                <td>{x.reason || <span className="muted">ok</span>}</td><td className="muted">{clock(x.fetchedAt)}</td>
              </tr>))}</tbody></table>
        ) : <p className="muted">None yet.</p>}
      </section>

      <section>
        <h3>Runs ({r.length})</h3>
        {r.length ? (
          <table><thead><tr><th>provider</th><th>status</th><th>link</th><th>cost</th><th>started</th><th>ended</th></tr></thead>
            <tbody>{r.map((x) => (
              <tr key={String(x.id)}>
                <td>{x.provider}</td><td>{x.status}</td>
                <td>{x.shareUrl ? <a href={x.shareUrl} target="_blank" rel="noreferrer">{x.externalId || 'open'}</a> : <span className="muted">{x.externalId || 'no link'}</span>}</td>
                <td>{usd(x.costCents)}</td><td className="muted">{clock(x.startedAt)}</td><td className="muted">{clock(x.endedAt)}</td>
              </tr>))}</tbody></table>
        ) : <p className="muted">None yet.</p>}
      </section>

      {ch.length > 0 && (
        <section>
          <h3>Challenges ({ch.length})</h3>
          <table><thead><tr><th>value</th><th>reason</th><th>status</th><th>auditor</th></tr></thead>
            <tbody>{ch.map((x) => (
              <tr key={String(x.id)}><td>#{String(x.valueRecordId)}</td><td>{x.reason}</td><td>{x.status}</td><td>{x.auditorReason}</td></tr>))}</tbody></table>
        </section>
      )}
    </div>
  );
}
