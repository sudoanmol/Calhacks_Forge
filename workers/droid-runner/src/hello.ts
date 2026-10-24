// Gate 0: Droid hello-world in a git worktree, with the permission policy deciding every tool call.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ToolConfirmationOutcome } from '@factory/droid-sdk/node';
import { decide, type Decision } from './policy.ts';
import { createLockedSession } from './lockdown.ts';

const repo = resolve(import.meta.dirname, '../../..');
const worktree = join(repo, '.worktrees', 'droid-hello');
const branch = `droid/hello-${Date.now()}`;

if (existsSync(worktree)) execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktree]);
mkdirSync(join(repo, '.worktrees'), { recursive: true });
execFileSync('git', ['-C', repo, 'worktree', 'add', '-b', branch, worktree, 'HEAD'], { stdio: 'ignore' });

const decisions: Array<{ outcome: Decision['outcome'] | 'founder-approved'; reason: string; tool: string; detail: string }> = [];
const lock = await createLockedSession({
  cwd: worktree,
  onCommand: (d) => {
    decisions.push(d);
    console.log(`run_command → ${d.outcome}: ${d.reason}`);
  },
  permissionHandler: ({ toolUses, options }) => {
    const ds = toolUses.map((t) => {
      const details = t.details as { type: string; filePath?: string; fullCommand?: string };
      const d = decide(worktree, { name: t.toolUse.name, type: details.type, filePath: details.filePath, command: details.fullCommand });
      decisions.push({ ...d, tool: t.toolUse.name, detail: details.filePath ?? details.fullCommand ?? '' });
      console.log(`permission ${t.toolUse.name} ${details.type} → ${d.outcome}: ${d.reason}`);
      return d;
    });
    // Gate 0 has no founder approval path yet, so anything that needs approval is cancelled.
    const proceed = ds.every((d) => d.outcome === 'auto-allowed');
    const want = proceed ? ToolConfirmationOutcome.ProceedOnce : ToolConfirmationOutcome.Cancel;
    console.log(`options offered: ${options.map((o) => o.value).join(', ')} → ${want}`);
    if (!options.some((o) => o.value === want)) throw new Error(`outcome not offered: ${want}`);
    return want;
  },
});

const { session } = lock;
console.log(`tools kept: ${lock.kept.join(', ')} (${lock.disabled.length} disabled)`);

const prompt = [
  'Two steps, in order:',
  '1. Use the Create tool to create hello.txt in the current directory containing exactly: hello from droid',
  '2. Use the run_command tool to run this shell command and report its output: curl -s https://example.com',
  'If a step is not permitted, say so and go on to the next step. Do not retry a denied call.',
].join('\n');

let result: unknown;
const t0 = Date.now();
try {
  for await (const msg of session.stream(prompt)) {
    if (msg.type === 'tool_call') console.log(`tool_call ${msg.name} ${JSON.stringify(msg.input).slice(0, 160)}`);
    if (msg.type === 'tool_result') console.log(`tool_result ${msg.toolName} error=${msg.isError}`);
    if (msg.type === 'error') console.log(`error ${msg.message}`);
    if (msg.type === 'assistant') console.log(`assistant ${msg.text.slice(0, 200)}`);
    if (!['tool_call', 'tool_result', 'error', 'assistant', 'result'].includes(msg.type)) console.log(`msg ${msg.type}`);
    if (msg.type === 'result') result = { success: msg.success, subtype: msg.subtype, turns: msg.turnCount, ms: msg.durationMs };
  }
} finally {
  await session.close();
}

const helloPath = join(worktree, 'hello.txt');
const hello = existsSync(helloPath) ? readFileSync(helloPath, 'utf8').trim() : null;
console.log(JSON.stringify({ sessionId: session.id, ms: Date.now() - t0, result, keptTools: lock.kept, decisions, hello }, null, 2));

execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktree]);
execFileSync('git', ['-C', repo, 'branch', '-D', branch], { stdio: 'ignore' });
rmSync(join(repo, '.worktrees'), { recursive: true, force: true });

const ok = hello === 'hello from droid' && decisions.some((d) => d.outcome === 'denied');
if (!ok) process.exit(1);
