import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Event, Run } from './module_bindings/types';
import { byIdDesc, clock, micros, payloadObj } from './format';
import { describe, type ActorKey, type FeedCtx, type FeedLink } from './feedText';
import { Avatar, ROLE_META } from './Avatar';
import { SPONSOR_COLOR } from './Floor';
import { useScopeRules, type Scope } from './scope';
import type { StationId } from './scene';

type NodeId = 'founder' | 'customers' | 'desk' | 'coo' | 'research' | 'auditor' | 'cfo' | 'droid' | 'warehouse' | 'rules';
type Go = { station: StationId; label: string } | { tab: 'Engineering'; label: string } | { controls: true; label: string };

type NodeDef = {
  name: string;
  actor?: ActorKey;
  resp: [string, string];
  runsOn: string;
  sponsor: string;
  decides: string;
  // Event kinds this node is credited with; the count and the "last decisions" list come from them.
  kinds: string[];
  countLabel: string;
  taskRole?: string;
  go: Go;
  x: number; y: number; w: number;
};

const CUSTOMER_TONE = '#c9ced8';
const H = 146;

const NODES: Record<Exclude<NodeId, 'rules'>, NodeDef> = {
  founder: {
    name: 'Founder (you)', actor: 'founder', resp: ['Approves money and shipping', 'and sets the rules'], runsOn: 'dashboard · SpacetimeDB', sponsor: 'SpacetimeDB',
    decides: 'Publish approvals, spend over the engineering cap, refunds over the limit, Droid commands outside the test policy, and every company rule.',
    kinds: ['approval_approved', 'approval_rejected'], countLabel: 'founder decisions', go: { controls: true, label: 'Open company rules' }, x: 860, y: 78, w: 300,
  },
  customers: {
    name: 'Customers', resp: ['ASI:One users and', 'the buyer agent'], runsOn: 'ASI:One', sponsor: 'ASI:One',
    decides: 'What to ask for, whether to pay the quote, and whether to challenge a delivered value.',
    kinds: ['order_paid', 'challenge_opened'], countLabel: 'customers', go: { station: 'customer', label: 'Open the Customer drawer' }, x: 160, y: 340, w: 230,
  },
  desk: {
    name: 'Front Desk', actor: 'front_desk', resp: ['Parses requests, runs gate', 'checks, quotes, takes payment'], runsOn: 'Fetch uAgent', sponsor: 'Fetch.ai',
    decides: 'The quote, and instant rejections for personal data, blocked domains or requests over the page cap. No commercial judgment beyond the quote.',
    kinds: ['order_quoted', 'order_rejected_at_desk'], countLabel: 'quotes and rejections', go: { station: 'desk', label: 'Open the Front Desk drawer' }, x: 510, y: 340, w: 230,
  },
  coo: {
    name: 'COO', actor: 'coo', resp: ['Accepts, researches, counters', 'or rejects every paid order'], runsOn: 'CREAO saved agent', sponsor: 'CREAO',
    decides: 'ACCEPT (existing API or a new Tier 0 API), REQUEST_RESEARCH, COUNTEROFFER or REJECT, with a written reason.',
    kinds: ['coo_accepted', 'coo_rejected', 'coo_counteroffered', 'coo_requested_research'], countLabel: 'decisions', taskRole: 'coo',
    go: { station: 'coo', label: 'Open the COO drawer' }, x: 860, y: 340, w: 230,
  },
  cfo: {
    name: 'CFO', actor: 'cfo', resp: ['Decides whether a dedicated', 'extractor is worth the money'], runsOn: 'CREAO saved agent', sponsor: 'CREAO',
    decides: 'Compile, defer or reprice, from repeat buyers, measured cost per call and the engineering budget.',
    kinds: ['cfo_proposed'], countLabel: 'decisions', taskRole: 'cfo', go: { station: 'cfo', label: 'Open the CFO drawer' }, x: 1370, y: 340, w: 230,
  },
  research: {
    name: 'Research', actor: 'research', resp: ['Robots.txt, cited terms,', 'reachability, volatility'], runsOn: 'CREAO + Bright Data', sponsor: 'CREAO',
    decides: 'Layer-3 gate findings with quoted citations. It never makes the commercial call; the COO does.',
    kinds: ['research_reported'], countLabel: 'decisions', taskRole: 'research', go: { station: 'research', label: 'Open the Research drawer' }, x: 600, y: 600, w: 230,
  },
  auditor: {
    name: 'Auditor', actor: 'auditor', resp: ['Accepts or rejects every', 'deliverable and every build'], runsOn: 'CREAO saved agent', sponsor: 'CREAO',
    decides: 'Accept or reject each deliverable, rule on challenges against the saved page, and accept or send back each Droid build.',
    kinds: ['audit_accepted', 'audit_rejected', 'challenge_upheld', 'challenge_rejected', 'compile_accepted', 'compile_rejected'], countLabel: 'decisions', taskRole: 'auditor',
    go: { station: 'auditor', label: 'Open the Auditor drawer' }, x: 990, y: 600, w: 230,
  },
  droid: {
    name: 'Droid', actor: 'droid', resp: ['Builds dedicated extractors', 'in a locked worktree'], runsOn: 'Factory Droid', sponsor: 'Factory',
    decides: 'How to implement extract(page) so the fixture, contract and live tests pass. It cannot publish; the worker does after the founder approves.',
    kinds: ['compile_submitted', 'api_version_shipped'], countLabel: 'builds submitted', taskRole: 'droid_runner',
    go: { tab: 'Engineering', label: 'Open Engineering' }, x: 1370, y: 600, w: 230,
  },
  warehouse: {
    name: 'Warehouse', actor: 'warehouse', resp: ['Runs each API; Bright Data', 're-fetches every source'], runsOn: 'Apify · Bright Data', sponsor: 'Apify',
    decides: 'Nothing on its own: it runs the API engine (forge-extract Task or compiled Actor) and records what the quote anchor and the re-fetch found.',
    kinds: ['api_run_ingested', 'values_verified'], countLabel: 'runs started', go: { station: 'apify', label: 'Open the Warehouse drawer' }, x: 800, y: 820, w: 230,
  },
};

