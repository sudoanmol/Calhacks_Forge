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

// Compile sessions: Droid may change only the extractor of the Actor it is compiling and run its
// tests. Everything else is denied outright (there is no founder approval path in a compile).
const PLUMBING = /^src\/(lib\/|main\.js$|run\.js$|fetchers\.js$)/;
const COMPILE_COMMANDS: RegExp[] = [
  /^pnpm( run)? test$/,
  /^pnpm run test:(fixtures|contract)$/,
  /^node --test( [\w./*"-]+)*$/,
];
const SHELL_META = /[;&|<>`$\\\n(){}]/;

export function decideCompile(actorDir: string, use: ToolUseInfo): Decision {
  if (use.type === 'create' || use.type === 'edit' || use.type === 'apply_patch') {
    if (!use.filePath) return { outcome: 'denied', reason: 'file change without a path' };
    const rel = relative(actorDir, isAbsolute(use.filePath) ? use.filePath : resolve(actorDir, use.filePath));
    if (rel.startsWith('..') || isAbsolute(rel)) return { outcome: 'denied', reason: `writes outside the Actor: ${use.filePath}` };
    if (!rel.startsWith('src/')) return { outcome: 'denied', reason: `only src/ may change, not ${rel}` };
    if (PLUMBING.test(rel)) return { outcome: 'denied', reason: `template plumbing is read-only: ${rel}` };
    return { outcome: 'auto-allowed', reason: `extractor change: ${rel}` };
  }
  if (use.type === 'exec') {
    const cmd = (use.command ?? '').trim();
    if (SHELL_META.test(cmd)) return { outcome: 'denied', reason: `shell operators are not allowed: ${cmd}` };
    if (COMPILE_COMMANDS.some((re) => re.test(cmd))) return { outcome: 'auto-allowed', reason: `test command: ${cmd}` };
    return { outcome: 'denied', reason: `only the Actor's tests may run: ${cmd}` };
  }
  return { outcome: 'denied', reason: `tool ${use.name} (${use.type}) is not allowed in a compile` };
}
