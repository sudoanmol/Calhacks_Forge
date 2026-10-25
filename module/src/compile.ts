// Pure rules behind flow C (AGENTS.md §3 compile triggers, §6 C). No database access, so they can be
// unit tested; index.ts feeds them rows and applies the result.

export type RunCounts = { orderId: bigint; verified: number; total: number };

export type TriggerInput = {
  buyers: number;
  minBuyers: number; // compile_min_buyers; below 1 turns the buyers trigger off
  runs: RunCounts[]; // newest first, already limited to the window
  window: number; // compile_window_runs; below 1 turns the verified-rate trigger off
  minVerifiedRate: number; // compile_min_verified_rate
};

export type Trigger = { trigger: 'verified_rate' | 'buyers'; detail: Record<string, unknown> };

// The verified-rate trigger needs a full window of runs, so one odd run does not open a compile.
export function evaluateTriggers(i: TriggerInput): Trigger | null {
  const verified = i.runs.reduce((s, r) => s + r.verified, 0);
  const total = i.runs.reduce((s, r) => s + r.total, 0);
  const rate = total ? verified / total : 0;
  const detail = {
    buyers: i.buyers, minBuyers: i.minBuyers, window: i.window, runs: i.runs.length,
    verified, total, verifiedRate: Math.round(rate * 10_000) / 10_000, minVerifiedRate: i.minVerifiedRate,
    orderIds: i.runs.map((r) => r.orderId.toString()),
  };
  if (i.window >= 1 && i.runs.length >= i.window && total > 0 && rate < i.minVerifiedRate) return { trigger: 'verified_rate', detail };
  if (i.minBuyers >= 1 && i.buyers >= i.minBuyers) return { trigger: 'buyers', detail };
  return null;
}

// Versions are additive only (AGENTS.md §2 rule 10): every field of the previous version must survive.
export function droppedFields(previous: string[], next: string[]): string[] {
  const keep = new Set(next);
  return previous.filter((f) => !keep.has(f));
}

export function parseFields(json: string): string[] {
  let v: unknown;
  try { v = JSON.parse(json); } catch { throw new Error('fields must be a JSON array of field names'); }
  if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === 'string' && x.trim())) {
    throw new Error('fields must be a non-empty JSON array of field names');
  }
  return v as string[];
}

export const TEST_KINDS = ['fixtures', 'contract', 'live'] as const;

// A compile passes only when all three version tests ran and passed (a skipped live test is not a pass).
export function testsPassed(results: unknown): boolean {
  const tests = (results as { tests?: Record<string, { status?: string }> } | null)?.tests;
  return Boolean(tests) && TEST_KINDS.every((k) => tests![k]?.status === 'pass');
}

export type BudgetJob = { ticketId: bigint; amountCents: number; status: string; reservedCents: number; overCapApproved: boolean };

// After a cap change: jobs whose Droid work has started keep their reservation, as do jobs the founder
// approved over the cap. Queued and ineligible jobs are re-fitted oldest first.
export function refitBudget(capCents: number, spentCents: number, jobs: BudgetJob[]): { keep: bigint[]; ineligible: bigint[] } {
  const STARTED = ['compiling', 'auditing', 'rework', 'ship_pending', 'shipping'];
  let free = capCents - spentCents;
  for (const j of jobs) if (STARTED.includes(j.status) || (j.overCapApproved && j.status === 'queued')) free -= j.reservedCents;
  const keep: bigint[] = [];
  const ineligible: bigint[] = [];
  const candidates = jobs.filter((j) => (j.status === 'queued' && !j.overCapApproved) || j.status === 'ineligible')
    .sort((a, b) => (a.ticketId < b.ticketId ? -1 : 1));
  for (const j of candidates) {
    if (j.amountCents <= free) { keep.push(j.ticketId); free -= j.amountCents; } else ineligible.push(j.ticketId);
  }
  return { keep, ineligible };
}
