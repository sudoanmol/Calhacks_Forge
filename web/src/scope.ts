import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Customer, Orders as Order } from './module_bindings/types';

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
