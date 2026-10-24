import type { Event, Orders } from './module_bindings/types';
import { payloadObj } from './format';
import type { Timestamp } from 'spacetimedb';

export const STEPS = ['desk', 'paid', 'COO', 'run', 'verify', 'audit', 'delivered'] as const;
export type StepState = 'done' | 'active' | 'fail' | 'warn' | 'pending';

// Where each order status sits on the tracker, and whether that step is finished, in progress or failed.
const STATUS_STEP: Record<string, [number, StepState]> = {
  quoted: [0, 'done'],
  rejected_at_desk: [0, 'fail'],
  paid: [1, 'done'],
  triaging: [2, 'active'],
  researching: [2, 'active'],
  accepted: [2, 'done'],
  rejected: [2, 'fail'],
  counteroffered: [2, 'warn'],
  running: [3, 'active'],
  verifying: [4, 'active'],
  auditing: [5, 'active'],
  audit_rejected: [5, 'fail'],
  delivered: [6, 'done'],
};

export const TERMINAL = new Set(['delivered', 'rejected', 'rejected_at_desk', 'counteroffered', 'audit_rejected', 'failed']);

export type Track = { states: StepState[]; times: (Timestamp | undefined)[] };

export function track(order: Orders, orderEvents: Event[]): Track {
  const times: (Timestamp | undefined)[] = STEPS.map(() => undefined);
  times[0] = order.createdAt;
  let lastNonFailed = 'quoted';
  for (const e of orderEvents) {
    const s = payloadObj(e.payload).status;
    if (typeof s !== 'string') continue;
    const m = STATUS_STEP[s];
    if (m && !times[m[0]]) times[m[0]] = e.at;
    if (s !== 'failed') lastNonFailed = s;
  }
  let [idx, state] = STATUS_STEP[order.status] ?? [0, 'done'];
  if (order.status === 'failed') {
    const [pi, ps] = STATUS_STEP[lastNonFailed] ?? [0, 'done'];
    idx = ps === 'active' ? pi : Math.min(pi + 1, STEPS.length - 1);
    state = 'fail';
    times[idx] = times[idx] ?? order.updatedAt;
  }
  const states: StepState[] = STEPS.map((_, i) => (i < idx ? 'done' : i === idx ? state : 'pending'));
  // A finished step with an open order means the next step is what the order is waiting on.
  if (state === 'done' && idx < STEPS.length - 1 && !TERMINAL.has(order.status)) states[idx + 1] = 'active';
  return { states, times };
}