const RULES: Pick<NodeDef, 'name' | 'runsOn' | 'sponsor' | 'decides' | 'kinds' | 'go'> = {
  name: 'Treasurer and Rules', runsOn: 'reducers · SpacetimeDB', sponsor: 'SpacetimeDB',
  decides: 'Not employees: reducers move money in the ledger, enforce the budget cap and open compile tickets when a trigger holds.',
  kinds: ['compile_triggered', 'config_set', 'budget_cap_set'], go: { station: 'treasurer', label: 'Open the Treasurer drawer' },
};

type Part = { label: string; match: (e: Event, p: Record<string, unknown>) => boolean };
type EdgeDef = {
  id: string; from: NodeId; to: NodeId; d: string;
  parts: Part[];
  // Label block: top-line position and alignment.
  lx: number; ly: number; anchor?: 'start' | 'middle' | 'end';
  lines?: string[];
};

const kind = (k: string): Part['match'] => (e) => e.kind === k;
const kindWith = (k: string, key: string, v: string): Part['match'] => (e, p) => e.kind === k && p[key] === v;

const EDGES: EdgeDef[] = [
  { id: 'requests', from: 'customers', to: 'desk', d: 'M275,325 H395', parts: [{ label: 'requests', match: kind('order_quoted') }], lx: 335, ly: 282 },
  { id: 'desk-reject', from: 'desk', to: 'customers', d: 'M395,355 H275', parts: [{ label: 'rejected at the desk', match: kind('order_rejected_at_desk') }], lx: 335, ly: 386, lines: ['rejected at', 'the desk'] },
  { id: 'paid', from: 'desk', to: 'coo', d: 'M625,340 H745', parts: [{ label: 'paid orders handed over', match: kind('order_paid') }], lx: 685, ly: 372, lines: ['paid orders', 'handed over'] },
  { id: 'research', from: 'coo', to: 'research', d: 'M780,413 L630,527', parts: [{ label: 'research requested', match: kind('coo_requested_research') }], lx: 640, ly: 440, lines: ['research', 'requested'] },
  { id: 'reports', from: 'research', to: 'coo', d: 'M670,527 L815,413', parts: [{ label: 'reports filed', match: kind('research_reported') }], lx: 790, ly: 478, lines: ['reports', 'filed'] },
  { id: 'runs', from: 'coo', to: 'warehouse', d: 'M860,413 L815,747', parts: [{ label: 'runs ordered', match: kind('coo_accepted') }], lx: 868, ly: 452, anchor: 'start', lines: ['runs', 'ordered'] },
  {
    id: 'coo-reject', from: 'coo', to: 'customers', d: 'M790,267 C790,186 160,186 160,267',
    parts: [{ label: 'rejected with a reason', match: kind('coo_rejected') }, { label: 'counteroffers', match: kind('coo_counteroffered') }], lx: 475, ly: 168,
  },
  { id: 'for-audit', from: 'warehouse', to: 'auditor', d: 'M915,790 L1000,673', parts: [{ label: 'deliverables for audit', match: kind('values_verified') }], lx: 975, ly: 722, anchor: 'start', lines: ['deliverables', 'for audit'] },
  {
    id: 'delivered', from: 'auditor', to: 'customers', d: 'M895,673 V700 H185 V413',
    parts: [{ label: 'delivered', match: kind('audit_accepted') }, { label: 'rejected', match: kind('audit_rejected') }], lx: 330, ly: 670,
  },
  { id: 'challenges', from: 'customers', to: 'auditor', d: 'M135,413 V730 H925 V673', parts: [{ label: 'challenges', match: kind('challenge_opened') }], lx: 330, ly: 758 },
  { id: 'tickets', from: 'rules', to: 'cfo', d: 'M1560,920 V340 H1485', parts: [{ label: 'compile tickets', match: kind('compile_triggered') }], lx: 1548, ly: 740, anchor: 'end', lines: ['compile', 'tickets'] },
  { id: 'funded', from: 'cfo', to: 'droid', d: 'M1370,413 V527', parts: [{ label: 'builds funded', match: kindWith('cfo_proposed', 'decision', 'COMPILE') }], lx: 1382, ly: 452, anchor: 'start', lines: ['builds', 'funded'] },
  { id: 'submitted', from: 'droid', to: 'auditor', d: 'M1255,585 H1105', parts: [{ label: 'builds submitted', match: kind('compile_submitted') }], lx: 1180, ly: 534, lines: ['builds', 'submitted'] },
  { id: 'rework', from: 'auditor', to: 'droid', d: 'M1105,615 H1255', parts: [{ label: 'sent back for rework', match: kind('compile_rejected') }], lx: 1180, ly: 644, lines: ['sent back', 'for rework'] },
  { id: 'publish-ask', from: 'auditor', to: 'founder', d: 'M1060,527 L1000,151', parts: [{ label: 'publish approvals requested', match: kindWith('approval_requested', 'kind', 'api_ship') }], lx: 1140, ly: 300, lines: ['publish approvals', 'requested'] },
  {
    id: 'founder-droid', from: 'founder', to: 'droid', d: 'M1010,50 H1525 V600 H1485',
    parts: [{ label: 'publish approved', match: kindWith('approval_approved', 'kind', 'api_ship') }, { label: 'actions denied', match: kindWith('approval_rejected', 'kind', 'droid_action') }],
    lx: 1260, ly: 92,
  },
  { id: 'rule-changes', from: 'founder', to: 'rules', d: 'M710,74 H24 V920', parts: [{ label: 'rule changes', match: (e) => e.kind === 'config_set' || e.kind === 'budget_cap_set' }], lx: 380, ly: 36 },
  { id: 'shipped', from: 'droid', to: 'warehouse', d: 'M1370,673 V860 H915', parts: [{ label: 'versions shipped', match: kind('api_version_shipped') }], lx: 1150, ly: 818 },
];

