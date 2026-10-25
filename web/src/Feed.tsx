import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'spacetimedb';
import { useTable } from './db';
import { tables } from './module_bindings';
import type { Event, Orders as Order, Run } from './module_bindings/types';
import { byIdDesc, clock, micros, payloadObj } from './format';
import { TERMINAL } from './flow';
import { classOf, describe, groupSentence, type FeedCtx, type FeedLine, type FeedLink } from './feedText';
import { Avatar, ROLE_META } from './Avatar';
import { useEventScope, type Scope } from './scope';
import type { StationId } from './scene';
import { orderAt, orderTimeline } from './replay';

const PAGE = 100;
const GROUPED = new Set(['research_fetched', 'droid_droid_message']);

type Item = { key: string; events: Event[]; line: FeedLine };

export function useFeedCtx(): FeedCtx {
  const [orders] = useTable(tables.orders);
  const [apis] = useTable(tables.api);
  const [runs] = useTable(tables.run);
  const [tasks] = useTable(tables.task);
  return useMemo(() => {
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const runById = new Map(runs.map((r) => [r.id, r]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const creaoRuns = runs.filter((r) => r.provider === 'creao' && r.taskId !== undefined);
    return {
      orderLabel: (id) => {
        const o = orderById.get(id);
        if (!o) return `order #${id}`;
        const api = o.apiId !== undefined ? apis.find((a) => a.id === o.apiId)?.name : undefined;
        return api ?? (o.requestText.length > 60 ? `${o.requestText.slice(0, 60)}…` : o.requestText || `order #${id}`);
      },
      datasetUrl: (id) => orderById.get(id)?.datasetUrl || undefined,
      isNewApi: (id, name) => {
        const o = orderById.get(id);
        const a = apis.find((x) => x.name === name);
        return o !== undefined && a !== undefined && micros(a.createdAt) >= micros(o.createdAt);
      },
      runById: (id) => runById.get(id),
      roleOfRun: (id) => {
        const t = runById.get(id)?.taskId;
        return t !== undefined ? taskById.get(t)?.role : undefined;
      },
      runFor: (e, role) => {
        const p = payloadObj(e.payload);
        const orderId = e.refType === 'order' ? e.refId : typeof p.orderId === 'string' && /^\d+$/.test(p.orderId) ? BigInt(p.orderId) : undefined;
        const ticketId = e.refType === 'ticket' ? e.refId : undefined;
        let best: Run | undefined;
        for (const r of creaoRuns) {
          const t = taskById.get(r.taskId!);
          if (!t || t.role !== role) continue;
          if (!((orderId !== undefined && t.orderId === orderId) || (ticketId !== undefined && t.ticketId === ticketId))) continue;
          if (micros(r.startedAt) > micros(e.at)) continue;
          if (!best || micros(r.startedAt) > micros(best.startedAt)) best = r;
        }
        return best;
      },
    };
  }, [orders, apis, runs, tasks]);
}

function toItems(events: readonly Event[], ctx: FeedCtx, group: boolean): Item[] {
  const out: Item[] = [];
  for (const e of events) {
    const prev = out.at(-1);
    if (group && prev && GROUPED.has(e.kind) && prev.events[0].kind === e.kind) {
      prev.events.push(e);
      continue;
    }
    out.push({ key: String(e.id), events: [e], line: describe(e, ctx) });
  }
  for (const it of out) {
    if (it.events.length > 1) it.line = { ...it.line, text: groupSentence(it.events[0].kind, it.events) ?? it.line.text };
  }
  return out;
}

const BACKGROUND_ACTORS = new Set(['system', 'rules', 'canary']);
const shown = (it: Item) => it.line.cls === 'failure' || (it.line.cls === 'story' && !BACKGROUND_ACTORS.has(it.line.actor));

export type FeedFilter = { label: string; matches: (event: Event) => boolean };

export function Feed({ order, scope, onOpen, cursor = null, filter = null, onClearFilter }: { order?: Order; scope: Scope; onOpen: (id: StationId) => void; cursor?: bigint | null; filter?: FeedFilter | null; onClearFilter?: () => void }) {
  const [events, eventsReady] = useTable(tables.event);
  const [tasks] = useTable(tables.task);
  const [runs] = useTable(tables.run);
  const [apis] = useTable(tables.api);
  const ctx = useFeedCtx();
  const inScope = useEventScope(scope);
  const [view, setView] = useState<'order' | 'company'>('order');
  const [plumbing, setPlumbing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [pages, setPages] = useState(1);
  const mode = filter ? 'company' : order ? view : 'company';

  useEffect(() => setPlumbing(false), [order?.id]);

  const orderItems = useMemo(() => {
    if (!order) return [];
    const mine = orderTimeline(order, events, tasks, runs, apis);
    return toItems(cursor === null ? mine : mine.filter((e) => micros(e.at) <= cursor), ctx, true);
  }, [order, events, tasks, runs, apis, ctx, cursor]);
  const statusNow = order && cursor !== null ? orderAt(order, events.filter((e) => e.refType === 'order' && e.refId === order.id), cursor).status : order?.status;

  const companyItems = useMemo(() => {
    if (mode !== 'company') return { items: [], more: false, total: 0 };
    const all = events.filter((e) => inScope(e) && (!filter || filter.matches(e))).sort(byIdDesc);
    const filtered = showAll ? all : all.filter((e) => { const c = classOf(e); return c === 'story' || c === 'failure'; });
    const limit = PAGE * pages;
    return { items: toItems(filtered.slice(0, limit), ctx, true), more: filtered.length > limit, total: filtered.length };
  }, [mode, events, inScope, showAll, pages, ctx, filter]);

  const hidden = orderItems.filter((it) => !shown(it)).length;
  const items = mode === 'order' ? (plumbing ? orderItems : orderItems.filter(shown)) : companyItems.items;
  const live = mode === 'order' && statusNow !== undefined && !TERMINAL.has(statusNow);

  // Follow the newest row in the order view unless the reader has scrolled up.
  const listRef = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (mode === 'order' && atBottom.current) el.scrollTop = el.scrollHeight;
    if (mode === 'company') el.scrollTop = 0;
  }, [items.length, mode, order?.id]);

  return (
    <section className="panel feed" data-testid="feed" aria-label="Feed">
      <header className="feed-head">
        <h2 className="picker-title">{mode === 'order' && order ? `Order #${order.id}` : 'Company'}</h2>
        {mode === 'order' && cursor !== null && <span className="badge replay" data-testid="feed-replay">REPLAY · {clock(new Timestamp(cursor))}</span>}
        {order && (
          <div className="seg" role="tablist" aria-label="Feed scope">
            <button role="tab" aria-selected={mode === 'order'} className={mode === 'order' ? 'on' : ''} onClick={() => setView('order')} data-testid="feed-order">This order</button>
            <button role="tab" aria-selected={mode === 'company'} className={mode === 'company' ? 'on' : ''} onClick={() => setView('company')} data-testid="feed-company">Company</button>
          </div>
        )}
      </header>
      {filter && <p className="muted" data-testid="feed-edge-filter">{filter.label} <button onClick={onClearFilter}>Clear filter</button></p>}
      {mode === 'company' && (
        <label className="toggle feed-all">
          <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); setPages(1); }} data-testid="show-all-events" /> Show all events
          <span className="muted">· {companyItems.total} in scope ({scope.label})</span>
        </label>
      )}
      <ol
        ref={listRef} className="feed-list" data-testid="feed-list"
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      >
        {items.map((it, i) => (
          <Row key={it.key} item={it} newest={mode === 'order' ? i === items.length - 1 : i === 0} live={live && i === items.length - 1} onOpen={onOpen} />
        ))}
        {!items.length && <li className="muted feed-empty">{eventsReady ? 'No events yet.' : 'Loading events…'}</li>}
        {mode === 'order' && hidden > 0 && (
          <li className="feed-more">
            <button className="linkish" onClick={() => setPlumbing(!plumbing)} aria-expanded={plumbing} data-testid="feed-plumbing">
              {plumbing ? '▾ Hide plumbing events' : `▸ Show ${hidden} more event${hidden === 1 ? '' : 's'} (plumbing)`}
            </button>
          </li>
        )}
        {mode === 'company' && companyItems.more && (
          <li className="feed-more"><button className="linkish" onClick={() => setPages(pages + 1)} data-testid="feed-load-more">Load more</button></li>
        )}
      </ol>
    </section>
  );
}

