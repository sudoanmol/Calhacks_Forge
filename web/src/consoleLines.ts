// Turns one compile attempt's stored events into the lines of the Droid console.
// Pure: no React, no bindings at runtime, so it runs under `node --test`.

export type ConsoleEvent = { id: bigint; kind: string; payload: string; at: { microsSinceUnixEpoch: bigint } };

export type Decision = { outcome: string; reason: string };

export type ToolLine = {
  type: 'tool'; key: string; at: bigint;
  name: string; // run_command for forge___run_command
  target: string; // file path relative to the worktree, a command, or a pattern
  input: Record<string, unknown>;
  result?: { isError: boolean; content: string; at: bigint };
  decision?: Decision;
  exitCode?: number;
};

export type ConsoleLine =
  | { type: 'session'; key: string; at: bigint; mode: 'new' | 'resumed'; sessionId: string; keptTools: string[]; disabledCount?: number }
  | { type: 'worker'; key: string; at: bigint; text: string }
  | { type: 'prompt'; key: string; at: bigint; text: string }
  | { type: 'think'; key: string; at: bigint; text: string }
  | ToolLine
  | { type: 'test'; key: string; at: bigint; test: string; status: string; pass?: number; fail?: number; ms?: number; output: string }
  | { type: 'turn_done'; key: string; at: bigint; durationMs?: number; success?: boolean }
  | { type: 'finished'; key: string; at: bigint; passed?: boolean }
  | { type: 'error'; key: string; at: bigint; text: string };

const obj = (s: string): Record<string, unknown> => {
  try { const v = JSON.parse(s) as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; }
};
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const toolName = (n: string) => n.replace(/^forge___/, '');