const SINGULAR: Record<string, string> = {
  decisions: 'decision', 'founder decisions': 'founder decision', customers: 'customer', 'builds submitted': 'build submitted', 'runs started': 'run started',
};
const unit = (n: number, label: string) => (n === 1 ? SINGULAR[label] ?? label : label);

const nodeName = (id: NodeId) => (id === 'rules' ? RULES.name : NODES[id].name);

type Selected = { node: NodeId } | { edge: string } | null;

export function OrgChartTab({ scope, setShowTest, onStation, onEngineering, onControls }: {
  scope: Scope; setShowTest: (v: boolean) => void; onStation: (id: StationId) => void; onEngineering: () => void; onControls: () => void;
}) {
  const [events] = useTable(tables.event);
  const [tasks] = useTable(tables.task);
  const [orders] = useTable(tables.orders);
  const [approvals] = useTable(tables.approval);
  const [customers] = useTable(tables.customer);
  const rules = useScopeRules(scope);
  const ctx = useFeedCtx();
  const [sel, setSel] = useState<Selected>(null);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const scoped = useMemo(() => events.filter(rules.event).sort(byIdDesc), [events, rules]);

  const edgeEvents = useMemo(() => {
    const out = new Map<string, Event[][]>();
    for (const edge of EDGES) out.set(edge.id, edge.parts.map(() => []));
    for (const e of scoped) {
      const p = payloadObj(e.payload);
      for (const edge of EDGES) edge.parts.forEach((part, i) => { if (part.match(e, p)) out.get(edge.id)![i].push(e); });
    }
    return out;
  }, [scoped]);

  const nodeEvents = useMemo(() => {
    const out = new Map<NodeId, Event[]>();
    const all: [NodeId, string[]][] = [...Object.entries(NODES).map(([id, n]) => [id as NodeId, n.kinds] as [NodeId, string[]]), ['rules', RULES.kinds]];
    for (const [id, ks] of all) out.set(id, scoped.filter((e) => ks.includes(e.kind)));
    return out;
  }, [scoped]);

  const visibleOrders = useMemo(() => orders.filter(scope.isVisible), [orders, scope]);

  const status = (id: NodeId): string | undefined => {
    const n = id === 'rules' ? undefined : NODES[id];
    if (n?.taskRole) {
      const mine = tasks.filter((t) => t.role === n.taskRole && rules.task(t));
      const working = mine.filter((t) => t.status === 'claimed' || t.status === 'dispatched').length;
      const queued = mine.filter((t) => t.status === 'queued').length;
      return working ? 'working' : queued ? `waiting · ${queued} queued` : 'idle';
    }
    if (id === 'warehouse') return visibleOrders.some((o) => o.status === 'running' || o.status === 'verifying') ? 'working' : 'idle';
    if (id === 'founder') {
      const pending = approvals.filter((a) => a.status === 'pending' && rules.approval(a)).length;
      return pending ? `waiting · ${pending} approval${pending === 1 ? '' : 's'}` : 'nothing pending';
    }
    return undefined;
  };

  const count = (id: NodeId): number => {
    if (id === 'customers') {
      const ids = new Set(visibleOrders.map((o) => o.customerId));
      return customers.filter((c) => ids.has(c.id)).length;
    }
    if (id === 'warehouse') return scoped.filter((e) => e.kind === 'api_run_started').length;
    if (id === 'droid') return scoped.filter((e) => e.kind === 'compile_submitted').length;
    return nodeEvents.get(id)?.length ?? 0;
  };

  const go = (g: Go) => {
    if ('station' in g) onStation(g.station);
    else if ('tab' in g) onEngineering();
    else onControls();
  };

  return (
    <div className="org" data-testid="org-chart">
      <div className="org-canvas">
        <svg viewBox="0 0 1600 990" className="org-svg" role="group" aria-label="Org chart of FORGE employees and their handoffs">
          <defs>
            <marker id="org-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#a39d92" />
            </marker>
            <marker id="org-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#ff7a2f" />
            </marker>
          </defs>
          {EDGES.map((edge) => (
            <EdgeView key={edge.id} edge={edge} counts={edgeEvents.get(edge.id)!.map((l) => l.length)}
              challenge={edge.id === 'challenges' ? challengeTip(scoped) : undefined}
              on={sel !== null && 'edge' in sel && sel.edge === edge.id} onClick={() => setSel({ edge: edge.id })} />
          ))}
          {(Object.keys(NODES) as Exclude<NodeId, 'rules'>[]).map((id) => (
            <NodeView key={id} id={id} n={NODES[id]} status={status(id)} count={count(id)}
              on={sel !== null && 'node' in sel && sel.node === id} onClick={() => setSel({ node: id })} />
          ))}
          <RulesView count={count('rules')} on={sel !== null && 'node' in sel && sel.node === 'rules'} onClick={() => setSel({ node: 'rules' })} />
        </svg>
      </div>
      <div className="org-foot">
        <span className="muted" data-testid="org-scope">Counts from stored events · {scope.label}. Click a person or an arrow for the events behind it; Esc closes.</span>
        <label className="toggle">
          <input type="checkbox" checked={scope.showTest} onChange={(e) => setShowTest(e.target.checked)} data-testid="org-show-test" /> Show test traffic
        </label>
      </div>
      {sel && 'node' in sel && (
        <NodeCard id={sel.node} status={status(sel.node)} count={count(sel.node)} events={nodeEvents.get(sel.node) ?? []} ctx={ctx}
          onClose={() => setSel(null)} onGo={go} onStation={onStation} />
      )}
      {sel && 'edge' in sel && (
        <EdgeCard edge={EDGES.find((x) => x.id === sel.edge)!} lists={edgeEvents.get(sel.edge)!} ctx={ctx} onClose={() => setSel(null)} onStation={onStation} />
      )}
    </div>
  );
}

