import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, scoreValues } from '../src/summary.ts';

test('scores values by status and computes the verified rate over all rows', () => {
  const s = scoreValues([
    { status: 'verified', metric: 'price' },
    { status: 'verified', metric: 'name' },
    { status: 'stale', metric: 'price' },
    { status: 'unverifiable', metric: 'stock' },
  ]);
  assert.deepEqual(s.byStatus, { verified: 2, stale: 1, unverifiable: 1 });
  assert.equal(s.values, 4);
  assert.equal(s.failedPages, 0);
  assert.equal(s.verifiedRate, 0.5);
});

test('a failed page counts as a value row and fails the canary', () => {
  const s = scoreValues([{ status: 'unverifiable', metric: '_page' }]);
  assert.equal(s.failedPages, 1);
  assert.equal(s.verifiedRate, 0);
  const v = judge('auditing', s, 0.8);
  assert.equal(v.pass, false);
  assert.ok(v.reasons.some((r) => r.includes('unverifiable')));
});

test('passes only when the order reaches auditing with enough verified values', () => {
  const good = scoreValues(Array.from({ length: 10 }, (_, i) => ({ status: i < 9 ? 'verified' : 'mismatch', metric: 'x' })));
  assert.deepEqual(judge('auditing', good, 0.8), { pass: true, reasons: [] });
  assert.equal(judge('failed', good, 0.8).pass, false);
  assert.equal(judge('auditing', scoreValues([]), 0.8).pass, false);
  const poor = scoreValues([{ status: 'verified', metric: 'x' }, { status: 'mismatch', metric: 'x' }]);
  assert.equal(judge('auditing', poor, 0.8).pass, false);
});
