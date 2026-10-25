import type { Timestamp } from 'spacetimedb';
import type {
  Api, ApiVersion, Approval, Bonus, Books, Budget, Challenge, CompileJob, Customer, Event, Evidence, GateCheck, Orders, Run, RunCost, Task, Ticket, ValueRecord,
} from './module_bindings/types';
import { micros, payloadObj, usd } from './format';

export const FLOW = ['customer', 'desk', 'coo', 'research', 'apify', 'verify', 'auditor', 'delivered'] as const;
export const SIDE = ['cfo', 'droid', 'treasurer'] as const;
export type FlowId = (typeof FLOW)[number];
export type SideId = (typeof SIDE)[number];
export type StationId = FlowId | SideId;
export type SState = 'idle' | 'waiting' | 'working' | 'done' | 'rejected' | 'failed' | 'skipped';

export type StationView = {
  id: StationId;
  state: SState;
  caption: string;
  // Full text behind a truncated caption (decision reasons are long).
  detail?: string;
  start?: Timestamp;
  end?: Timestamp;
  stamp?: 'ACCEPT' | 'REJECT' | 'COUNTEROFFER';
};

export const STATION_META: Record<StationId, { name: string; sponsor: string; role: string }> = {
  customer: { name: 'Customer', sponsor: 'ASI:One', role: 'The request arrives at the counter' },
  desk: { name: 'Front Desk', sponsor: 'Fetch.ai', role: 'Parses intent, runs the instant gate checks, quotes and takes payment' },
  coo: { name: 'COO', sponsor: 'CREAO', role: 'Dispatcher: accept, counteroffer, research or reject' },
  research: { name: 'Research', sponsor: 'CREAO + Bright Data', role: 'Scout: robots.txt, cited terms, reachability, volatility (new requests only)' },
  apify: { name: 'Warehouse', sponsor: 'Apify', role: 'Runs the API engine: forge-extract Task (Tier 0) or compiled Actor (Tier 1)' },
  verify: { name: 'Verify portal', sponsor: 'Bright Data', role: 'Independent re-fetch of every source and quote check' },
  auditor: { name: 'Auditor', sponsor: 'CREAO', role: 'Inspection gate: stamps ACCEPT or REJECT with a reason' },
  delivered: { name: 'Delivered', sponsor: 'ASI:One', role: 'Data back to the customer in chat; challenges land here' },
  cfo: { name: 'CFO vault', sponsor: 'CREAO', role: 'Invests in compiles from the engineering budget' },
  droid: { name: 'Droid anvil', sponsor: 'Factory', role: 'Compiles Tier 1 Actors and fixes extractor errors' },
  treasurer: { name: 'Treasurer', sponsor: 'SpacetimeDB', role: 'Reducers move money in the double-entry ledger' },
};

export type SceneData = {
  order: Orders;
  orderEvents: Event[]; // ascending by id
  customer?: Customer;
  api?: Api;
  apiVersion?: ApiVersion;
  gates: GateCheck[];
  values: ValueRecord[];
  evidence: Evidence[];
  runs: Run[]; // runs tied to this order (Apify by threadId, CREAO by task)
  tasks: Task[]; // tasks for this order
  challenges: Challenge[];
  runCosts: RunCost[];
  bonuses: Bonus[];
  books: Books[];
  isCanary: boolean;
  budget?: Budget;
  approvals: readonly Approval[];
  tickets: readonly Ticket[];
  allTasks: readonly Task[];
};

export const DESK_CHECKS = new Set(['layer2', 'personal_data', 'blocked_domain', 'blocked_domains', 'page_cap', 'login_only']);
const OPEN_TASK = new Set(['queued', 'claimed']);
const ENGINEERING_KINDS = new Set(['compile', 'enhancement', 'warranty']);

const lastEvent = (evs: Event[], pred: (e: Event) => boolean) => {
  for (let i = evs.length - 1; i >= 0; i--) if (pred(evs[i])) return evs[i];
  return undefined;
};
const firstEvent = (evs: Event[], pred: (e: Event) => boolean) => evs.find(pred);
const reasonOf = (e?: Event) => {
  const r = e ? payloadObj(e.payload).reason : undefined;
  return typeof r === 'string' ? r : '';
};
// Decision reasons start with "ACCEPT:" / "REJECT:"; the caption already says that.
const trimVerdict = (s: string) => s.replace(/^(ACCEPT|REJECT|COUNTEROFFER)\s*[:\-—]\s*/i, '');