function challengeTip(scoped: readonly Event[]): string {
  const upheld = scoped.filter((e) => e.kind === 'challenge_upheld').length;
  const rejected = scoped.filter((e) => e.kind === 'challenge_rejected').length;
  return `upheld ${upheld} · rejected ${rejected}`;
}

const press = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
};

function EdgeView({ edge, counts, challenge, on, onClick }: { edge: EdgeDef; counts: number[]; challenge?: string; on: boolean; onClick: () => void }) {
  const total = counts.reduce((s, n) => s + n, 0);
  const lines = edge.lines ?? [edge.parts.map((p) => p.label).join(' / ')];
  const countText = counts.join(' / ');
  const summary = `${nodeName(edge.from)} to ${nodeName(edge.to)}: ${edge.parts.map((p, i) => `${p.label} ${counts[i]}`).join(', ')}${challenge ? ` (${challenge})` : ''}`;
  return (
    <g className={`org-edge ${total === 0 ? 'zero' : ''} ${on ? 'on' : ''}`} role="button" tabIndex={0} aria-label={summary}
      onClick={onClick} onKeyDown={press(onClick)} data-testid={`edge-${edge.id}`} data-count={countText}>
      <title>{summary}</title>
      <path d={edge.d} className="org-edge-hit" />
      <path d={edge.d} className="org-edge-line" markerEnd={`url(#${on ? 'org-arrow-on' : 'org-arrow'})`} />
      <text x={edge.lx} y={edge.ly} textAnchor={edge.anchor ?? 'middle'} className="org-edge-label">
        <tspan className="org-edge-count" x={edge.lx} dy={0}>{countText}</tspan>
        {lines.map((l, i) => <tspan key={i} x={edge.lx} dy={i === 0 ? 20 : 17}>{l}</tspan>)}
        {challenge && <tspan x={edge.lx} dy={17} className="org-edge-sub">{challenge}</tspan>}
      </text>
    </g>
  );
}

