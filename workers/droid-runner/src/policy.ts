import { isAbsolute, relative, resolve } from 'node:path';

// What the permission handler decides for one tool call. Every decision is logged so the
// Engineering tab can badge it (auto-allowed / denied / founder-approved).
export type Decision = { outcome: 'auto-allowed' | 'denied' | 'needs-approval'; reason: string };

export type ToolUseInfo = {
  name: string;
  type: string; // ToolConfirmationType value: 'edit' | 'create' | 'exec' | 'apply_patch' | ...
  filePath?: string;
  command?: string;
};

// Commands Droid may run without asking: tests and local Actor runs against fixtures.
const ALLOWED_COMMANDS: RegExp[] = [
  /^pnpm( run)? test(\s|$)/,
  /^pnpm run test:(fixtures|contract|live)(\s|$)/,
  /^node --test(\s|$)/,
  /^(ls|cat|pwd)(\s|$)/,
];

// Never allowed, even with approval: network tools, deploys, secrets, history rewrites.
const DENIED_COMMANDS: RegExp[] = [
  /\b(curl|wget|ssh|scp|nc)\b/,
  /\bapify\s+(push|login|secrets)\b/,
  /\bgit\s+(push|reset|rebase|remote)\b/,
  /\b(sudo|rm\s+-rf\s+\/)/,
  /\.env\b/,
  /\b(npm|yarn)\b/,
];

const insideWorktree = (worktree: string, p: string) => {
  const rel = relative(worktree, isAbsolute(p) ? p : resolve(worktree, p));
  return !rel.startsWith('..') && !isAbsolute(rel);
};

export function decide(worktree: string, use: ToolUseInfo): Decision {
  if (use.type === 'create' || use.type === 'edit' || use.type === 'apply_patch') {
    if (!use.filePath) return { outcome: 'needs-approval', reason: 'file change without a path' };
    if (!insideWorktree(worktree, use.filePath)) return { outcome: 'denied', reason: `writes outside the worktree: ${use.filePath}` };
    if (/(^|\/)\.env/.test(use.filePath)) return { outcome: 'denied', reason: 'touches an env file' };
    return { outcome: 'auto-allowed', reason: 'file change inside the worktree' };
  }
  if (use.type === 'exec') {
    const cmd = (use.command ?? '').trim();
    if (DENIED_COMMANDS.some((re) => re.test(cmd))) return { outcome: 'denied', reason: `command on the deny list: ${cmd}` };
    if (ALLOWED_COMMANDS.some((re) => re.test(cmd))) return { outcome: 'auto-allowed', reason: `allowlisted command: ${cmd}` };
    return { outcome: 'needs-approval', reason: `command not on the allowlist: ${cmd}` };
  }
  return { outcome: 'needs-approval', reason: `tool ${use.name} (${use.type}) is not on the allowlist` };
}
