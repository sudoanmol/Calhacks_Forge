import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { badgeOf, consoleLines, consoleStats, replaySchedule, splitCut, type ConsoleEvent, type ToolLine } from './consoleLines.ts';

// Real ticket #6 (open-roles) events from Maincloud, with CLI hook/user messages removed.
const raw = JSON.parse(readFileSync(new URL('./fixtures/ticket6-events.json', import.meta.url), 'utf8')) as { id: string; at: string; kind: string; refId: string; payload: string }[];
const events: ConsoleEvent[] = raw.map((r) => ({ id: BigInt(r.id), kind: r.kind, payload: r.payload, at: { microsSinceUnixEpoch: BigInt(r.at) } }));
const attemptOf = (n: number) => events.filter((e) => {
  const a = (JSON.parse(e.payload) as { attempt?: number }).attempt;
  return a === n || (a === undefined && (n === 1 ? e.at.microsSinceUnixEpoch < 1792889116000000n : e.at.microsSinceUnixEpoch >= 1792889116000000n));
});
const tools = (lines: ReturnType<typeof consoleLines>) => lines.filter((l): l is ToolLine => l.type === 'tool');

test('attempt 1: new session, two Creates auto-allowed, pnpm test exit 0, three harness tests', () => {
  const lines = consoleLines(attemptOf(1));
  const session = lines.find((l) => l.type === 'session');
  assert.equal(session?.type === 'session' && session.mode, 'new');
  assert.ok(session?.type === 'session' && session.keptTools.includes('run_command'));
  const creates = tools(lines).filter((t) => t.name === 'Create');
  assert.deepEqual(creates.map((c) => c.target), ['src/jsonspan.js', 'src/extract.js']);
  assert.ok(creates.every((c) => badgeOf(c) === 'allowed'));
  assert.equal(typeof creates[1].input.content, 'string');
  const test1 = tools(lines).find((t) => t.name === 'run_command' && t.target === 'pnpm test');
  assert.equal(test1?.exitCode, 0);
  assert.equal(test1 && badgeOf(test1), 'allowed');
  assert.match(test1?.result?.content ?? '', /^exit 0/);
  assert.deepEqual(lines.filter((l) => l.type === 'test').map((l) => l.type === 'test' && `${l.test}:${l.status}`), ['fixtures:pass', 'contract:pass', 'live:fail']);
});

test('the real failed tool call stays visible as failed, not as allowed', () => {
  const failed = tools(consoleLines(attemptOf(1))).find((t) => t.name === 'run_command' && t.target.startsWith('wc -c'));
  assert.equal(failed && badgeOf(failed), 'failed');
  assert.equal(failed?.result?.isError, true);
});

test('read-only tools get the read-only badge from their result', () => {
  const read = tools(consoleLines(attemptOf(1))).find((t) => t.name === 'Read');
  assert.equal(read?.target, 'src/extract.js');
  assert.equal(read && badgeOf(read), 'read-only');
});

test('attempt 2 resumes the same session and Droid explains why it kept the extractor', () => {
  const lines = consoleLines(attemptOf(2));
  const session = lines.find((l) => l.type === 'session');
  assert.equal(session?.type === 'session' && session.mode, 'resumed');
  assert.equal(session?.type === 'session' && session.sessionId, '34acdbcb-c5b1-495c-b52d-7d01458a6db7');
  assert.ok(lines.some((l) => l.type === 'think' && l.text.startsWith('I did not change `src/extract.js`')));
  assert.ok(lines.some((l) => l.type === 'worker' && l.text.includes('test/live.test.js')));
});

test('stats count files, commands and denials', () => {
  assert.deepEqual(consoleStats(consoleLines(attemptOf(1))), { files: 2, commands: 1, denied: 0, failedCalls: 1 });
});

test('a denied command pairs with its call and counts as denied', () => {
  const ev = (id: number, kind: string, p: object): ConsoleEvent => ({ id: BigInt(id), kind, payload: JSON.stringify(p), at: { microsSinceUnixEpoch: BigInt(id) * 1000n } });
  const lines = consoleLines([
    ev(1, 'droid_droid_message', { type: 'tool_call', name: 'forge___run_command', toolUseId: 'u1', input: { command: 'curl https://x' } }),
    ev(2, 'droid_tool_decision', { tool: 'run_command', detail: 'curl https://x', outcome: 'denied', reason: 'network' }),
    ev(3, 'droid_droid_message', { type: 'tool_result', toolName: 'forge___run_command', toolUseId: 'u1', isError: true, outcome: 'denied', content: 'denied: network' }),
  ]);
  const t = tools(lines)[0];
  assert.equal(badgeOf(t), 'denied');
  assert.equal(t.decision?.reason, 'network');
  assert.equal(consoleStats(lines).denied, 1);
});

test('splitCut reads the truncation marker', () => {
  assert.deepEqual(splitCut('abc… [42 more chars]'), { text: 'abc', more: 42 });
  assert.deepEqual(splitCut('abc'), { text: 'abc', more: 0 });
});

test('replay keeps real gaps and shortens long waits, reporting what was skipped', () => {
  const s = replaySchedule([{ at: 0n }, { at: 2_000_000n }, { at: 182_000_000n }]);
  assert.deepEqual(s.map((b) => b.offsetUs), [0n, 2_000_000n, 3_500_000n]);
  assert.deepEqual(s.map((b) => b.skippedUs), [0n, 0n, 178_500_000n]);
});