function NodeView({ id, n, status, count, on, onClick }: { id: NodeId; n: NodeDef; status?: string; count: number; on: boolean; onClick: () => void }) {
  const tone = n.actor ? ROLE_META[n.actor].color : CUSTOMER_TONE;
  const initials = n.actor ? ROLE_META[n.actor].initials : 'CU';
  const x0 = n.x - n.w / 2, y0 = n.y - H / 2;
  const chip = `runs on ${n.runsOn}`;
  const sponsor = SPONSOR_COLOR[n.sponsor] ?? '#a39d92';
  const statusTone = status === 'working' ? '#ff7a2f' : status?.startsWith('waiting') ? '#e8a93a' : '#a39d92';
  return (
    <g className={`org-node ${on ? 'on' : ''}`} role="button" tabIndex={0} aria-label={`${n.name}: ${n.resp.join(' ')}. ${chip}. ${status ? `${status}. ` : ''}${count} ${unit(count, n.countLabel)}`}
      onClick={onClick} onKeyDown={press(onClick)} data-testid={`node-${id}`}>
      <rect x={x0} y={y0} width={n.w} height={H} rx={12} className="org-node-box" style={{ stroke: on ? '#ff7a2f' : tone }} />
      <circle cx={x0 + 26} cy={y0 + 26} r={16} fill="#15130f" stroke={tone} strokeWidth={2.5} />
      <text x={x0 + 26} y={y0 + 30.5} textAnchor="middle" className="org-initials" fill={tone}>{initials}</text>
      <text x={x0 + 50} y={y0 + 33} className="org-name">{n.name}</text>
      <text x={x0 + 14} y={y0 + 60} className="org-resp">{n.resp[0]}</text>
      <text x={x0 + 14} y={y0 + 77} className="org-resp">{n.resp[1]}</text>
      <rect x={x0 + 14} y={y0 + 86} width={chip.length * 7.2 + 16} height={20} rx={10} fill="#121110" stroke={sponsor} strokeWidth={1.2} />
      <text x={x0 + 22} y={y0 + 100.5} className="org-chip" fill={sponsor}>{chip}</text>
      {status && <text x={x0 + 14} y={y0 + 124} className="org-status" style={{ fill: statusTone }}>{status === 'working' ? '● ' : ''}{status}</text>}
      <text x={x0 + 14} y={y0 + (status ? 140 : 124)} className="org-status"><tspan className="org-count">{count}</tspan> {unit(count, n.countLabel)}</text>
    </g>
  );
}

