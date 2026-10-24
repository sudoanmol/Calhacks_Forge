import type { Timestamp } from 'spacetimedb';

export const micros = (ts: Timestamp) => ts.microsSinceUnixEpoch;
export const toDate = (ts: Timestamp) => new Date(Number(ts.microsSinceUnixEpoch / 1000n));

export function clock(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const d = toDate(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return sameDay ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`;
}

export const usd = (cents: number | bigint) => {
  const n = Number(cents) / 100;
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
};

export const short = (s: string, head = 10, tail = 4) => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

export function parseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

export function payloadObj(s: string): Record<string, unknown> {
  const v = parseJson(s);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export const byIdDesc = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
export const byIdAsc = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function list(s: string): string[] {
  const v = parseJson(s);
  return Array.isArray(v) ? v.map(String) : [];
}
