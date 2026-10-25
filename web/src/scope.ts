import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Customer, Event, Orders as Order } from './module_bindings/types';
import { payloadObj } from './format';

// "Real" is a naming convention, not a stored flag: Fetch agent addresses (ASI:One users and the buyer agent)
// start with agent1q, while every scripted sender (test-sender-…, cli-test-…, asi-test-…, cmp-test-…, canary)
// uses another prefix. If the Front Desk ever registers customers with another prefix, revisit this rule.
export function isRealOrder(o: Order, customers: Map<bigint, Customer>, canaryIds: Set<bigint>): boolean {
  if (canaryIds.has(o.id)) return false;
  return customers.get(o.customerId)?.asiSender.startsWith('agent1q') ?? false;
}

export type Scope = {
  showTest: boolean;
  canaryIds: Set<bigint>;
  isReal: (o: Order) => boolean;
  isVisible: (o: Order) => boolean;
  label: string;
};

export function useScope(showTest: boolean): Scope {
  const [customers] = useTable(tables.customer);
  const [canary] = useTable(tables.canaryOrder);
  return useMemo(() => {
    const byId = new Map(customers.map((c) => [c.id, c]));
    const canaryIds = new Set(canary.map((c) => c.orderId));
    const isReal = (o: Order) => isRealOrder(o, byId, canaryIds);
    return {
      showTest, canaryIds, isReal,
      isVisible: (o: Order) => showTest || isReal(o),
      label: showTest ? 'all traffic' : 'real orders and live APIs',
    };
  }, [customers, canary, showTest]);
}

// Whether an event belongs to the visible scope. Order-level events follow their order; ticket, task, run and
// approval events follow the order or (non-retired) API they serve; company-level rows (config, budget, staff) always show.
export function useEventScope(scope: Scope): (e: Event) => boolean {
  const [orders] = useTable(tables.orders);
  const [tasks] = useTable(tables.task);
  const [tickets] = useTable(tables.ticket);
  const [approvals] = useTable(tables.approval);
  const [refunds] = useTable(tables.refund);
  const [runs] = useTable(tables.run);
  const [retired] = useTable(tables.apiRetired);
  return useMemo(() => {
    if (scope.showTest) return () => true;
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const ticketById = new Map(tickets.map((t) => [t.id, t]));
    const approvalById = new Map(approvals.map((a) => [a.id, a]));
    const refundById = new Map(refunds.map((r) => [r.id, r]));
    const runById = new Map(runs.map((r) => [r.id, r]));
    const gone = new Set(retired.map((r) => r.apiId));
    const realApis = new Set(orders.filter(scope.isReal).flatMap((o) => (o.apiId !== undefined ? [o.apiId] : [])));
    const orderOk = (id: bigint | undefined) => {
      const o = id !== undefined ? orderById.get(id) : undefined;
      return o !== undefined && scope.isReal(o);
    };
    const ticketOk = (id: bigint | undefined) => {
      const t = id !== undefined ? ticketById.get(id) : undefined;
      if (!t) return false;
      return t.apiId !== undefined ? !gone.has(t.apiId) : orderOk(t.orderId);
    };
    const taskOk = (id: bigint | undefined) => {
      const t = id !== undefined ? taskById.get(id) : undefined;
      if (!t) return false;
      return t.orderId !== undefined ? orderOk(t.orderId) : ticketOk(t.ticketId);
    };
    const big = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : typeof v === 'number' ? BigInt(v) : undefined);
    return (e: Event) => {
      switch (e.refType) {
        case 'order': return orderOk(e.refId);
        case 'challenge': return orderOk(big(payloadObj(e.payload).orderId));
        case 'ticket': return ticketOk(e.refId);
        case 'task': return taskOk(e.refId);
        case 'run': {
          const r = runById.get(e.refId);
          if (!r) return false;
          if (r.taskId !== undefined) return taskOk(r.taskId);
          return r.provider === 'apify' && /^\d+$/.test(r.threadId) && orderOk(BigInt(r.threadId));
        }
        case 'approval': {
          const a = approvalById.get(e.refId);
          if (a?.refType === 'ticket') return ticketOk(a.refId);
          if (a?.refType === 'task') return taskOk(a.refId);
          if (a?.refType === 'refund') return orderOk(refundById.get(a.refId)?.orderId);
          return ticketOk(big(payloadObj(e.payload).ticketId));
        }
        case 'api': return !gone.has(e.refId) || realApis.has(e.refId);
        case 'config': case 'budget': case 'staff': return true;
        default: return false;
      }
    };
  }, [scope, orders, tasks, tickets, approvals, refunds, runs, retired]);
}
