import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { RowTypedQuery } from 'spacetimedb';
import { useSpacetimeDB } from 'spacetimedb/react';
import { useReady } from './ready';

// A whole-table reference such as `tables.event` (no `where`: the page filters in memory).
type TableRef<R> = RowTypedQuery<R, unknown> & { readonly accessorName: string };

type TableHandle<R> = {
  iter(): Iterable<R>;
  onInsert(cb: (ctx: unknown, row: R) => void): void;
  onDelete(cb: (ctx: unknown, row: R) => void): void;
  onUpdate?(cb: (ctx: unknown, oldRow: R, newRow: R) => void): void;
  removeOnInsert(cb: (ctx: unknown, row: R) => void): void;
  removeOnDelete(cb: (ctx: unknown, row: R) => void): void;
  removeOnUpdate?(cb: (ctx: unknown, oldRow: R, newRow: R) => void): void;
};

// Same signature as the SDK's useTable, but it reads the client cache that main.tsx's two subscriptions
// fill instead of opening one more subscription per hook instance. With ~90 hook instances across the
// page, the SDK version re-downloaded the big tables dozens of times and reported "ready" per instance,
// so remounted tabs sat on their loading state. "Ready" here means the snapshot that holds the table landed.
export function useTable<R>(table: TableRef<R>): [readonly R[], boolean] {
  const { getConnection } = useSpacetimeDB();
  const connection = getConnection();
  const accessor = table.accessorName;
  const ready = useReady();
  const handle = connection ? (connection.db as unknown as Record<string, TableHandle<R>>)[accessor] : undefined;
  const snapshot = useRef<readonly R[]>([]);
  const dirty = useRef(true);

  const subscribe = useCallback((onChange: () => void) => {
    if (!handle) return () => {};
    const bump = () => { dirty.current = true; onChange(); };
    handle.onInsert(bump);
    handle.onDelete(bump);
    handle.onUpdate?.(bump);
    return () => {
      handle.removeOnInsert(bump);
      handle.removeOnDelete(bump);
      handle.removeOnUpdate?.(bump);
    };
  }, [handle]);

  const getSnapshot = useCallback(() => {
    if (dirty.current) {
      snapshot.current = handle ? Array.from(handle.iter()) : [];
      dirty.current = false;
    }
    return snapshot.current;
  }, [handle]);

  const rows = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isReady = HEAVY.has(accessor) ? ready.all : ready.core;
  return [rows, isReady];
}

// Tables in main.tsx's second (large) subscription; everything else is in the first.
const HEAVY = new Set(['task', 'run', 'event', 'valueRecord', 'evidence', 'gateCheck', 'runCost']);
