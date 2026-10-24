import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FLOW, STATION_META, durationText, type FlowId, type SState, type Scene, type SceneData, type StationId, type StationView } from './scene';

const W = 1400;
const H = 910;
const BLOCK = 150; // width of a station block's top face
const SIDE_BLOCK = 124;
const BLOCK_H = 34;
const PIPE_DY = 26; // pipes meet the block at mid-height
const ENTRY = 112; // where the packet waits, measured from the station centre along its pipe

const POS: Record<StationId, { x: number; y: number }> = {
  customer: { x: 130, y: 150 }, desk: { x: 415, y: 150 }, coo: { x: 700, y: 150 }, research: { x: 985, y: 150 }, apify: { x: 1270, y: 150 },
  cfo: { x: 415, y: 445 }, droid: { x: 700, y: 445 }, treasurer: { x: 985, y: 445 },
  delivered: { x: 130, y: 705 }, auditor: { x: 700, y: 705 }, verify: { x: 1270, y: 705 },
};

// Direction the pipe enters each flow station from; the packet waits on that side.
const IN_FROM: Record<FlowId, [number, number]> = {
  customer: [1, 0], desk: [-1, 0], coo: [-1, 0], research: [-1, 0], apify: [-1, 0],
  verify: [0, -1], auditor: [1, 0], delivered: [1, 0],
};
const CORNERS = new Set<FlowId>(['apify', 'verify']);

export const STATE_COLOR: Record<SState, string> = {
  idle: '#5b616e', waiting: '#e8a93a', working: '#ff7a2f', done: '#4cc38a', rejected: '#ef4f4f', failed: '#ef4f4f', skipped: '#4a4f59',
};
export const SPONSOR_COLOR: Record<string, string> = {
  'ASI:One': '#c9ced8', 'Fetch.ai': '#6d9bff', CREAO: '#b896ff', 'CREAO + Bright Data': '#b896ff', 'Bright Data': '#3fd0c0',
  Apify: '#97d74f', Factory: '#f3f3f3', SpacetimeDB: '#ff7cc0',
};

const anchor = (id: StationId) => ({ x: POS[id].x, y: POS[id].y + PIPE_DY });
const entry = (id: FlowId) => {
  const a = anchor(id);
  const [dx, dy] = IN_FROM[id];
  return { x: a.x + dx * ENTRY, y: a.y + dy * (ENTRY + 8) };
};

function route(from: FlowId, to: FlowId): { x: number; y: number }[] {
  const i = FLOW.indexOf(from);
  const j = FLOW.indexOf(to);
  if (j <= i) return [entry(to)];
  const pts = [entry(from)];
  for (let k = i; k < j; k++) {
    if (CORNERS.has(FLOW[k])) pts.push(anchor(FLOW[k]));
    pts.push(entry(FLOW[k + 1]));
  }
  return pts;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Greedy word wrap; the last line is clipped with an ellipsis.
function wrap(s: string, width: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (next.length <= width || !cur) { cur = next; continue; }
    if (lines.length === maxLines - 1) return [...lines, clip(`${cur} ${words.slice(i).join(' ')}`, width)];
    lines.push(cur);
    cur = words[i];
  }
  if (cur) lines.push(clip(cur, width));
  return lines;
}

type Props = { scene: Scene; data: SceneData; onOpen: (id: StationId) => void; selected: StationId | null };

