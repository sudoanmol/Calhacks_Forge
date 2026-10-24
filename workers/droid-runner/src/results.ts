// What the droid-runner reports to submit_compile, bounded to what the reducer stores (30 000 chars),
// and what a rework reads back from compile_job.testResults.
import type { CompileSummary, PreviousTests, TestKind } from './compiler.ts';

export const RESULTS_MAX = 30_000;
const KINDS: TestKind[] = ['fixtures', 'contract', 'live'];

const tail = (s: string, n: number) => (s.length > n ? `[${s.length - n} chars cut]…${s.slice(-n)}` : s);

export function compileResults(s: CompileSummary): string {
  const build = (outputChars: number, diffChars: number) => JSON.stringify({
    tests: Object.fromEntries(KINDS.filter((k) => s.tests[k]).map((k) => {
      const { output, ...r } = s.tests[k];
      return [k, { ...r, output: tail(output, outputChars) }];
    })),
    passed: s.passed,
    srcHash: s.srcHash,
    files: s.files,
    denied: s.denied.slice(0, 20),
    approved: s.approved.slice(0, 20),
    turns: s.turns.map((t) => {
      const r = (t.result ?? {}) as Record<string, unknown>;
      return { turn: t.turn, mode: t.mode, success: r.success ?? null, turnCount: r.turnCount ?? null, durationMs: r.durationMs ?? null, tokenUsage: r.tokenUsage ?? null };
    }),
    diff: tail(s.diff, diffChars),
    wallMs: s.wallMs,
    logPath: s.logPath,
  });
  for (const [o, d] of [[2000, 12_000], [1000, 6000], [400, 2000], [0, 0]] as const) {
    const out = build(o, d);
    if (out.length <= RESULTS_MAX) return out;
  }
  throw new Error('compile results do not fit even without outputs and diff');
}

export function previousTests(testResults: string): PreviousTests | undefined {
  try {
    const t = (JSON.parse(testResults) as { tests?: PreviousTests }).tests;
    return t && typeof t === 'object' ? t : undefined;
  } catch {
    return undefined;
  }
}

export function auditedSrcHash(testResults: string): string | undefined {
  try {
    const h = (JSON.parse(testResults) as { srcHash?: unknown }).srcHash;
    return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : undefined;
  } catch {
    return undefined;
  }
}

// log_droid_event kinds are a-z and _; the payload is the event without its kind.
export function droidEventArgs(evt: { kind: string; [k: string]: unknown }): [string, string] {
  const kind = evt.kind.toLowerCase().replace(/[^a-z_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 40) || 'event';
  const { kind: _k, ...rest } = evt;
  return [kind, JSON.stringify(rest)];
}
