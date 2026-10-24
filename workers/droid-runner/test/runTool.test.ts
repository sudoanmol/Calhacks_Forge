import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { commandServer, type CommandLog } from '../src/runTool.ts';

const worktree = realpathSync(mkdtempSync(join(tmpdir(), 'droid-run-')));
const call = async (command: string) => {
  const logs: CommandLog[] = [];
  const runCommand = commandServer(worktree, (d) => void logs.push(d)).tools[0]!;
  const res = (await runCommand.handler({ command })) as { isError: boolean; content: Array<{ text: string }> };
  return { res, text: res.content[0]!.text, log: logs[0]!, logs };
};

test('a denied command never runs and is logged as denied', async () => {
  const { res, text, log, logs } = await call('curl -s https://example.com');
  assert.equal(res.isError, true);
  assert.match(text, /^denied:/);
  assert.deepEqual(logs.map((l) => l.outcome), ['denied']);
  assert.equal(log.exitCode, undefined);
});

test('a command off the allowlist needs approval and does not run', async () => {
  const { res, text, log, logs } = await call('touch made-it');
  assert.match(text, /^needs-approval:/);
  assert.equal(log.outcome, 'needs-approval');
});

test('an allowlisted command runs inside the worktree', async () => {
  const { res, text, log, logs } = await call('pwd');
  assert.equal(res.isError, false);
  assert.match(text, new RegExp(`exit 0\\n${worktree}`));
  assert.equal(log.outcome, 'auto-allowed');
  assert.equal(log.exitCode, 0);
});
