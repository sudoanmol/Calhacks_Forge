import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { srcHash, type CompileSummary, type TestResult } from '../src/compiler.ts';
import { auditedSrcHash, compileResults, droidEventArgs, previousTests, RESULTS_MAX } from '../src/results.ts';

const result = (kind: TestResult['kind'], status: TestResult['status'], output: string): TestResult =>
  ({ kind, status, exitCode: status === 'fail' ? 1 : 0, pass: 1, fail: status === 'fail' ? 1 : 0, skipped: 0, ms: 5, output });

const summary = (outputChars: number, diffChars: number): CompileSummary => ({
  api: 'gpu-listings', sessionId: 's1', passed: false, resumed: false,
  turns: [{ turn: 1, mode: 'create', result: { success: true, turnCount: 9, durationMs: 1000, tokenUsage: { input: 1 } }, tests: [] }],
  tests: { fixtures: result('fixtures', 'pass', 'f'.repeat(outputChars)), contract: result('contract', 'pass', 'c'), live: result('live', 'fail', `${'l'.repeat(outputChars)}END`) },
  denied: [{ tool: 'run_command', detail: 'curl x', reason: 'network' }], approved: [], files: ['src/extract.js'],
  diff: 'd'.repeat(diffChars), srcHash: 'a'.repeat(64), wallMs: 10, work: '/tmp/x', copiedTo: null, logPath: '/tmp/x.jsonl', diffPath: '/tmp/x.diff',
});

test('compile results keep the test statuses and the srcHash and always fit the reducer limit', () => {
  for (const [o, d] of [[10, 10], [50_000, 200_000], [500_000, 2_000_000]] as const) {
    const out = compileResults(summary(o, d));
    assert.ok(out.length <= RESULTS_MAX, `${out.length} chars`);
    const parsed = JSON.parse(out);
    assert.deepEqual(Object.fromEntries(Object.entries(parsed.tests).map(([k, v]) => [k, (v as { status: string }).status])), { fixtures: 'pass', contract: 'pass', live: 'fail' });
    assert.equal(parsed.srcHash, 'a'.repeat(64));
    assert.equal(auditedSrcHash(out), 'a'.repeat(64));
  }
  const small = JSON.parse(compileResults(summary(10, 10)));
  assert.ok(small.tests.live.output.endsWith('END'), 'the tail of a test output is kept');
});

test('a rework reads the previous test outputs back; bad results give nothing', () => {
  const prev = previousTests(compileResults(summary(10, 10)));
  assert.equal(prev?.live?.status, 'fail');
  assert.match(prev?.live?.output ?? '', /END$/);
  assert.equal(previousTests('not json'), undefined);
  assert.equal(auditedSrcHash('{"srcHash":"short"}'), undefined);
  assert.equal(auditedSrcHash(''), undefined);
});

test('log_droid_event kinds are sanitized and the payload drops the kind', () => {
  assert.deepEqual(droidEventArgs({ kind: 'tool_decision', outcome: 'denied' }), ['tool_decision', '{"outcome":"denied"}']);
  assert.equal(droidEventArgs({ kind: 'Ship-Push 2' })[0], 'ship_push__');
  assert.equal(droidEventArgs({ kind: '123' })[0], 'event');
  assert.match(droidEventArgs({ kind: 'x'.repeat(80) })[0], /^x{40}$/);
});

test('srcHash changes with the extractor sources and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'srchash-'));
  mkdirSync(join(dir, 'src/lib'), { recursive: true });
  writeFileSync(join(dir, 'src/extract.js'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src/lib/x.js'), 'x');
  const h1 = srcHash(dir);
  writeFileSync(join(dir, 'README.md'), 'docs');
  assert.equal(srcHash(dir), h1);
  writeFileSync(join(dir, 'src/extract.js'), 'export const a = 2;\n');
  assert.notEqual(srcHash(dir), h1);
  assert.match(h1, /^[0-9a-f]{64}$/);
});
