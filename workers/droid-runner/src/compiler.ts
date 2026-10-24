// Compiles a Tier 0 API into a Tier 1 Actor: copies actors/template into a scratch directory
// outside the repo (no secrets inside), writes fixtures from the API's audited Tier 0 run, lets
// Droid implement src/extract.js under the compile policy and runs the three version tests.
// A rework resumes the same Droid session in the same directory with the Auditor's feedback.
// It never runs `apify push`; ship.ts does that after the founder approves.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ToolConfirmationOutcome, type CreateSessionOptions, type DroidSession } from '@factory/droid-sdk/node';
import { decideCompile, type Decision } from './policy.ts';
import { createLockedSession, disabledToolIdsFor, resumeLockedSession } from './lockdown.ts';
import { clipped, jsonlSink, type DroidEvent } from './events.ts';
import { cleanEnv, pick } from './env.ts';
import type { CommandLog } from './runTool.ts';

export type TestKind = 'fixtures' | 'contract' | 'live';
export type TestResult = { kind: TestKind; status: 'pass' | 'fail' | 'skipped'; exitCode: number | null; pass: number; fail: number; skipped: number; ms: number; output: string; live?: unknown };
export type PreviousTests = Partial<Record<TestKind, { status?: string; exitCode?: number | null; output?: string }>>;

export type CompileOptions = {
  repo: string;
  apiName: string;
  secrets: Record<string, string>;
  // Called with every event after it is written to the JSONL log.
  emit?: (evt: DroidEvent) => void;
  // A rework: resume this session with the Auditor's feedback and the previous test output.
  resume?: { sessionId: string; feedback: string; previousTests?: PreviousTests };
  // In-session repair turns after a failing attempt, before the result is reported.
  repairTurns?: number;
  // Founder decision for a needs-approval command; without it such commands are refused.
  approve?: (command: string, reason: string) => Promise<boolean>;
  copyBack?: boolean;
  // Offsets the turn numbers in the log, so a rework's turns follow the earlier ones.
  firstTurn?: number;
};

export type CompileSummary = {
  api: string;
  sessionId: string | null;
  passed: boolean;
  resumed: boolean;
  turns: Array<{ turn: number; mode: 'create' | 'resume'; result: unknown; tests: Array<Omit<TestResult, 'output'>> }>;
  tests: Record<TestKind, TestResult>;
  denied: Array<{ tool: string; detail: string; reason: string }>;
  approved: Array<{ tool: string; detail: string; reason: string }>;
  files: string[];
  diff: string;
  srcHash: string;
  wallMs: number;
  work: string;
  copiedTo: string | null;
  logPath: string;
  diffPath: string;
};

const COPY_SKIP = new Set(['node_modules', 'storage', 'fixtures', 'api.json', 'contract.json']);

function hashTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const rel = relative(dir, join(e.parentPath, e.name));
    if (rel.split('/')[0] === 'node_modules') continue;
    out.set(rel, createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex'));
  }
  return out;
}