function RulesView({ count, on, onClick }: { count: number; on: boolean; onClick: () => void }) {
  const sponsor = SPONSOR_COLOR[RULES.sponsor];
  return (
    <g className={`org-node ${on ? 'on' : ''}`} role="button" tabIndex={0} aria-label={`${RULES.name}: reducers, not employees. ${count} rule changes and compile tickets`}
      onClick={onClick} onKeyDown={press(onClick)} data-testid="node-rules">
      <rect x={20} y={920} width={1560} height={58} rx={10} className="org-node-box org-footer" style={{ stroke: on ? '#ff7a2f' : '#4a443b' }} />
      {(['treasurer', 'rules'] as const).map((a, i) => (
        <g key={a}>
          <circle cx={52 + i * 38} cy={949} r={15} fill="#15130f" stroke={ROLE_META[a].color} strokeWidth={2.5} />
          <text x={52 + i * 38} y={953.5} textAnchor="middle" className="org-initials" fill={ROLE_META[a].color}>{ROLE_META[a].initials}</text>
        </g>
      ))}
      <text x={124} y={956} className="org-name">{RULES.name}</text>
      <text x={330} y={955} className="org-resp">Reducers, not employees: move money, enforce caps, open compile tickets</text>
      <rect x={870} y={939} width={'runs on reducers · SpacetimeDB'.length * 7.2 + 16} height={20} rx={10} fill="#121110" stroke={sponsor} strokeWidth={1.2} />
      <text x={878} y={953.5} className="org-chip" fill={sponsor}>runs on {RULES.runsOn}</text>
      <text x={1540} y={955} textAnchor="end" className="org-status"><tspan className="org-count">{count}</tspan> rule changes and compile tickets</text>
    </g>
  );
}

function CardShell({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="org-card" role="dialog" aria-label="Org chart details" data-testid="org-card">
      <header>
        <h2>{title}</h2>
        <button className="close" onClick={onClose} aria-label="Close" autoFocus>✕</button>
      </header>
      {children}
    </aside>
  );
}