// Paths are shown relative to the Actor worktree (…/actors/<api>/).
export const relPath = (p: string) => p.replace(/^(?:.*\/)?actors\/[^/]+\//, '').replace(/^baseline\//, '');

const targetOf = (name: string, input: Record<string, unknown>) => {
  if (typeof input.file_path === 'string') return relPath(input.file_path);
  if (typeof input.command === 'string') return input.command;
  if (typeof input.pattern === 'string') return input.pattern;
  if (Array.isArray(input.patterns)) return input.patterns.map(String).join(' ');
  if (typeof input.directory_path === 'string') return relPath(input.directory_path);
  if (typeof input.query === 'string') return input.query;
  return name === 'TodoWrite' ? 'plan' : '';
};

const EXIT = /^exit (-?\d+)/;

export function consoleLines(events: readonly ConsoleEvent[]): ConsoleLine[] {
  const lines: ConsoleLine[] = [];
  const byUseId = new Map<string, ToolLine>();
  const pendingCommands: ToolLine[] = [];
  for (const e of events) {
    const p = obj(e.payload);
    const at = e.at.microsSinceUnixEpoch;
    const key = `e${e.id}`;
    switch (e.kind) {
      case 'droid_session_created':
        lines.push({ type: 'session', key, at, mode: 'new', sessionId: str(p.sessionId), keptTools: Array.isArray(p.keptTools) ? p.keptTools.map((t) => toolName(String(t))) : [], disabledCount: num(p.disabledCount) });
        break;
      case 'droid_session_resumed':
        lines.push({ type: 'session', key, at, mode: 'resumed', sessionId: str(p.resumedSessionId) || str(p.sessionId), keptTools: [] });
        break;
      case 'droid_compile_started': lines.push({ type: 'worker', key, at, text: `Worker prepared the worktree${p.rebuilt === true ? ' (rebuilt)' : ''}` }); break;
      case 'droid_fixtures_written': {
        const fx = Array.isArray(p.fixtures) ? p.fixtures.length : 0;
        lines.push({ type: 'worker', key, at, text: `Worker wrote ${fx} fixture${fx === 1 ? '' : 's'} from order #${str(p.orderId)}: saved Tier 0 pages with audited values` });
        break;
      }
      case 'droid_rework_started': lines.push({ type: 'worker', key, at, text: "Rework: the Auditor's reason goes back to the same session" }); break;
      case 'droid_harness_updated': lines.push({ type: 'worker', key, at, text: `Worker updated the test harness: ${Array.isArray(p.files) ? p.files.map(String).join(', ') : ''}${p.reason ? ` (${str(p.reason)})` : ''}` }); break;
      case 'droid_prompt': lines.push({ type: 'prompt', key, at, text: str(p.text) }); break;
      case 'droid_tests':
        lines.push({ type: 'test', key, at, test: str(p.test) || 'test', status: str(p.status) || 'unknown', pass: num(p.pass), fail: num(p.fail), ms: num(p.ms), output: str(p.output) });
        break;
      case 'droid_compile_finished': lines.push({ type: 'finished', key, at, passed: typeof p.passed === 'boolean' ? p.passed : undefined }); break;
      case 'droid_tool_decision': {
        const d = { outcome: str(p.outcome), reason: str(p.reason) };
        const id = str(p.toolUseId);
        let line = id ? byUseId.get(id) : undefined;
        // run_command decisions come from our MCP tool and carry no toolUseId; they pair with the oldest undecided call of the same command.
        if (!line) {
          const i = pendingCommands.findIndex((l) => !l.decision && l.target === str(p.detail));
          if (i >= 0) line = pendingCommands.splice(i, 1)[0];
        }
        if (line) { line.decision = d; if (num(p.exitCode) !== undefined) line.exitCode = num(p.exitCode); }
        break;
      }
      case 'droid_droid_message': {
        const type = str(p.type);
        if (type === 'assistant') { const t = str(p.text).trim(); if (t) lines.push({ type: 'think', key, at, text: t }); }
        else if (type === 'tool_call') {
          const input = p.input && typeof p.input === 'object' ? p.input as Record<string, unknown> : {};
          const name = toolName(str(p.name));
          const line: ToolLine = { type: 'tool', key, at, name, target: targetOf(name, input), input };
          lines.push(line);
          const id = str(p.toolUseId);
          if (id) byUseId.set(id, line);
          if (name === 'run_command') pendingCommands.push(line);
        } else if (type === 'tool_result') {
          const line = byUseId.get(str(p.toolUseId));
          if (!line) break;
          const content = str(p.content);
          line.result = { isError: p.isError === true, content, at };
          const m = EXIT.exec(content);
          if (m && line.exitCode === undefined) line.exitCode = Number(m[1]);
          // Read-only tools are not gated by the policy; their outcome only arrives on the result.
          if (!line.decision && p.outcome) line.decision = { outcome: str(p.outcome), reason: '' };
        } else if (type === 'result') lines.push({ type: 'turn_done', key, at, durationMs: num(p.durationMs), success: typeof p.success === 'boolean' ? p.success : undefined });
        else if (type === 'error') lines.push({ type: 'error', key, at, text: str(p.message) || 'error' });
        break;
      }
      default: break;
    }
  }
  return lines;
}

export type Badge = 'allowed' | 'read-only' | 'denied' | 'approved' | 'waiting' | 'failed' | 'none';

export function badgeOf(line: ToolLine): Badge {
  const o = line.decision?.outcome ?? '';
  if (o.startsWith('not run')) return 'failed';
  if (o === 'denied' || o.startsWith('denied')) return 'denied';
  if (o === 'founder-approved') return 'approved';
  if (o === 'needs-approval') return 'waiting';
  if (o.includes('read-only')) return 'read-only';
  if (o.startsWith('auto-allowed')) return 'allowed';
  return 'none';
}

export type ConsoleStats = { files: number; commands: number; denied: number; failedCalls: number };

export function consoleStats(lines: readonly ConsoleLine[]): ConsoleStats {
  const tools = lines.filter((l): l is ToolLine => l.type === 'tool');
  return {
    files: new Set(tools.filter((t) => t.name === 'Create' || t.name === 'Edit').map((t) => t.target)).size,
    commands: tools.filter((t) => t.name === 'run_command' && badgeOf(t) !== 'failed').length,
    denied: tools.filter((t) => badgeOf(t) === 'denied').length,
    failedCalls: tools.filter((t) => badgeOf(t) === 'failed').length,
  };
}

// The tool output cuts long strings and appends "… [N more chars]".
const CUT = /… \[(\d+) more chars\]$/;
export function splitCut(s: string): { text: string; more: number } {
  const m = CUT.exec(s);
  return m ? { text: s.slice(0, m.index), more: Number(m[1]) } : { text: s, more: 0 };
}

// Replay schedule: real gaps between lines, except waits over `maxGapUs` play as `shortGapUs` and are reported.
export type Beat = { offsetUs: bigint; skippedUs: bigint };
export function replaySchedule(lines: readonly { at: bigint }[], maxGapUs = 10_000_000n, shortGapUs = 1_500_000n): Beat[] {
  const out: Beat[] = [];
  let offset = 0n;
  for (let i = 0; i < lines.length; i++) {
    const gap = i === 0 ? 0n : lines[i].at - lines[i - 1].at;
    const skipped = gap > maxGapUs ? gap - shortGapUs : 0n;
    offset += gap > maxGapUs ? shortGapUs : gap < 0n ? 0n : gap;
    out.push({ offsetUs: offset, skippedUs: skipped });
  }
  return out;
}
