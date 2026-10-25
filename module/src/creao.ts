// Recovery decisions use stored runs and timestamps, never provider response text as authority.
export const undecidedAction = (runs: number, final: boolean): 'retry' | 'fail' =>
  !final && runs < 2 ? 'retry' : 'fail';

export const customerTaskPriority = (kind: string): number =>
  ['cfo_compile', 'audit_compile'].includes(kind) ? 1 : 0;
