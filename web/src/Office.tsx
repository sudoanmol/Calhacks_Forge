import { useEffect, useMemo, useRef, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Event, Orders as Order } from './module_bindings/types';
import { byIdAsc, byIdDesc, micros } from './format';
import type { Scope } from './scope';
import { TERMINAL } from './flow';
import { buildScene, type Scene, type SceneData, type StationId } from './scene';
import { FloorScene } from './Floor';
import { Pipeline } from './Pipeline';
import { StationDrawer } from './Drawer';

const PICKER_SHOWN = 8;

export function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

// Re-renders age labels; it never drives scene state or animation.
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function age(o: Order, now: number) {
  const s = Math.max(0, (now - Number(micros(o.createdAt) / 1000n)) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const inProgress = (o: Order) => !TERMINAL.has(o.status) && o.status !== 'quoted';

export type Selection = {
  visible: Order[];
  selectedId?: bigint;
  selected?: Order;
  newer: number;
  pick: (id: bigint) => void;
  drawer: StationId | null;
  setDrawer: (id: StationId | null) => void;
};

// One selected order drives the headline, floor, drawers and feed. A pick that leaves the visible scope
// (for example a test order after Show test traffic is turned off) falls back to auto-follow.
export function useOrderSelection(scope: Scope): Selection {
  const [orders] = useTable(tables.orders);
  const [picked, setPicked] = useState<bigint | null>(null);
  const [seenMax, setSeenMax] = useState<bigint>(0n);
  const [drawer, setDrawer] = useState<StationId | null>(null);
  const visible = useMemo(() => [...orders].filter(scope.isVisible).sort(byIdDesc), [orders, scope]);
  const auto = useMemo(() => {
    const real = [...orders].filter(scope.isReal).sort(byIdDesc);
    return (real.find(inProgress) ?? real[0] ?? visible[0])?.id;
  }, [orders, scope, visible]);
  const pickVisible = picked !== null && visible.some((o) => o.id === picked);
  useEffect(() => {
    if (picked !== null && !pickVisible) { setPicked(null); setDrawer(null); }
  }, [picked, pickVisible]);
  const selectedId = pickVisible ? picked! : auto;
  return {
    visible,
    selectedId,
    selected: orders.find((o) => o.id === selectedId),
    newer: pickVisible ? visible.filter((o) => o.id > seenMax).length : 0,
    pick: (id) => {
      setPicked(id);
      setSeenMax(visible.reduce((m, o) => (o.id > m ? o.id : m), 0n));
      setDrawer(null);
    },
    drawer,
    setDrawer,
  };
}

export function OfficeTab({ scope, setShowTest, sel }: { scope: Scope; setShowTest: (v: boolean) => void; sel: Selection }) {
  const [, ready] = useTable(tables.orders);
  const [events] = useTable(tables.event);
  const [customers] = useTable(tables.customer);
  const [apis] = useTable(tables.api);
  const [versions] = useTable(tables.apiVersion);
  const [gates] = useTable(tables.gateCheck);
  const [values] = useTable(tables.valueRecord);
  const [evidence] = useTable(tables.evidence);
  const [runs] = useTable(tables.run);
  const [tasks] = useTable(tables.task);
  const [challenges] = useTable(tables.challenge);
  const [runCosts] = useTable(tables.runCost);
  const [bonuses] = useTable(tables.bonus);
  const [books] = useTable(tables.books);
  const [budgets] = useTable(tables.budget);
  const [approvals] = useTable(tables.approval);
  const [tickets] = useTable(tables.ticket);

  const phone = useMedia('(max-width: 800px)');
  const now = useNow(15_000);
  const { canaryIds } = scope;
  const { visible, selectedId, selected, newer, pick, drawer, setDrawer } = sel;

  const scene: { data: SceneData; scene: Scene } | undefined = useMemo(() => {
    if (!selected) return undefined;
    const o = selected;
    const orderTasks = tasks.filter((t) => t.orderId === o.id);
    const taskIds = new Set(orderTasks.map((t) => t.id));
    const orderEvents: Event[] = events
      .filter((e) => e.refType === 'order' && e.refId === o.id)
      .sort(byIdAsc);
    const api = o.apiId !== undefined ? apis.find((a) => a.id === o.apiId) : undefined;
    const data: SceneData = {
      order: o,
      orderEvents,
      customer: customers.find((c) => c.id === o.customerId),
      api,
      apiVersion: versions.find((v) => v.id === (o.apiVersionId ?? api?.currentVersionId)),
      gates: gates.filter((g) => g.orderId === o.id),
      values: values.filter((v) => v.orderId === o.id),
      evidence: evidence.filter((x) => x.orderId === o.id),
      runs: runs.filter((r) => (r.provider === 'apify' && r.threadId === String(o.id)) || (r.taskId !== undefined && taskIds.has(r.taskId))),
      tasks: orderTasks,
      challenges: challenges.filter((c) => c.orderId === o.id),
      runCosts: runCosts.filter((r) => r.orderId === o.id),
      bonuses: bonuses.filter((b) => b.orderId === o.id),
      books: books.filter((b) => b.account === `customer:${o.id}`),
      isCanary: canaryIds.has(o.id),
      budget: budgets.find((b) => b.name === 'engineering'),
      approvals,
      tickets,
      allTasks: tasks,
    };
    return { data, scene: buildScene(data) };
  }, [selected, tasks, events, apis, customers, versions, gates, values, evidence, runs, challenges, runCosts, bonuses, books, canaryIds, budgets, approvals, tickets]);

  if (!ready) return <p className="muted">Loading orders…</p>;

  return (
    <div className="office">
      <Picker
        orders={visible} selectedId={selectedId} scope={scope} now={now}
        setShowTest={setShowTest} onPick={pick}
        newer={newer} onNewest={() => visible[0] && pick(visible[0].id)}
        apiName={(o) => (o.apiId !== undefined ? apis.find((a) => a.id === o.apiId)?.name : undefined)}
      />
      {scene ? (
        <>
          {phone
            ? <Pipeline scene={scene.scene} onOpen={setDrawer} />
            : <FloorScene key={String(scene.data.order.id)} scene={scene.scene} data={scene.data} onOpen={setDrawer} selected={drawer} />}
          {drawer && <StationDrawer id={drawer} data={scene.data} scene={scene.scene} onClose={() => setDrawer(null)} />}
        </>
      ) : <p className="muted">No orders yet.</p>}
    </div>
  );
}

type PickerProps = {
  orders: Order[]; selectedId?: bigint; scope: Scope; now: number;
  setShowTest: (v: boolean) => void; onPick: (id: bigint) => void;
  newer: number; onNewest: () => void; apiName: (o: Order) => string | undefined;
};

function Picker({ orders, selectedId, scope, now, setShowTest, onPick, newer, onNewest, apiName }: PickerProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = q
    ? orders.filter((o) => (q.startsWith('#') ? String(o.id) === q.slice(1) : String(o.id) === q || o.requestText.toLowerCase().includes(q)))
    : orders;
  const chips = matches.slice(0, PICKER_SHOWN);
  const selected = orders.find((o) => o.id === selectedId);
  if (selected && !chips.includes(selected) && !q) chips.push(selected);
  const running = orders.filter(inProgress).length;
  const unpaid = orders.filter((o) => o.status === 'quoted').length;
  const selRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selectedId]);
  return (
    <div className="picker" data-testid="picker">
      <div className="picker-bar">
        <span className="picker-title">Orders</span>
        <span className="picker-counts" data-testid="picker-counts"><span className={running ? 'live-dot' : 'idle-dot'}>●</span> {running} running · {unpaid} unpaid quote{unpaid === 1 ? '' : 's'}</span>
        {newer > 0 && (
          <button className="newbadge" onClick={onNewest} data-testid="new-order">● {newer} new order{newer === 1 ? '' : 's'}</button>
        )}
        <input
          className="order-search" type="search" placeholder="Search #id or request" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search orders" data-testid="order-search"
        />
        <label className="toggle">
          <input type="checkbox" checked={scope.showTest} onChange={(e) => setShowTest(e.target.checked)} data-testid="show-test" /> Show test traffic
        </label>
      </div>
      <div className="chips">
        {!chips.length && <p className="muted">No orders match “{query}”{scope.showTest ? '' : ' in real orders; try Show test traffic'}.</p>}
        {chips.map((o) => (
          <button
            key={String(o.id)} ref={o.id === selectedId ? selRef : undefined}
            className={`chip ${o.id === selectedId ? 'on' : ''}`} onClick={() => onPick(o.id)} data-testid={`chip-${o.id}`}
            title={o.requestText}
          >
            <span className="chip-top">
              <b>#{String(o.id)}</b>
              <span className={`status s-${o.status}`}>{o.status.replace(/_/g, ' ')}</span>
              <span className="muted">{age(o, now)}</span>
              {!scope.isReal(o) && <span className="badge testtraffic">TEST TRAFFIC</span>}
              {scope.canaryIds.has(o.id) && <span className="badge canary">canary</span>}
            </span>
            <span className="chip-req">{apiName(o) ? <em>{apiName(o)} · </em> : null}{o.requestText || '(no text)'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
