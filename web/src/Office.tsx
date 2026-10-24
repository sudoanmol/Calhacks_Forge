import { useEffect, useMemo, useRef, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Event, Orders as Order } from './module_bindings/types';
import { byIdAsc, byIdDesc, micros, short } from './format';
import { TERMINAL } from './flow';
import { buildScene, type Scene, type SceneData, type StationId } from './scene';
import { FloorScene } from './Floor';
import { Pipeline } from './Pipeline';
import { StationDrawer } from './Drawer';

const PICKER_SHOWN = 12;

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
function useNow(ms: number) {
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

export function OfficeTab() {
  const [orders, ready] = useTable(tables.orders);
  const [canary] = useTable(tables.canaryOrder);
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
  const [showCanary, setShowCanary] = useState(false);
  const [picked, setPicked] = useState<bigint | null>(null);
  const [seenMax, setSeenMax] = useState<bigint>(0n);
  const [drawer, setDrawer] = useState<StationId | null>(null);

  const canaryIds = useMemo(() => new Set(canary.map((c) => c.orderId)), [canary]);
  const visible = useMemo(
    () => [...orders].filter((o) => showCanary || !canaryIds.has(o.id)).sort(byIdDesc),
    [orders, canaryIds, showCanary],
  );
  const auto = useMemo(() => {
    const real = [...orders].filter((o) => !canaryIds.has(o.id)).sort(byIdDesc);
    return (real.find(inProgress) ?? real[0] ?? visible[0])?.id;
  }, [orders, canaryIds, visible]);
  const selectedId = picked ?? auto;
  const selected = orders.find((o) => o.id === selectedId);
  const newer = picked !== null ? visible.filter((o) => o.id > seenMax) : [];

  const pick = (id: bigint) => {
    setPicked(id);
    setSeenMax(visible.reduce((m, o) => (o.id > m ? o.id : m), 0n));
    setDrawer(null);
  };

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
        orders={visible} selectedId={selectedId} canaryIds={canaryIds} now={now}
        showCanary={showCanary} setShowCanary={setShowCanary} onPick={pick}
        newer={newer.length} onNewest={() => visible[0] && pick(visible[0].id)}
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
  orders: Order[]; selectedId?: bigint; canaryIds: Set<bigint>; now: number;
  showCanary: boolean; setShowCanary: (v: boolean) => void; onPick: (id: bigint) => void;
  newer: number; onNewest: () => void; apiName: (o: Order) => string | undefined;
};

function Picker({ orders, selectedId, canaryIds, now, showCanary, setShowCanary, onPick, newer, onNewest, apiName }: PickerProps) {
  const chips = orders.slice(0, PICKER_SHOWN);
  const rest = orders.slice(PICKER_SHOWN);
  const selRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selectedId]);
  return (
    <div className="picker" data-testid="picker">
      <div className="picker-bar">
        <span className="picker-title">Orders</span>
        {newer > 0 && (
          <button className="newbadge" onClick={onNewest} data-testid="new-order">● {newer} new order{newer === 1 ? '' : 's'}</button>
        )}
        <label className="canary-toggle">
          <input type="checkbox" checked={showCanary} onChange={(e) => setShowCanary(e.target.checked)} /> show canary
        </label>
        {rest.length > 0 && (
          <select
            className="older" value={rest.some((o) => o.id === selectedId) ? String(selectedId) : ''}
            onChange={(e) => e.target.value && onPick(BigInt(e.target.value))}
          >
            <option value="">older ({rest.length})…</option>
            {rest.map((o) => <option key={String(o.id)} value={String(o.id)}>#{String(o.id)} {o.status} · {short(o.requestText, 34, 0)}</option>)}
          </select>
        )}
      </div>
      <div className="chips">
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
              {canaryIds.has(o.id) && <span className="badge canary">canary</span>}
            </span>
            <span className="chip-req">{apiName(o) ? <em>{apiName(o)} · </em> : null}{o.requestText || '(no text)'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
