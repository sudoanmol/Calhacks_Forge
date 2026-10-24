import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { commandServer, type CommandLog } from '../src/runTool.ts';

const worktree = realpathSync(mkdtempSync(join(tmpdir(), 'droid-run-')));
const call = async (command: string, approve?: (command: string, reason: string) => Promise<boolean>) => {
  const logs: CommandLog[] = [];
  const runCommand = commandServer(worktree, (d) => void logs.push(d), { approve }).tools[0]!;
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

test('a needs-approval command runs only once the founder approves it', async () => {
  const asked: string[] = [];
  const no = await call('touch refused', async (c) => { asked.push(c); return false; });
  assert.equal(no.res.isError, true);
  assert.equal(no.log.outcome, 'denied');
  assert.match(no.log.reason, /founder did not approve/);
  assert.equal(existsSync(join(worktree, 'refused')), false);
  const yes = await call('touch approved', async (c) => { asked.push(c); return true; });
  assert.equal(yes.res.isError, false);
  assert.equal(yes.log.outcome, 'founder-approved');
  assert.equal(yes.log.exitCode, 0);
  assert.equal(existsSync(join(worktree, 'approved')), true);
  assert.deepEqual(asked, ['touch refused', 'touch approved']);
});

test('a denied command never reaches the founder', async () => {
  let asked = false;
  const { log } = await call('curl -s https://example.com', async () => { asked = true; return true; });
  assert.equal(log.outcome, 'denied');
  assert.equal(asked, false);
});

test('an allowlisted command runs inside the worktree', async () => {
  const { res, text, log, logs } = await call('pwd');
  assert.equal(res.isError, false);
  assert.match(text, new RegExp(`exit 0\\n${worktree}`));
  assert.equal(log.outcome, 'auto-allowed');
  assert.equal(log.exitCode, 0);
});