// One hash over the extractor sources: what the Auditor accepted is what ship.ts pushes.
export function srcHash(actorDir: string): string {
  const files = [...hashTree(join(actorDir, 'src')).entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  return createHash('sha256').update(files.map(([f, h]) => `${f}\0${h}\n`).join('')).digest('hex');
}

// Stable per API so a rework can resumeSession in the same cwd.
export const workDirOf = (apiName: string) => join(realpathSync(process.env.FORGE_COMPILE_DIR ?? '/tmp'), 'forge-compile', apiName);

export async function runCompile(opts: CompileOptions): Promise<CompileSummary> {
  const { repo, apiName, secrets } = opts;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(apiName)) throw new Error(`bad api name ${JSON.stringify(apiName)}`);
  const t0 = Date.now();
  const stamp = new Date(t0).toISOString().replace(/[:.]/g, '-');
  const logPath = join(repo, 'workers/droid-runner/logs', `${apiName}-${stamp}.jsonl`);
  const diffPath = logPath.replace(/\.jsonl$/, '.diff');
  const env = cleanEnv();
  const work = workDirOf(apiName);
  const actorDir = join(work, 'actors', apiName);
  const baselineDir = join(work, 'baseline');

  const sessionRef: { id: string | null } = { id: opts.resume?.sessionId ?? null };
  const denied: CompileSummary['denied'] = [];
  const approved: CompileSummary['approved'] = [];
  const sink = jsonlSink(logPath, { api: apiName });
  const logEvent = (evt: DroidEvent) => {
    const full = { sessionId: sessionRef.id, ...evt };
    sink(full);
    opts.emit?.(full);
  };

  // ---------- 1. scratch Actor from the template, with fixtures ----------
  // A rework keeps the directory Droid worked in; it is rebuilt at the same path only if it is gone.
  const scaffold = !opts.resume || !existsSync(join(actorDir, 'api.json')) || !existsSync(baselineDir);
  if (scaffold) {
    rmSync(work, { recursive: true, force: true });
    mkdirSync(actorDir, { recursive: true });
    cpSync(join(repo, 'actors/template'), actorDir, {
      recursive: true,
      filter: (src) => !COPY_SKIP.has(relative(join(repo, 'actors/template'), src).split('/')[0]!),
    });
    const pkgPath = join(actorDir, 'package.json');
    writeFileSync(pkgPath, `${JSON.stringify({ ...JSON.parse(readFileSync(pkgPath, 'utf8')), name: `@forge/actor-${apiName}` }, null, 2)}\n`);
    const actorJsonPath = join(actorDir, '.actor/actor.json');
    writeFileSync(actorJsonPath, `${JSON.stringify({ ...JSON.parse(readFileSync(actorJsonPath, 'utf8')), name: `forge-${apiName}`, title: `FORGE ${apiName} (Tier 1)` }, null, 2)}\n`);
    // Outside the workspace pnpm would otherwise try to install the Actor's dependencies before `pnpm test`.
    writeFileSync(join(actorDir, '.npmrc'), 'verify-deps-before-run=false\n');

    logEvent({ kind: 'compile_started', work: actorDir, logPath, rebuilt: Boolean(opts.resume) });
    const mf = spawnSync(process.execPath, ['scripts/make-fixtures.mjs', apiName, '--out', actorDir], {
      cwd: actorDir, encoding: 'utf8', env: { PATH: process.env.PATH, ...pick(secrets, 'SPACETIME_HOST', 'SPACETIME_DB', 'APIFY_TOKEN') },
    });
    if (mf.status !== 0) {
      logEvent({ kind: 'fixtures_failed', output: clipped(mf.stderr || mf.stdout) });
      throw new Error(`make-fixtures failed: ${(mf.stderr || mf.stdout).slice(0, 2000)}`);
    }
    logEvent({ kind: 'fixtures_written', ...JSON.parse(mf.stdout) });
    cpSync(actorDir, baselineDir, { recursive: true });
  } else {
    logEvent({ kind: 'rework_started', work: actorDir, logPath, resumedSessionId: sessionRef.id });
  }

  // The CLI auto-approves Create/Edit inside the session cwd at Low autonomy without calling the
  // permission handler, so file writes are checked twice more: on each tool_call (interrupting the
  // turn on a denied path) and after each turn against the baseline, restoring protected files.
  const baselineHashes = hashTree(baselineDir);
  let changedFiles: string[] = [];
  function enforceFilePolicy(turn: number) {
    const now = hashTree(actorDir);
    const touched = new Set([...now.keys(), ...baselineHashes.keys()].filter((f) => now.get(f) !== baselineHashes.get(f)));
    const changed: string[] = [];
    for (const rel of touched) {
      const d = decideCompile(actorDir, { name: 'integrity', type: 'edit', filePath: rel });
      if (d.outcome === 'auto-allowed') { changed.push(rel); continue; }
      if (rel === '.npmrc') continue;
      if (baselineHashes.has(rel)) cpSync(join(baselineDir, rel), join(actorDir, rel));
      else rmSync(join(actorDir, rel), { force: true });
      denied.push({ tool: 'integrity_check', detail: rel, reason: `${d.reason} (reverted after the turn)` });
      logEvent({ kind: 'tool_decision', attempt: turn, tool: 'integrity_check', detail: rel, outcome: 'denied', reason: `${d.reason}; reverted` });
    }
    changedFiles = changed;
    logEvent({ kind: 'files_changed', attempt: turn, files: changed });
  }

  // ---------- 2. tests ----------
  function runTest(kind: TestKind): TestResult {
    const testEnv = kind === 'live' ? { ...env, ...pick(secrets, 'BRIGHTDATA_API_KEY', 'BRIGHTDATA_UNLOCKER_ZONE', 'BRIGHTDATA_BROWSER_WSS') } : env;
    const s = Date.now();
    const r = spawnSync(process.execPath, ['--test', `test/${kind}.test.js`], { cwd: actorDir, env: testEnv, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 << 20 });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const count = (label: string) => Number(output.match(new RegExp(`ℹ ${label} (\\d+)`))?.[1] ?? 0);
    const res: TestResult = {
      kind, exitCode: r.status, pass: count('pass'), fail: count('fail'), skipped: count('skipped'), ms: Date.now() - s, output,
      status: r.status !== 0 ? 'fail' : count('pass') === 0 && count('skipped') > 0 ? 'skipped' : 'pass',
    };
    const live = output.match(/LIVE (\{.*\})/)?.[1];
    if (live) res.live = JSON.parse(live);
    return res;
  }
  function runAllTests(turn: number): TestResult[] {
    const results = (['fixtures', 'contract', 'live'] as const).map(runTest);
    for (const r of results) logEvent({ kind: 'tests', attempt: turn, test: r.kind, status: r.status, pass: r.pass, fail: r.fail, skipped: r.skipped, ms: r.ms, live: r.live, output: clipped(r.output, 6000) });
    return results;
  }

  // ---------- 3. Droid session under the compile policy ----------
  const decisions = new Map<string, Decision & { tool: string; detail: string }>();
  const commandQueue: CommandLog[] = [];
  const commandOf = new Map<string, string>();
  let turn = opts.firstTurn ?? 1;

  const onCommand = (d: CommandLog) => {
    commandQueue.push(d);
    if (d.outcome === 'founder-approved') approved.push({ tool: d.tool, detail: d.detail, reason: d.reason });
    else if (d.outcome !== 'auto-allowed') denied.push({ tool: d.tool, detail: d.detail, reason: d.reason });
    logEvent({ kind: 'tool_decision', attempt: turn, tool: d.tool, detail: d.detail, outcome: d.outcome, reason: d.reason, exitCode: d.exitCode });
  };

  const permissionHandler: NonNullable<CreateSessionOptions['permissionHandler']> = ({ toolUses, options }) => {
    const ds = toolUses.map((t) => {
      const details = t.details as { type: string; filePath?: string; fullCommand?: string };
      const d = decideCompile(actorDir, { name: t.toolUse.name, type: details.type, filePath: details.filePath, command: details.fullCommand });
      const detail = details.filePath ?? details.fullCommand ?? '';
      decisions.set(t.toolUse.id, { ...d, tool: t.toolUse.name, detail });
      if (d.outcome !== 'auto-allowed') denied.push({ tool: t.toolUse.name, detail, reason: d.reason });
      logEvent({ kind: 'tool_decision', attempt: turn, tool: t.toolUse.name, toolUseId: t.toolUse.id, confirmation: details.type, detail, outcome: d.outcome === 'auto-allowed' ? d.outcome : 'denied', reason: d.reason });
      return d;
    });
    const want = ds.every((d) => d.outcome === 'auto-allowed') ? ToolConfirmationOutcome.ProceedOnce : ToolConfirmationOutcome.Cancel;
    if (!options.some((o) => o.value === want)) throw new Error(`permission outcome not offered: ${want}`);
    return want;
  };

  // Read-only tools (Read, LS, Glob, Grep, TodoWrite) never reach the permission handler.
  const outcomeOf = (toolUseId: string, toolName: string): string => {
    const d = decisions.get(toolUseId);
    if (d) return d.outcome;
    if (/run_command/.test(toolName)) {
      const i = commandQueue.findIndex((c) => c.detail === commandOf.get(toolUseId));
      return i >= 0 ? commandQueue.splice(i, 1)[0]!.outcome : 'not run (tool call failed before the policy)';
    }
    return 'auto-allowed (read-only, not gated)';
  };

  const FILE_TOOLS: Record<string, string> = { Create: 'create', Edit: 'edit', ApplyPatch: 'apply_patch' };

  async function streamTurn(session: DroidSession, prompt: string) {
    let result: Record<string, unknown> | null = null;
    for await (const msg of session.stream(prompt)) {
      switch (msg.type) {
        case 'tool_call': {
          logEvent({ kind: 'droid_message', attempt: turn, type: 'tool_call', name: msg.name, toolUseId: msg.toolUseId, input: clipped(msg.input, 2000) });
          const input = msg.input as { command?: string; file_path?: string };
          if (input.command) commandOf.set(msg.toolUseId, input.command);
          const type = FILE_TOOLS[msg.name];
          if (type && !decisions.has(msg.toolUseId)) {
            const d = decideCompile(actorDir, { name: msg.name, type, filePath: input.file_path });
            decisions.set(msg.toolUseId, { ...d, tool: msg.name, detail: input.file_path ?? '' });
            logEvent({ kind: 'tool_decision', attempt: turn, tool: msg.name, toolUseId: msg.toolUseId, detail: input.file_path ?? '', outcome: d.outcome === 'auto-allowed' ? d.outcome : 'denied', reason: d.reason });
            if (d.outcome !== 'auto-allowed') {
              denied.push({ tool: msg.name, detail: input.file_path ?? '', reason: d.reason });
              await session.interrupt();
            }
          }
          break;
        }
        case 'tool_result':
          logEvent({ kind: 'droid_message', attempt: turn, type: 'tool_result', toolName: msg.toolName, toolUseId: msg.toolUseId, isError: msg.isError, outcome: outcomeOf(msg.toolUseId, msg.toolName), content: clipped(msg.content, 3000) });
          break;
        case 'assistant':
          logEvent({ kind: 'droid_message', attempt: turn, type: 'assistant', text: clipped(msg.text) });
          break;
        case 'error':
          logEvent({ kind: 'droid_message', attempt: turn, type: 'error', message: msg.message, errorType: msg.errorType });
          break;
        case 'result':
          result = { success: msg.success, subtype: msg.subtype, turnCount: msg.turnCount, durationMs: msg.durationMs, tokenUsage: msg.tokenUsage, text: clipped(msg.text) };
          logEvent({ kind: 'droid_message', attempt: turn, type: 'result', ...result });
          break;
        default:
          logEvent({ kind: 'droid_message', attempt: turn, type: msg.type });
      }
    }
    return result;
  }

  const apiSpec = JSON.parse(readFileSync(join(actorDir, 'api.json'), 'utf8'));
  const RULES = [
    'Rules:',
    '- Change only src/extract.js (helper modules next to it under src/ are allowed). Template plumbing (src/main.js, src/run.js, src/fetchers.js, src/lib/), tests, fixtures, api.json, contract.json and package.json are read-only; writes to them are denied.',
    '- No LLM, no network, no new dependencies: plain JavaScript ES modules with Node built-ins only. Parse page.html and/or page.text with string and regex code.',
    '- Values and excerpts are copied verbatim from page.text; the quote anchor only normalizes whitespace and case. Never compute, reformat or guess a value; leave a field out when the listing does not show it.',
    '- It must also work on the live page: key off the page structure (markup patterns, labels), and never hardcode fixture values, product names or counts.',
    '- Run tests with the forge___run_command tool: `pnpm test`, or `node --test test/fixtures.test.js`. Shell operators, network access and paths outside this directory are denied; any other command waits for the founder\'s approval. Do not retry a denied call.',
  ];
  const compilePrompt = [
    `You are compiling the FORGE API "${apiName}" into a deterministic Tier 1 extractor.`,
    `Working directory: ${actorDir} (an Apify Actor made from the FORGE template). Output fields: ${Object.keys(apiSpec.outputSchema?.properties ?? {}).join(', ')}. Live source: ${apiSpec.sources?.join(', ')}.`,
    '',
    'Task: implement src/extract.js so the fixtures and contract tests pass. The live test is skipped in this session; it runs against the live source after you finish, and needs at least 80% of values anchored and a row count within 50% of the fixture.',
    '',
    'Read first: src/extract.js (the contract is in its header comment), api.json, test/harness.js, test/fixtures.test.js, test/contract.test.js, fixtures/*/meta.json and fixtures/*/expected.json (the audited Tier 0 values you must reproduce). The saved page is fixtures/*/page.txt (the text every excerpt is copied from) and fixtures/*/page.html (the raw HTML; it is large, so Grep it or Read it in slices instead of reading it whole).',
    '',
    ...RULES,
    '',
    'When the tests pass, reply with a short summary of your approach.',
  ].join('\n');

  const failedOutput = (tests: Array<{ kind: string; status?: string; exitCode?: number | null; output?: string }>) =>
    tests.filter((r) => r.status === 'fail').map((r) => `\n--- ${r.kind} test (exit ${r.exitCode ?? '?'}) ---\n${(r.output ?? '').slice(-6000)}`);
  const repairPrompt = (failed: TestResult[]) => [
    'The version tests failed after your change. Fix src/extract.js so they pass; the same rules apply.',
    ...failedOutput(failed),
  ].join('\n');
  const reworkPrompt = (feedback: string, previous: PreviousTests | undefined) => [
    'The FORGE Auditor rejected your last compile of this API. Its reason:',
    feedback,
    '',
    'Fix src/extract.js so the fixtures, contract and live tests pass. The live test runs against the live source after you finish.',
    ...failedOutput(Object.entries(previous ?? {}).map(([kind, r]) => ({ kind, ...(r ?? {}) }))),
    '',
    ...RULES,
    '',
    'When the tests pass, reply with a short summary of what you changed.',
  ].join('\n');

  const apiKey = secrets.FACTORY_API_KEY;
  const command = { decide: decideCompile, env, approve: opts.approve };
  const turns: CompileSummary['turns'] = [];
  let final: TestResult[] = [];

  const runTurn = async (session: DroidSession, prompt: string, mode: 'create' | 'resume') => {
    logEvent({ kind: 'prompt', attempt: turn, text: clipped(prompt, 20000) });
    let result;
    try { result = await streamTurn(session, prompt); } finally { await session.close(); }
    enforceFilePolicy(turn);
    final = runAllTests(turn);
    turns.push({ turn, mode, result, tests: final.map(({ output, ...r }) => r) });
    turn++;
  };

  if (opts.resume) {
    const disabled = await disabledToolIdsFor(actorDir, apiKey);
    const { session } = await resumeLockedSession(opts.resume.sessionId, { cwd: actorDir, apiKey, onCommand, command, permissionHandler, disabled });
    logEvent({ kind: 'session_resumed', resumedSessionId: session.id, cwd: actorDir });
    await runTurn(session, reworkPrompt(opts.resume.feedback, opts.resume.previousTests), 'resume');
  } else {
    const lock = await createLockedSession({ cwd: actorDir, apiKey, onCommand, command, permissionHandler });
    sessionRef.id = lock.session.id;
    logEvent({ kind: 'session_created', keptTools: lock.kept, disabledCount: lock.disabled.length, cwd: actorDir });
    await runTurn(lock.session, compilePrompt, 'create');
  }

  const failed = () => final.filter((r) => r.status === 'fail');
  for (let i = 0; i < (opts.repairTurns ?? 0) && failed().length; i++) {
    const disabled = await disabledToolIdsFor(actorDir, apiKey);
    const { session } = await resumeLockedSession(sessionRef.id!, { cwd: actorDir, apiKey, onCommand, command, permissionHandler, disabled });
    logEvent({ kind: 'repair_started', attempt: turn, failed: failed().map((r) => r.kind), resumedSessionId: session.id });
    await runTurn(session, repairPrompt(failed()), 'resume');
  }

  // ---------- 4. diff, copy back, summary ----------
  const diff = spawnSync('git', ['diff', '--no-index', '--no-color', '--', 'baseline/src', `actors/${apiName}/src`], { cwd: work, encoding: 'utf8' });
  writeFileSync(diffPath, diff.stdout);

  const target = join(repo, 'actors', apiName);
  if (opts.copyBack) {
    cpSync(actorDir, target, { recursive: true, force: true, filter: (src) => !/(^|\/)(node_modules|\.npmrc)$/.test(relative(actorDir, src)) });
  }

  const tests = Object.fromEntries(final.map((r) => [r.kind, r])) as Record<TestKind, TestResult>;
  const summary: CompileSummary = {
    api: apiName,
    sessionId: sessionRef.id,
    passed: final.length === 3 && final.every((r) => r.status === 'pass'),
    resumed: Boolean(opts.resume),
    turns,
    tests,
    denied,
    approved,
    files: changedFiles,
    diff: diff.stdout,
    srcHash: srcHash(actorDir),
    wallMs: Date.now() - t0,
    work: actorDir,
    copiedTo: opts.copyBack ? target : null,
    logPath,
    diffPath,
  };
  logEvent({ kind: 'compile_finished', ...clipped({ ...summary, diff: undefined, tests: Object.fromEntries(final.map(({ output, ...r }) => [r.kind, r])) }, 2000) });
  return summary;
}
