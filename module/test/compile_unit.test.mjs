// Pure rules behind flow C (module/src/compile.ts), no network. The live flow is in compile.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { droppedFields, evaluateTriggers, parseFields, refitBudget, testsPassed } from '../src/compile.ts';

const run = (orderId, verified, total) => ({ orderId: BigInt(orderId), verified, total });
const base = { buyers: 0, minBuyers: 2, runs: [], window: 3, minVerifiedRate: 0.8 };

test('triggers: distinct buyers at the threshold open a compile', () => {
  assert.equal(evaluateTriggers({ ...base, buyers: 1 }), null);
  const hit = evaluateTriggers({ ...base, buyers: 2 });
  assert.equal(hit.trigger, 'buyers');
  assert.deepEqual([hit.detail.buyers, hit.detail.minBuyers], [2, 2]);
  assert.equal(evaluateTriggers({ ...base, buyers: 5, minBuyers: 0 }), null, 'compile_min_buyers below 1 turns the trigger off');
});

test('triggers: a low verified rate needs a full window of runs', () => {
  const low = [run(9, 1, 10), run(8, 2, 10), run(7, 3, 10)];
  assert.equal(evaluateTriggers({ ...base, runs: low.slice(0, 2) }), null, 'two runs of a window of three');
  const hit = evaluateTriggers({ ...base, runs: low });
  assert.equal(hit.trigger, 'verified_rate');
  assert.equal(hit.detail.verifiedRate, 0.2);
  assert.deepEqual(hit.detail.orderIds, ['9', '8', '7']);
  assert.equal(evaluateTriggers({ ...base, runs: [run(1, 9, 10), run(2, 8, 10), run(3, 10, 10)] }), null, '90% is above 80%');
  assert.equal(evaluateTriggers({ ...base, runs: low, window: 0 }), null, 'compile_window_runs below 1 turns the trigger off');
  assert.equal(evaluateTriggers({ ...base, runs: low, buyers: 3 }).trigger, 'verified_rate', 'quality first when both hold');
});

test('contract: a version may add fields but never drop one', () => {
  assert.deepEqual(droppedFields(['name', 'price', 'stock'], ['name', 'price', 'stock', 'rating']), []);
  assert.deepEqual(droppedFields(['name', 'price', 'stock'], ['name', 'price']), ['stock']);
  assert.deepEqual(parseFields('["a","b"]'), ['a', 'b']);
  for (const bad of ['[]', '{}', '"a"', '[1]', 'nope', '[""]']) assert.throws(() => parseFields(bad), /fields must be/, bad);
});

test('tests pass only when fixtures, contract and live all pass', () => {
  const r = (live) => ({ tests: { fixtures: { status: 'pass' }, contract: { status: 'pass' }, live: { status: live } } });
  assert.equal(testsPassed(r('pass')), true);
  assert.equal(testsPassed(r('skipped')), false);
  assert.equal(testsPassed(r('fail')), false);
  assert.equal(testsPassed({ tests: { fixtures: { status: 'pass' } } }), false);
  assert.equal(testsPassed(null), false);
});

test('budget refit: started work keeps its reservation; queued and ineligible jobs refit oldest first', () => {
  const job = (id, amountCents, status, extra = {}) => ({ ticketId: BigInt(id), amountCents, status, reservedCents: status === 'ineligible' ? 0 : amountCents, overCapApproved: false, ...extra });
  const jobs = [job(1, 300, 'compiling'), job(2, 200, 'queued'), job(3, 400, 'queued'), job(4, 100, 'ineligible'), job(5, 900, 'shipped')];
  // cap 1000, spent 100, compiling 300 -> 600 free: #2 (200) fits, #3 (400) fits, #4 (100) does not.
  assert.deepEqual(refitBudget(1000, 100, jobs), { keep: [2n, 3n], ineligible: [4n] });
  // cap 700 -> 300 free: #2 fits, #3 does not, #4 fits in what is left.
  assert.deepEqual(refitBudget(700, 100, jobs), { keep: [2n, 4n], ineligible: [3n] });
  assert.deepEqual(refitBudget(0, 100, jobs), { keep: [], ineligible: [2n, 3n, 4n] });
  const approved = [job(6, 5000, 'queued', { overCapApproved: true }), job(7, 10, 'queued')];
  assert.deepEqual(refitBudget(100, 0, approved), { keep: [], ineligible: [7n] }, 'a founder-approved overrun stays and uses the budget');
});