export function durationText(a?: Timestamp, b?: Timestamp): string {
  if (!a || !b) return '';
  const s = Number(micros(b) - micros(a)) / 1e6;
  if (s < 0) return '';
  if (s < 0.1) return '<0.1 s';
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 90) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ${Math.round(s - m * 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const microsUsd = (m: bigint | number) => {
  const d = Number(m) / 1e6;
  return d >= 0.1 ? `$${d.toFixed(2)}` : `$${d.toFixed(4)}`;
};

function countsText(counts: Record<string, number>): { verified: number; total: number; text: string } {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const verified = counts.verified ?? 0;
  const others = Object.entries(counts).filter(([k, n]) => k !== 'verified' && n > 0).map(([k, n]) => `${n} ${k}`);
  return { verified, total, text: `${verified}/${total} verified${others.length ? ` · ${others.join(', ')}` : ''}` };
}

// The verify step's own fetches, excluding later challenge rechecks of the same order.
export function verifyEvidence(d: SceneData): Evidence[] {
  const done = firstEvent(d.orderEvents, (e) => e.kind === 'values_verified');
  if (!done) return d.evidence;
  return d.evidence.filter((x) => micros(x.fetchedAt) <= micros(done.at));
}

export type Scene = { stations: Record<StationId, StationView>; active: FlowId; researchUsed: boolean };

export function buildScene(d: SceneData): Scene {
  const { order: o, orderEvents: ev } = d;
  const st = {} as Record<StationId, StationView>;
  const kind = (k: string) => lastEvent(ev, (e) => e.kind === k);
  const status = o.status;

  // Customer
  st.customer = { id: 'customer', state: 'done', caption: o.requestText || '(no request text)', detail: o.requestText, start: o.createdAt };

  // Front Desk (Fetch)
  const paid = kind('order_paid');
  const deskReject = kind('order_rejected_at_desk');
  const deskFail = d.gates.find((g) => DESK_CHECKS.has(g.check) && g.result === 'fail');
  if (status === 'rejected_at_desk' || deskReject) {
    const why = deskFail?.citationText || reasonOf(deskReject);
    st.desk = { id: 'desk', state: 'rejected', stamp: 'REJECT', caption: `Gate: ${deskFail?.check.replace(/_/g, ' ') ?? 'rejected'}`, detail: why, start: o.createdAt, end: deskReject?.at ?? o.updatedAt };
  } else if (paid) {
    st.desk = { id: 'desk', state: 'done', caption: `Paid ${usd(o.priceCents)}`, start: o.createdAt, end: paid.at };
  } else {
    st.desk = { id: 'desk', state: 'waiting', caption: `Quoted ${usd(o.priceCents)}, unpaid`, start: o.createdAt };
  }

  // COO (CREAO)
  const cooTasks = d.tasks.filter((t) => t.role === 'coo');
  const cooDecision = lastEvent(ev, (e) => e.kind === 'coo_accepted' || e.kind === 'coo_rejected' || e.kind === 'coo_counteroffered' || e.kind === 'coo_requested_research');
  const researchUsed = ev.some((e) => e.kind.includes('research')) || status === 'researching' || d.gates.some((g) => !DESK_CHECKS.has(g.check));
  const cooOpen = cooTasks.some((t) => OPEN_TASK.has(t.status));
  if (!paid) {
    st.coo = { id: 'coo', state: 'idle', caption: '' };
  } else if (cooDecision && !(cooOpen && cooDecision.kind === 'coo_requested_research' && status !== 'researching')) {
    const r = reasonOf(cooDecision);
    const p = payloadObj(cooDecision.payload);
    if (cooDecision.kind === 'coo_accepted') st.coo = { id: 'coo', state: 'done', stamp: 'ACCEPT', caption: `ACCEPT ${typeof p.api === 'string' ? p.api : d.api?.name ?? ''}`, detail: r };
    else if (cooDecision.kind === 'coo_rejected') st.coo = { id: 'coo', state: 'rejected', stamp: 'REJECT', caption: `REJECT: ${trimVerdict(r)}`, detail: r };
    else if (cooDecision.kind === 'coo_counteroffered') st.coo = { id: 'coo', state: 'waiting', stamp: 'COUNTEROFFER', caption: `COUNTEROFFER: ${trimVerdict(r)}`, detail: r };
    else st.coo = { id: 'coo', state: 'done', caption: 'REQUEST_RESEARCH', detail: r };
    st.coo.start = paid.at;
    st.coo.end = cooDecision.at;
  } else {
    const claimed = cooTasks.some((t) => t.status === 'claimed');
    st.coo = { id: 'coo', state: 'working', caption: claimed ? 'CREAO run deciding…' : 'Queued for a CREAO run', start: paid.at };
  }

  // Research (CREAO + Bright Data), only for new requests
  const layer3 = d.gates.filter((g) => !DESK_CHECKS.has(g.check));
  const g3 = layer3.reduce<Record<string, number>>((m, g) => ((m[g.result] = (m[g.result] ?? 0) + 1), m), {});
  const g3text = Object.entries(g3).map(([k, n]) => `${n} ${k}`).join(', ');
  const researchStart = firstEvent(ev, (e) => e.kind === 'coo_requested_research');
  if (!researchUsed) {
    st.research = { id: 'research', state: 'skipped', caption: o.apiId !== undefined || cooDecision ? 'Existing API: not needed' : '' };
  } else if (status === 'researching') {
    st.research = { id: 'research', state: 'working', caption: layer3.length ? `Checking… ${g3text}` : 'Scouting the source…', start: researchStart?.at };
  } else {
    const end = lastEvent(ev, (e) => e.kind.startsWith('research'));
    st.research = { id: 'research', state: 'done', caption: layer3.length ? `${layer3.length} checks: ${g3text}` : 'Report filed', start: researchStart?.at, end: end?.at };
  }

  // Apify warehouse
  const runStarted = firstEvent(ev, (e) => e.kind === 'api_run_started');
  const ingested = firstEvent(ev, (e) => e.kind === 'api_run_ingested');
  const tier = d.apiVersion?.tier ?? d.api?.tier ?? 0;
  const engine = d.apiVersion?.engine === 'actor' ? 'compiled Actor' : 'forge-extract Task';
  if (ingested) {
    const p = payloadObj(ingested.payload);
    const n = typeof p.values === 'number' ? p.values : d.values.length;
    st.apify = { id: 'apify', state: 'done', caption: `${n} values extracted`, start: runStarted?.at, end: ingested.at };
  } else if (runStarted) {
    st.apify = { id: 'apify', state: 'working', caption: `${engine} running · Tier ${tier}`, start: runStarted.at };
  } else {
    st.apify = { id: 'apify', state: 'idle', caption: d.api ? `${d.api.name} · Tier ${tier}` : '' };
  }

  // Bright Data verification
  const verified = firstEvent(ev, (e) => e.kind === 'values_verified');
  const vEvidence = verifyEvidence(d);
  const fetchMs = vEvidence.reduce((s, x) => s + x.ms, 0);
  if (verified) {
    const p = payloadObj(verified.payload);
    const counts = (p.counts && typeof p.counts === 'object' ? p.counts : {}) as Record<string, number>;
    const c = countsText(counts);
    const fetches = `${vEvidence.length} fetch${vEvidence.length === 1 ? '' : 'es'}`;
    st.verify = {
      id: 'verify', state: c.total > 0 && c.verified === 0 ? 'failed' : 'done',
      caption: `${c.verified}/${c.total} verified · ${fetches}`, detail: `${c.text} · ${fetches}, ${(fetchMs / 1000).toFixed(1)} s of fetching`, start: ingested?.at, end: verified.at,
    };
  } else if (ingested) {
    st.verify = { id: 'verify', state: 'working', caption: vEvidence.length ? `Re-fetching… ${vEvidence.length} fetch${vEvidence.length === 1 ? '' : 'es'}` : 'Re-fetching sources…', start: ingested.at };
  } else {
    st.verify = { id: 'verify', state: 'idle', caption: '' };
  }

  // Auditor (CREAO)
  const auditDone = lastEvent(ev, (e) => e.kind === 'audit_accepted' || e.kind === 'audit_rejected');
  const auditSkipped = kind('audit_skipped_canary');
  if (auditDone) {
    const r = reasonOf(auditDone);
    const ok = auditDone.kind === 'audit_accepted';
    st.auditor = { id: 'auditor', state: ok ? 'done' : 'rejected', stamp: ok ? 'ACCEPT' : 'REJECT', caption: trimVerdict(r) || (ok ? 'ACCEPT' : 'REJECT'), detail: r, start: verified?.at, end: auditDone.at };
  } else if (auditSkipped) {
    st.auditor = { id: 'auditor', state: 'skipped', caption: 'Canary: audit skipped', start: verified?.at, end: auditSkipped.at };
  } else if (verified) {
    const claimed = d.tasks.some((t) => t.kind === 'audit' && t.status === 'claimed');
    st.auditor = { id: 'auditor', state: 'working', caption: claimed ? 'CREAO run inspecting…' : 'Queued for a CREAO run', start: verified.at };
  } else {
    st.auditor = { id: 'auditor', state: 'idle', caption: '' };
  }

  // Delivered (back to ASI:One)
  const openCh = d.challenges.filter((c) => !c.resolvedAt);
  const upheld = d.challenges.filter((c) => c.status === 'upheld').length;
  const chText = d.challenges.length ? ` · ${d.challenges.length} challenge${d.challenges.length === 1 ? '' : 's'}${upheld ? `, ${upheld} upheld` : ''}` : '';
  if (status === 'delivered') {
    const rows = new Set(d.values.map((v) => v.row)).size;
    st.delivered = {
      id: 'delivered', state: openCh.length ? 'working' : 'done',
      caption: openCh.length ? `Challenge: ${openCh[0].status}…` : `${rows} row${rows === 1 ? '' : 's'} in chat${chText}`,
      start: auditDone?.at,
    };
  } else {
    st.delivered = { id: 'delivered', state: 'idle', caption: '' };
  }

  // A failed order stops at the first station that had not finished.
  if (status === 'failed') {
    const why = reasonOf(kind('order_failed')) || o.decisionReason;
    const at = FLOW.find((id) => !['done', 'skipped'].includes(st[id].state)) ?? 'delivered';
    st[at] = { ...st[at], state: 'failed', caption: `Failed: ${why}`, detail: why, end: o.updatedAt };
  }

  // Everything after a rejection stays dark.
  const stop = FLOW.findIndex((id) => ['rejected', 'failed'].includes(st[id].state) || (st[id].state === 'waiting' && id !== 'desk'));
  if (stop >= 0) for (const id of FLOW.slice(stop + 1)) if (st[id].state !== 'skipped') st[id] = { ...st[id], state: 'idle', caption: '' };

  // Side stations
  const b = d.budget;
  const cfoTasks = d.allTasks.filter((t) => t.role === 'cfo' && OPEN_TASK.has(t.status));
  const overCap = d.approvals.filter((a) => a.kind === 'spend_over_cap' && a.status === 'pending').length;
  st.cfo = {
    id: 'cfo', state: cfoTasks.length ? 'working' : overCap ? 'waiting' : 'idle',
    caption: b ? `cap ${usd(b.capCents)} · used ${usd(b.reservedCents + b.spentCents)}` : 'No budget row',
    detail: cfoTasks.length ? 'CFO run reviewing a compile' : overCap ? `${overCap} spend-over-cap approval pending` : undefined,
  };

  const droidTasks = d.allTasks.filter((t) => t.role === 'droid_runner' && ENGINEERING_KINDS.has(t.kind));
  const awake = droidTasks.find((t) => t.status === 'claimed');
  const queued = droidTasks.filter((t) => t.status === 'queued');
  const compileTickets = d.tickets.filter((t) => ['compile', 'warranty'].includes(t.label) && t.status === 'open');
  st.droid = awake
    ? { id: 'droid', state: 'working', caption: `Droid is awake: ${awake.kind} #${awake.id}`, start: awake.updatedAt }
    : queued.length
      ? { id: 'droid', state: 'waiting', caption: `${queued.length} ${queued[0].kind} task${queued.length === 1 ? '' : 's'} queued` }
      : { id: 'droid', state: 'idle', caption: 'No engineering queued', detail: compileTickets.length ? `${compileTickets.length} compile/warranty ticket${compileTickets.length === 1 ? '' : 's'} open, no engineering task claimed` : undefined };

  const cost = d.runCosts.reduce((s, r) => s + r.totalMicros, 0n);
  const bonus = d.bonuses.filter((x) => x.status !== 'clawed_back').reduce((s, x) => s + x.amountCents, 0);
  const clawed = d.bonuses.filter((x) => x.status === 'clawed_back').length;
  const parts = [paid ? `${usd(o.priceCents)} in` : '', d.runCosts.length ? `${microsUsd(cost)} cost` : ''].filter(Boolean);
  const extra = [d.bonuses.length ? `bonuses ${usd(bonus)}` : '', clawed ? `${clawed} clawed back` : ''].filter(Boolean).join(' · ');
  st.treasurer = { id: 'treasurer', state: d.runCosts.length || d.bonuses.length ? 'done' : 'idle', caption: parts.length ? parts.join(' · ') : 'No ledger moves yet', detail: [parts.join(' · '), extra].filter(Boolean).join(' · ') || undefined };

  // The packet sits at the first station still in play, or at Delivered once everything is through.
  const active = FLOW.find((id) => !['done', 'skipped'].includes(st[id].state)) ?? 'delivered';
  return { stations: st, active: st[active].state === 'idle' ? lastLit(st) : active, researchUsed };
}

function lastLit(st: Record<StationId, StationView>): FlowId {
  let last: FlowId = 'customer';
  for (const id of FLOW) if (st[id].state !== 'idle' && st[id].state !== 'skipped') last = id;
  return last;
}

const BUILDING = new Set(['compiling', 'auditing', 'rework']);
const WAITING_FOUNDER = new Set(['awaiting_approval', 'ship_pending']);
const DAY_MICROS = 86_400_000_000n;

// The Droid station reads the compile jobs of live APIs, not task rows: a job's status says whether Droid is building,
// blocked on the founder or on the cap, or has nothing queued.
export function droidStationView(jobs: readonly CompileJob[], apiName: (apiId: bigint) => string | undefined, retired: ReadonlySet<bigint>): StationView {
  const live = jobs.filter((j) => !retired.has(j.apiId)).sort((a, b) => (a.ticketId > b.ticketId ? -1 : 1));
  const name = (j: CompileJob) => apiName(j.apiId) ?? `API ${j.apiId}`;
  const building = live.find((j) => BUILDING.has(j.status) || j.status === 'shipping');
  if (building) {
    if (building.status === 'shipping') return { id: 'droid', state: 'working', caption: `Publishing ${name(building)}`, detail: `Publishing ${name(building)} to Apify`, start: building.updatedAt };
    const n = building.status === 'rework' ? building.attempt + 1 : building.attempt;
    const caption = `Building ${name(building)} · attempt ${n}`;
    return { id: 'droid', state: 'working', caption, detail: `${caption} (compile ticket #${building.ticketId}, ${building.status.replace(/_/g, ' ')})`, start: building.updatedAt };
  }
  const founder = live.find((j) => WAITING_FOUNDER.has(j.status));
  if (founder) return { id: 'droid', state: 'waiting', caption: 'Waiting for founder approval', detail: `Compile ticket #${founder.ticketId} for ${name(founder)}: ${founder.status === 'ship_pending' ? 'publish' : 'spend over the cap'} approval pending` };
  const blocked = live.find((j) => j.status === 'ineligible');
  if (blocked) return { id: 'droid', state: 'waiting', caption: 'Blocked: over the engineering cap', detail: `Compile ticket #${blocked.ticketId} for ${name(blocked)} no longer fits the engineering cap` };
  const queued = live.filter((j) => j.status === 'queued');
  if (queued.length) return { id: 'droid', state: 'waiting', caption: `${queued.length} build${queued.length === 1 ? '' : 's'} queued`, detail: queued.map((j) => `#${j.ticketId} ${name(j)}`).join(', ') };
  return { id: 'droid', state: 'idle', caption: 'No engineering queued' };
}

// The Droid → Warehouse pipe lights while a compiled version is being published and for a day after it ships.
export function shipPipeLit(jobs: readonly CompileJob[], retired: ReadonlySet<bigint>, nowMicros: bigint): boolean {
  return jobs.some((j) => !retired.has(j.apiId) && (j.status === 'shipping' || (j.status === 'shipped' && nowMicros - micros(j.updatedAt) < DAY_MICROS)));
}
