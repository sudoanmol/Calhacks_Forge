import { useSyncExternalStore } from 'react';

// Which subscription snapshots have arrived. `core` is the small set a first paint needs (orders, catalog,
// approvals); `all` adds the tables that grow with every order (events, values, tasks, runs, evidence).
// Until a flag is set, empty tables mean "still loading", not "nothing here".
export type Ready = { core: boolean; all: boolean };

let state: Ready = { core: false, all: false };
const listeners = new Set<() => void>();

export function markReady(part: keyof Ready) {
  if (state[part]) return;
  state = { ...state, [part]: true };
  listeners.forEach((l) => l());
}

export function useReady(): Ready {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}