function LinkView({ link, onOpen }: { link: FeedLink; onOpen: (id: StationId) => void }) {
  if ('href' in link) return <a href={link.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{link.label}</a>;
  if ('station' in link) return <button className="linkish" onClick={() => onOpen(link.station)}>{link.label} →</button>;
  return <span className="muted">{link.none}</span>;
}

function Row({ item, newest, live, onOpen }: { item: Item; newest: boolean; live: boolean; onOpen: (id: StationId) => void }) {
  const [open, setOpen] = useState(false);
  const { line, events } = item;
  const e = events[0];
  const meta = ROLE_META[line.actor];
  return (
    <li className={`feed-row cls-${line.cls} ${newest ? 'newest' : ''}`} data-kind={e.kind}>
      <span className="t">{clock(e.at)}</span>
      <Avatar actor={line.actor} />
      <div className="feed-body">
        <span className={`feed-actor ${line.actor === 'system' ? 'muted' : ''}`} style={line.actor === 'system' ? undefined : { color: meta.color }}>{meta.label}</span>{' '}
        <span className={`feed-text ${open ? 'full' : ''}`}>{line.cls === 'failure' && '✕ '}{line.text}</span>
        {line.link && <> <LinkView link={line.link} onOpen={onOpen} /></>}
        {live && <span className="pulse" aria-label="in progress" />}
        {open && (
          <div className="feed-raw">
            {events.map((x) => (
              <div key={String(x.id)}>
                <code>{x.kind}</code> <span className="muted">{x.refType} #{String(x.refId)} · event #{String(x.id)} · {clock(x.at)}</span>
                <pre>{JSON.stringify(payloadObj(x.payload), null, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="expander" aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
    </li>
  );
}