export function FloorScene({ scene, data, onOpen, selected }: Props) {
  const { stations, active } = scene;
  const activeIdx = FLOW.indexOf(active);
  const activeState = stations[active].state;

  // Packet keyframes: only an advance of the active station moves the packet.
  const prev = useRef<FlowId>(active);
  const [kf, setKf] = useState(() => [entry(active)]);
  useEffect(() => {
    if (prev.current !== active) setKf(route(prev.current, active));
    prev.current = active;
  }, [active]);
  const hops = Math.max(1, kf.length - 1);

  const tier = data.apiVersion?.tier ?? data.api?.tier ?? 0;
  const b = data.budget;
  const gauge = b && b.capCents > 0 ? Math.min(1, (b.reservedCents + b.spentCents) / b.capCents) : 0;
  const delivered = stations.delivered.state === 'done' || stations.delivered.state === 'working';

  return (
    <div className="floor-wrap">
      <svg className="floor" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Forge floor for order ${data.order.id}`} data-testid="floor">
        <defs>
          <pattern id="iso" width="80" height="40" patternUnits="userSpaceOnUse">
            <path d="M0 20 L40 0 L80 20 L40 40 Z" fill="none" stroke="#2a2620" strokeWidth="1" />
          </pattern>
          <radialGradient id="floorGlow" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor="#221d17" />
            <stop offset="100%" stopColor="#141210" />
          </radialGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="packet">
            <stop offset="0%" stopColor="#fff6d6" />
            <stop offset="45%" stopColor="#ffc24a" />
            <stop offset="100%" stopColor="#ff7a2f" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width={W} height={H} rx="18" fill="url(#floorGlow)" />
        <rect x="0" y="0" width={W} height={H} rx="18" fill="url(#iso)" opacity="0.9" />

        {/* back office platform */}
        <rect x={290} y={356} width={820} height={258} rx="20" fill="#1a1815" stroke="#2f2a22" strokeDasharray="6 8" />
        <text x={310} y={386} className="floor-note">BACK OFFICE</text>

        {/* return conveyor: delivery goes back to the customer's chat */}
        <Pipe a={anchor('delivered')} b={anchor('customer')} state={delivered ? 'done' : 'idle'} dashed />
        <text x={176} y={520} className="floor-note" transform="rotate(-90 176 520)">BACK TO CHAT</text>

        {FLOW.slice(1).map((id, k) => {
          const j = k + 1;
          const st: PipeState = j < activeIdx ? 'done' : j === activeIdx ? (activeState === 'working' ? 'hot' : stations[id].state === 'done' ? 'done' : 'lit') : 'idle';
          return <Pipe key={id} a={anchor(FLOW[k])} b={anchor(id)} state={st} />;
        })}

        <motion.g
          initial={false}
          animate={{ x: kf.map((p) => p.x), y: kf.map((p) => p.y) }}
          transition={{ duration: 0.55 * hops, ease: 'easeInOut' }}
          data-testid="packet"
        >
          <circle r="26" fill="url(#packet)" />
          <circle r="9" fill="#fff1c2" />
        </motion.g>

        {(Object.keys(POS) as StationId[]).map((id) => (
          <Station
            key={id} id={id} view={stations[id]} selected={selected === id} onOpen={onOpen}
            side={id === 'cfo' || id === 'droid' || id === 'treasurer'}
            icon={<Icon id={id} tier={tier} gauge={gauge} awake={stations.droid.state === 'working'} />}
          />
        ))}
      </svg>
      <div className="floor-legend">
        {(['working', 'done', 'waiting', 'rejected', 'idle'] as SState[]).map((s) => (
          <span key={s}><i style={{ background: STATE_COLOR[s] }} />{s === 'rejected' ? 'rejected / failed' : s}</span>
        ))}
        <span className="muted">click a station for its details</span>
      </div>
    </div>
  );
}

type PipeState = 'idle' | 'lit' | 'done' | 'hot';

function Pipe({ a, b, state, dashed }: { a: { x: number; y: number }; b: { x: number; y: number }; state: PipeState; dashed?: boolean }) {
  const d = `M${a.x} ${a.y} L${b.x} ${b.y}`;
  const inner = state === 'done' ? '#e9a93a' : state === 'hot' ? '#ff7a2f' : state === 'lit' ? '#c98a3a' : '#363b45';
  return (
    <g>
      <path d={d} stroke="#0d0c0b" strokeWidth={22} strokeLinecap="round" opacity={dashed ? 0.6 : 1} />
      <path d={d} stroke="#2b2e35" strokeWidth={16} strokeLinecap="round" opacity={dashed ? 0.6 : 1} />
      <path d={d} stroke={inner} strokeWidth={dashed ? 4 : 6} strokeLinecap="round" strokeDasharray={dashed ? '10 12' : undefined}
        filter={state === 'hot' || state === 'done' ? 'url(#glow)' : undefined} opacity={state === 'idle' ? 0.8 : 1} />
      {state === 'hot' && (
        <motion.path d={d} stroke="#ffd27a" strokeWidth={4} strokeLinecap="round" strokeDasharray="6 26"
          animate={{ strokeDashoffset: [0, -64] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }} />
      )}
    </g>
  );
}

function Station({ id, view, selected, onOpen, side, icon }: { id: StationId; view: StationView; selected: boolean; onOpen: (id: StationId) => void; side: boolean; icon: ReactNode }) {
  const { x, y } = POS[id];
  const w = side ? SIDE_BLOCK : BLOCK;
  const a = w / 2;
  const bb = w / 4;
  const h = BLOCK_H;
  const meta = STATION_META[id];
  const color = STATE_COLOR[view.state];
  const dim = view.state === 'idle' || view.state === 'skipped';
  const top = `${x},${y - bb} ${x + a},${y} ${x},${y + bb} ${x - a},${y}`;
  const left = `${x - a},${y} ${x},${y + bb} ${x},${y + bb + h} ${x - a},${y + h}`;
  const right = `${x},${y + bb} ${x + a},${y} ${x + a},${y + h} ${x},${y + bb + h}`;
  const sub = view.state === 'working' || view.state === 'skipped' ? '' : durationText(view.start, view.end);
  const labelY = y + bb + h + 32;
  const caption = view.caption || (view.state === 'idle' ? 'idle' : '');
  const tip = [meta.name, meta.role, view.detail || view.caption].filter(Boolean).join('\n');

  return (
    <g
      className={`station st-${view.state} ${selected ? 'sel' : ''}`} role="button" tabIndex={0} aria-label={`${meta.name}: ${view.state}`}
      onClick={() => onOpen(id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(id)}
      data-testid={`station-${id}`} data-state={view.state} opacity={dim ? (view.state === 'skipped' ? 0.42 : 0.55) : 1}
    >
      <title>{tip}</title>
      {view.state === 'working' && (
        <motion.ellipse cx={x} cy={y + h / 2 + 6} rx={a + 26} ry={bb + 22} fill={color} filter="url(#glow)"
          initial={{ opacity: 0.18 }} animate={{ opacity: [0.18, 0.5, 0.18] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} />
      )}
      {(view.state === 'done' || view.state === 'rejected' || view.state === 'failed' || view.state === 'waiting') && (
        <ellipse cx={x} cy={y + h / 2 + 6} rx={a + 18} ry={bb + 16} fill={color} opacity={0.13} />
      )}
      <polygon points={left} fill="#24262c" stroke="#0e0d0c" strokeWidth={1.5} />
      <polygon points={right} fill="#1b1d22" stroke="#0e0d0c" strokeWidth={1.5} />
      <polygon points={top} fill={dim ? '#34373f' : '#3a3d46'} stroke={selected ? '#ffe2a0' : color} strokeWidth={selected ? 4 : 2.5} />
      {/* state strip on the front edge */}
      <polyline points={`${x - a},${y + h - 4} ${x},${y + bb + h - 4} ${x + a},${y + h - 4}`} fill="none" stroke={color} strokeWidth={4} opacity={dim ? 0.5 : 0.95} />
      <g transform={`translate(${x} ${y - 8})`}>{icon}</g>
      {id === 'droid' && view.state === 'working' && <Sparks x={x} y={y - 20} />}

      <StateBadge x={x + a - 6} y={y - bb + 4} state={view.state} />
      <AnimatePresence initial={false}>
        {view.stamp && (view.state === 'rejected' || view.state === 'done' || view.state === 'waiting') && (
          <motion.g key={view.stamp} initial={{ opacity: 0, scale: 2.2 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}
            style={{ originX: `${x}px`, originY: `${y}px` }}>
            <g transform={`rotate(-12 ${x} ${y + 4})`}>
              <rect x={x - 62} y={y - 14} width={124} height={36} rx={5} fill="#17140f" fillOpacity={0.75} stroke={stampColor(view.stamp)} strokeWidth={3.5} />
              <text x={x} y={y + 12} textAnchor="middle" className="stamp" fill={stampColor(view.stamp)}>{view.stamp === 'COUNTEROFFER' ? 'COUNTER' : view.stamp}</text>
            </g>
          </motion.g>
        )}
      </AnimatePresence>

      <text x={x} y={labelY} textAnchor="middle" className="st-name">{meta.name}</text>
      <SponsorTag x={x} y={labelY + 10} label={meta.sponsor} />
      <text x={x} y={labelY + 66} textAnchor="middle" className="st-cap" fill={dim ? '#9a958c' : view.state === 'rejected' || view.state === 'failed' ? '#ff9c8f' : '#ece6da'}>
        {wrap(caption, 23, side ? 1 : 2).map((line, i) => <tspan key={i} x={x} dy={i ? 27 : 0}>{line}</tspan>)}
      </text>
      {sub && <text x={x + a + 10} y={y - 8} className="st-sub">{sub}</text>}
    </g>
  );
}


const stampColor = (s: NonNullable<StationView['stamp']>) => (s === 'ACCEPT' ? '#5fe0a0' : s === 'REJECT' ? '#ff5a5a' : '#ffbe4a');

function SponsorTag({ x, y, label }: { x: number; y: number; label: string }) {
  const w = label.length * 9.6 + 22;
  const c = SPONSOR_COLOR[label] ?? '#ccc';
  return (
    <g>
      <rect x={x - w / 2} y={y} width={w} height={26} rx={13} fill="#121110" stroke={c} strokeWidth={1.5} />
      <text x={x} y={y + 19} textAnchor="middle" className="st-sponsor" fill={c}>{label}</text>
    </g>
  );
}

function StateBadge({ x, y, state }: { x: number; y: number; state: SState }) {
  if (state === 'idle' || state === 'skipped') return null;
  const c = STATE_COLOR[state];
  return (
    <motion.g initial={false} animate={{ scale: 1 }} style={{ originX: `${x}px`, originY: `${y}px` }}>
      <circle cx={x} cy={y} r={15} fill="#141210" stroke={c} strokeWidth={3} />
      {state === 'done' && <path d={`M${x - 7} ${y} l5 5 l9 -10`} stroke={c} strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {(state === 'rejected' || state === 'failed') && <path d={`M${x - 6} ${y - 6} l12 12 M${x + 6} ${y - 6} l-12 12`} stroke={c} strokeWidth={3.5} strokeLinecap="round" />}
      {state === 'waiting' && <path d={`M${x} ${y - 7} v8 M${x} ${y + 6} v0.5`} stroke={c} strokeWidth={3.5} strokeLinecap="round" />}
      {state === 'working' && (
        <motion.circle cx={x} cy={y} r={5} fill={c} animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
      )}
    </motion.g>
  );
}

function Sparks({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {[-22, -6, 12, 26].map((dx, i) => (
        <motion.circle key={i} cx={x + dx} cy={y} r={3} fill="#ffd27a"
          animate={{ cy: [y, y - 46 - i * 6], cx: [x + dx, x + dx * 1.8], opacity: [1, 0] }}
          transition={{ duration: 0.9 + i * 0.15, repeat: Infinity, delay: i * 0.2, ease: 'easeOut' }} />
      ))}
    </g>
  );
}

const INK = '#efe9dd';

function Icon({ id, tier, gauge, awake }: { id: StationId; tier: number; gauge: number; awake: boolean }) {
  const s = { stroke: INK, strokeWidth: 3, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'customer':
      return <g><path d="M-26 -50 h52 a8 8 0 0 1 8 8 v24 a8 8 0 0 1 -8 8 h-30 l-12 10 v-10 h-10 a8 8 0 0 1 -8 -8 v-24 a8 8 0 0 1 8 -8z" {...s} fill="#2b2f38" /><circle cx={-12} cy={-30} r={3} fill={INK} /><circle cx={0} cy={-30} r={3} fill={INK} /><circle cx={12} cy={-30} r={3} fill={INK} /></g>;
    case 'desk':
      return <g><path d="M-22 -12 a22 22 0 0 1 44 0z" {...s} fill="#3a3326" /><path d="M-30 -10 h60" {...s} /><circle cx={0} cy={-38} r={4} fill={INK} /></g>;
    case 'coo':
      return <g><rect x={-20} y={-52} width={40} height={48} rx={5} {...s} fill="#2c2f38" /><rect x={-9} y={-57} width={18} height={9} rx={3} fill={INK} /><path d="M-11 -36 l5 5 l9 -9 M-11 -20 h22" {...s} /></g>;
    case 'research':
      return <g><circle cx={-4} cy={-32} r={16} {...s} fill="#22313a" /><path d="M8 -20 l16 16" {...s} strokeWidth={5} /><ellipse cx={-4} cy={-32} rx={7} ry={7} stroke="#3fd0c0" strokeWidth={2.5} fill="none" /></g>;
    case 'apify':
      return (
        <g>
          <path d="M-32 -6 h64 M-32 -36 h64 M-28 -6 v-46 M28 -6 v-46" {...s} />
          <rect x={-20} y={-30} width={22} height={22} rx={2} fill={tier >= 1 ? '#e8b923' : '#b87333'} stroke="#140f08" strokeWidth={2} />
          <rect x={6} y={-30} width={16} height={22} rx={2} fill="#4d5260" stroke="#140f08" strokeWidth={2} />
          <rect x={-14} y={-58} width={20} height={20} rx={2} fill="#4d5260" stroke="#140f08" strokeWidth={2} />
          <text x={-9} y={-14} textAnchor="middle" fontSize={11} fontWeight={800} fill="#1a1206">T{tier}</text>
        </g>
      );
    case 'verify':
      return <g><ellipse cx={0} cy={-30} rx={22} ry={28} stroke="#3fd0c0" strokeWidth={4} fill="#0f2a2a" /><ellipse cx={0} cy={-30} rx={12} ry={17} stroke="#7ff0e2" strokeWidth={2} fill="none" /><path d="M-6 -30 l4 4 l8 -9" {...s} /></g>;
    case 'auditor':
      return <g><path d="M-26 -4 v-40 M26 -4 v-40 M-30 -44 h60" {...s} strokeWidth={4} /><rect x={-10} y={-34} width={20} height={14} rx={2} fill={INK} /><path d="M-4 -34 v-10 h8 v10" {...s} /></g>;
    case 'delivered':
      return <g><rect x={-22} y={-44} width={44} height={36} rx={3} {...s} fill="#3a2f22" /><path d="M0 -44 v36 M-22 -32 h44" {...s} stroke="#e9a93a" /></g>;
    case 'cfo': {
      const ang = Math.PI * (1 - gauge);
      return (
        <g>
          <rect x={-24} y={-52} width={48} height={46} rx={6} {...s} fill="#2a2d35" />
          <path d="M-14 -22 a14 14 0 0 1 28 0" stroke="#4a4f5c" strokeWidth={5} fill="none" />
          {gauge > 0 && <path d={`M-14 -22 A14 14 0 0 1 ${(14 * Math.cos(ang)).toFixed(2)} ${(-22 - 14 * Math.sin(ang)).toFixed(2)}`} stroke={gauge > 0.85 ? '#ef4f4f' : '#e9a93a'} strokeWidth={5} fill="none" />}
          <circle cx={0} cy={-22} r={3} fill={INK} />
        </g>
      );
    }
    case 'droid':
      return <g><path d="M-30 -36 h46 a14 14 0 0 1 -12 12 h-6 v10 h12 v6 h-36 v-6 h12 v-10 h-6 a12 12 0 0 1 -10 -12z" {...s} fill={awake ? '#5a3a1e' : '#2d3038'} />{!awake && <text x={22} y={-44} fontSize={15} fill="#9aa3b5" fontWeight={700}>z z</text>}</g>;
    case 'treasurer':
      return <g>{[0, 1, 2].map((i) => <ellipse key={i} cx={0} cy={-10 - i * 11} rx={18} ry={6} stroke="#e9c35a" strokeWidth={3} fill="#3a3220" />)}</g>;
  }
}
