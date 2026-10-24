import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// One structured record per thing that happens in a compile: Droid messages, tool decisions,
// test runs. Today it goes to a JSONL file; the log_droid_event reducer will take the same shape.
export type DroidEvent = {
  kind: string; // compile_started | session_created | droid_message | tool_decision | tests | repair_started | compile_finished | ...
  [k: string]: unknown;
};

export type EventSink = (evt: DroidEvent) => void;

export function jsonlSink(path: string, base: Record<string, unknown>): EventSink {
  mkdirSync(dirname(path), { recursive: true });
  return (evt) => appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...base, ...evt })}\n`);
}

const clip = (v: unknown, n: number): unknown => {
  if (typeof v === 'string') return v.length > n ? `${v.slice(0, n)}… [${v.length - n} more chars]` : v;
  if (Array.isArray(v)) return v.map((x) => clip(x, n));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clip(x, n)]));
  return v;
};

// Keeps file bodies and tool outputs readable in the log without storing megabytes per event.
export const clipped = <T>(v: T, n = 4000): T => clip(v, n) as T;
