import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undecidedAction, customerTaskPriority } from '../src/creao.ts';
test('undecided runs retry once; final start failures never retry', () => {
  assert.equal(undecidedAction(1, false), 'retry');
  assert.equal(undecidedAction(2, false), 'fail');
  assert.equal(undecidedAction(3, false), 'fail');
  assert.equal(undecidedAction(0, true), 'fail');
});
test('customer orders and challenges precede compile reviews', () => {
  const queued = ['cfo_compile', 'audit_compile', 'coo_triage', 'audit', 'audit_challenge', 'research_gate'];
  assert.deepEqual(queued.sort((a, b) => customerTaskPriority(a) - customerTaskPriority(b)),
    ['coo_triage', 'audit', 'audit_challenge', 'research_gate', 'cfo_compile', 'audit_compile']);
});