function NodeCard({ id, status, count, events, ctx, onClose, onGo, onStation }: {
  id: NodeId; status?: string; count: number; events: Event[]; ctx: FeedCtx; onClose: () => void; onGo: (g: Go) => void; onStation: (id: StationId) => void;
}) {
  const n = id === 'rules' ? undefined : NODES[id];
  const def = n ?? RULES;
  const avatar = n?.actor ? <Avatar actor={n.actor} /> : id === 'rules' ? <Avatar actor="rules" /> : <span className="avatar" style={{ borderColor: CUSTOMER_TONE, color: CUSTOMER_TONE }} aria-hidden="true">CU</span>;
  const last = events.slice(0, 3);
  return (
    <CardShell title={<>{avatar} {def.name}</>} onClose={onClose}>
      {n && <p className="org-card-resp">{n.resp.join(' ')}</p>}
      <dl className="decisions">
        <dt>Runs on</dt><dd><span className="org-chip-html" style={{ color: SPONSOR_COLOR[def.sponsor], borderColor: SPONSOR_COLOR[def.sponsor] }}>{def.runsOn}</span></dd>
        <dt>Decides</dt><dd>{def.decides}</dd>
        {status && <><dt>Now</dt><dd>{status}</dd></>}
        <dt>In scope</dt><dd>{count} {n ? unit(count, n.countLabel) : 'rule changes and compile tickets'}</dd>
      </dl>
      <h3>Last {last.length || ''} {id === 'founder' ? 'approvals' : 'decisions'}</h3>
      <EventList events={last} ctx={ctx} onStation={onStation} empty="Nothing recorded in this scope." />
      <button className="org-go" onClick={() => onGo(def.go)} data-testid="org-go">{def.go.label} →</button>
    </CardShell>
  );
}

function EdgeCard({ edge, lists, ctx, onClose, onStation }: { edge: EdgeDef; lists: Event[][]; ctx: FeedCtx; onClose: () => void; onStation: (id: StationId) => void }) {
  const all = lists.flat().sort(byIdDesc);
  const LIMIT = 30;
  return (
    <CardShell title={<>{nodeName(edge.from)} → {nodeName(edge.to)}</>} onClose={onClose}>
      <p className="org-card-resp">{edge.parts.map((p, i) => `${p.label}: ${lists[i].length}`).join(' · ')}</p>
      <h3>Events behind this count, newest first</h3>
      <EventList events={all.slice(0, LIMIT)} ctx={ctx} onStation={onStation} empty="No events of this kind in this scope." />
      {all.length > LIMIT && <p className="muted">{all.length - LIMIT} older events not shown.</p>}
    </CardShell>
  );
}

function EventList({ events, ctx, onStation, empty }: { events: Event[]; ctx: FeedCtx; onStation: (id: StationId) => void; empty: string }) {
  if (!events.length) return <p className="muted">{empty}</p>;
  return (
    <ol className="feed-list org-events">
      {events.map((e) => {
        const line = describe(e, ctx);
        return (
          <li key={String(e.id)} className={`feed-row cls-${line.cls}`} data-kind={e.kind}>
            <span className="t">{clock(e.at)}</span>
            <Avatar actor={line.actor} />
            <div className="feed-body">
              <span className="feed-actor" style={line.actor === 'system' ? undefined : { color: ROLE_META[line.actor].color }}>{ROLE_META[line.actor].label}</span>{' '}
              <span className="feed-text">{line.cls === 'failure' && '✕ '}{line.text}</span>
              {line.link && <> <LinkView link={line.link} onStation={onStation} /></>}
            </div>
            <span />
          </li>
        );
      })}
    </ol>
  );
}

function LinkView({ link, onStation }: { link: FeedLink; onStation: (id: StationId) => void }) {
  if ('href' in link) return <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>;
  if ('station' in link) return <button className="linkish" onClick={() => onStation(link.station)}>{link.label} →</button>;
  return <span className="muted">{link.none}</span>;
}

// Same lookups as the feed's context, so a sentence reads identically in the org chart and the feed.
function useFeedCtx(): FeedCtx {
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
