import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@factory/droid-sdk/node';
import { decide, type Decision, type ToolUseInfo } from './policy.ts';

export type CommandLog = Decision & { tool: 'run_command'; detail: string; exitCode?: number | null };

export type CommandServerOptions = {
  // Defaults to the general worktree policy; a compile passes its narrower one.
  decide?: (worktree: string, use: ToolUseInfo) => Decision;
  // Environment for allowed commands. Defaults to the host's environment.
  env?: NodeJS.ProcessEnv;
};

// Droid's only way to run shell commands. The built-in Execute tool is disabled because at Low
// autonomy the CLI runs any command the model itself rates low-risk, without asking us.
export function commandServer(worktree: string, onDecision: (d: CommandLog) => void | Promise<void>, opts: CommandServerOptions = {}) {
  const policy = opts.decide ?? decide;
  return createSdkMcpServer({
    name: 'forge',
    tools: [
      tool(
        'run_command',
        'Run a shell command in the worktree. Only tests and local fixture runs are allowed; network, deploy and secret access are denied.',
        { command: z.string().describe('The shell command to run') },
        async ({ command }) => {
          const d = policy(worktree, { name: 'run_command', type: 'exec', command });
          if (d.outcome !== 'auto-allowed') {
            await onDecision({ ...d, tool: 'run_command', detail: command });
            return { isError: true, content: [{ type: 'text', text: `${d.outcome}: ${d.reason}` }] };
          }
          const r = spawnSync('sh', ['-c', command], { cwd: worktree, env: opts.env ?? process.env, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 << 20 });
          await onDecision({ ...d, tool: 'run_command', detail: command, exitCode: r.status });
          const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-20_000);
          return { isError: r.status !== 0, content: [{ type: 'text', text: `exit ${r.status}\n${out}` }] };
        },
        // The policy check happens inside the handler, so the CLI needn't prompt for it.
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
}
