// Usage: pnpm --filter @forge/droid-runner compile <apiName> [--no-copy-back]
// Compiles a Tier 0 API into a Tier 1 Actor: copies actors/template into a scratch directory
// outside the repo (no secrets inside), writes fixtures from the API's audited Tier 0 run, lets
// Droid implement src/extract.js under the compile policy, runs the three version tests, and
// resumes the same Droid session once to repair if they fail. It never runs `apify push`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ToolConfirmationOutcome, type CreateSessionOptions, type DroidSession } from '@factory/droid-sdk/node';
import { decideCompile, type Decision } from './policy.ts';
import { createLockedSession, resumeLockedSession } from './lockdown.ts';
import { clipped, jsonlSink, type DroidEvent } from './events.ts';
import type { CommandLog } from './runTool.ts';

const args = process.argv.slice(2);
const apiName = args.find((a) => !a.startsWith('--'));
if (!apiName || !/^[a-z0-9][a-z0-9-]*$/.test(apiName)) throw new Error('usage: compile <apiName> (lowercase letters, digits, dashes)');
const copyBack = !args.includes('--no-copy-back');

const repo = resolve(import.meta.dirname, '../../..');
const t0 = Date.now();
const stamp = new Date(t0).toISOString().replace(/[:.]/g, '-');
const logPath = join(repo, 'workers/droid-runner/logs', `${apiName}-${stamp}.jsonl`);
const diffPath = logPath.replace(/\.jsonl$/, '.diff');

// The repo .env is read into this object only. It is never loaded into process.env, so neither
// the droid CLI nor Droid's commands inherit it; each child gets just the keys it needs.
const secrets = Object.fromEntries(
  readFileSync(join(repo, '.env'), 'utf8').split('\n')
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [m[1]!, m[2]!.replace(/^(['"])(.*)\1$/, '$2')]),
) as Record<string, string>;
const pick = (...keys: string[]) => Object.fromEntries(keys.filter((k) => secrets[k]).map((k) => [k, secrets[k]!]));
const SECRETISH = /KEY|TOKEN|SECRET|SEED|PASS|WSS|AUTH|COOKIE|CREDENTIAL/i;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRETISH.test(k))) as NodeJS.ProcessEnv;

// Stable per API so a later follow-up can resumeSession in the same cwd.
const workRoot = realpathSync(process.env.FORGE_COMPILE_DIR ?? '/tmp');
const work = join(workRoot, 'forge-compile', apiName);
const actorDir = join(work, 'actors', apiName);
const baselineDir = join(work, 'baseline');

const sessionRef: { id: string | null } = { id: null };
const denied: Array<{ tool: string; detail: string; reason: string }> = [];
const sink = jsonlSink(logPath, { api: apiName });
const logEvent = (evt: DroidEvent) => sink({ sessionId: sessionRef.id, ...evt });

// ---------- 1. scratch Actor from the template, with fixtures ----------
const COPY_SKIP = new Set(['node_modules', 'storage', 'fixtures', 'api.json', 'contract.json']);
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

logEvent({ kind: 'compile_started', work: actorDir, logPath });
const mf = spawnSync(process.execPath, ['scripts/make-fixtures.mjs', apiName, '--out', actorDir], {
  cwd: actorDir, encoding: 'utf8', env: { PATH: process.env.PATH, ...pick('SPACETIME_HOST', 'SPACETIME_DB', 'APIFY_TOKEN') },
});
if (mf.status !== 0) {
  logEvent({ kind: 'fixtures_failed', output: clipped(mf.stderr || mf.stdout) });
  throw new Error(`make-fixtures failed: ${mf.stderr || mf.stdout}`);
}
const fixtureSummary = JSON.parse(mf.stdout);
logEvent({ kind: 'fixtures_written', ...fixtureSummary });
cpSync(actorDir, baselineDir, { recursive: true });

// The CLI auto-approves Create/Edit inside the session cwd at Low autonomy without calling the
// permission handler, so file writes are checked twice more: on each tool_call (interrupting the
// turn on a denied path) and after each turn against the baseline, restoring protected files.
const hashTree = (dir: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const rel = relative(dir, join(e.parentPath, e.name));
    if (rel.split('/')[0] === 'node_modules') continue;
    out.set(rel, createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex'));
  }
  return out;
};
const baselineHashes = hashTree(baselineDir);

function enforceFilePolicy(attempt: number) {
  const now = hashTree(actorDir);
  const touched = new Set([...now.keys(), ...baselineHashes.keys()].filter((f) => now.get(f) !== baselineHashes.get(f)));
  const changed: string[] = [];
  for (const rel of touched) {
    const d = decideCompile(actorDir, { name: 'integrity', type: 'edit', filePath: rel });
    if (d.outcome === 'auto-allowed') { changed.push(rel); continue; }
    if (baselineHashes.has(rel)) cpSync(join(baselineDir, rel), join(actorDir, rel));
    else rmSync(join(actorDir, rel), { force: true });
    denied.push({ tool: 'integrity_check', detail: rel, reason: `${d.reason} (reverted after the turn)` });
    logEvent({ kind: 'tool_decision', attempt, tool: 'integrity_check', detail: rel, outcome: 'denied', reason: `${d.reason}; reverted` });
  }
  logEvent({ kind: 'files_changed', attempt, files: changed });
}

// ---------- 2. tests ----------
type TestKind = 'fixtures' | 'contract' | 'live';
type TestResult = { kind: TestKind; status: 'pass' | 'fail' | 'skipped'; exitCode: number | null; pass: number; fail: number; skipped: number; ms: number; output: string; live?: unknown };

function runTest(kind: TestKind): TestResult {
  const env = kind === 'live'
    ? { ...cleanEnv, ...pick('BRIGHTDATA_API_KEY', 'BRIGHTDATA_UNLOCKER_ZONE', 'BRIGHTDATA_BROWSER_WSS') }
    : cleanEnv;
  const s = Date.now();
  const r = spawnSync(process.execPath, ['--test', `test/${kind}.test.js`], { cwd: actorDir, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 << 20 });
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

function runAllTests(attempt: number): TestResult[] {
  const results = (['fixtures', 'contract', 'live'] as const).map(runTest);
  for (const r of results) logEvent({ kind: 'tests', attempt, test: r.kind, status: r.status, pass: r.pass, fail: r.fail, skipped: r.skipped, ms: r.ms, live: r.live, output: clipped(r.output, 6000) });
  return results;
}

// ---------- 3. Droid session under the compile policy ----------
const decisions = new Map<string, Decision & { tool: string; detail: string }>();
const commandQueue: CommandLog[] = [];
const commandOf = new Map<string, string>();

const onCommand = (d: CommandLog) => {
  commandQueue.push(d);
  if (d.outcome !== 'auto-allowed') denied.push({ tool: d.tool, detail: d.detail, reason: d.reason });
  logEvent({ kind: 'tool_decision', tool: d.tool, detail: d.detail, outcome: d.outcome, reason: d.reason, exitCode: d.exitCode });
};

const permissionHandler: NonNullable<CreateSessionOptions['permissionHandler']> = ({ toolUses, options }) => {
  const ds = toolUses.map((t) => {
    const details = t.details as { type: string; filePath?: string; fullCommand?: string };
    const d = decideCompile(actorDir, { name: t.toolUse.name, type: details.type, filePath: details.filePath, command: details.fullCommand });
    const detail = details.filePath ?? details.fullCommand ?? '';
    decisions.set(t.toolUse.id, { ...d, tool: t.toolUse.name, detail });
    if (d.outcome !== 'auto-allowed') denied.push({ tool: t.toolUse.name, detail, reason: d.reason });
    logEvent({ kind: 'tool_decision', tool: t.toolUse.name, toolUseId: t.toolUse.id, confirmation: details.type, detail, outcome: d.outcome, reason: d.reason });
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

async function streamTurn(session: DroidSession, prompt: string, attempt: number) {
  let result: Record<string, unknown> | null = null;
  for await (const msg of session.stream(prompt)) {
    switch (msg.type) {
      case 'tool_call': {
        logEvent({ kind: 'droid_message', attempt, type: 'tool_call', name: msg.name, toolUseId: msg.toolUseId, input: clipped(msg.input, 2000) });
        const input = msg.input as { command?: string; file_path?: string };
        if (input.command) commandOf.set(msg.toolUseId, input.command);
        const type = FILE_TOOLS[msg.name];
        if (type && !decisions.has(msg.toolUseId)) {
          const d = decideCompile(actorDir, { name: msg.name, type, filePath: input.file_path });
          decisions.set(msg.toolUseId, { ...d, tool: msg.name, detail: input.file_path ?? '' });
          logEvent({ kind: 'tool_decision', attempt, tool: msg.name, toolUseId: msg.toolUseId, detail: input.file_path ?? '', outcome: d.outcome, reason: d.reason });
          if (d.outcome !== 'auto-allowed') {
            denied.push({ tool: msg.name, detail: input.file_path ?? '', reason: d.reason });
            await session.interrupt();
          }
        }
        break;
      }
      case 'tool_result':
        logEvent({ kind: 'droid_message', attempt, type: 'tool_result', toolName: msg.toolName, toolUseId: msg.toolUseId, isError: msg.isError, outcome: outcomeOf(msg.toolUseId, msg.toolName), content: clipped(msg.content, 3000) });
        break;
      case 'assistant':
        logEvent({ kind: 'droid_message', attempt, type: 'assistant', text: clipped(msg.text) });
        break;
      case 'error':
        logEvent({ kind: 'droid_message', attempt, type: 'error', message: msg.message, errorType: msg.errorType });
        break;
      case 'result':
        result = { success: msg.success, subtype: msg.subtype, turnCount: msg.turnCount, durationMs: msg.durationMs, tokenUsage: msg.tokenUsage, text: clipped(msg.text) };
        logEvent({ kind: 'droid_message', attempt, type: 'result', ...result });
        break;
      default:
        logEvent({ kind: 'droid_message', attempt, type: msg.type });
    }
  }
  return result;
}

const apiSpec = JSON.parse(readFileSync(join(actorDir, 'api.json'), 'utf8'));
const compilePrompt = [
  `You are compiling the FORGE API "${apiName}" into a deterministic Tier 1 extractor.`,
  `Working directory: ${actorDir} (an Apify Actor made from the FORGE template). Output fields: ${Object.keys(apiSpec.outputSchema?.properties ?? {}).join(', ')}. Live source: ${apiSpec.sources?.join(', ')}.`,
  '',
  'Task: implement src/extract.js so the fixtures and contract tests pass. The live test is skipped in this session; it runs against the live source after you finish, and needs at least 80% of values anchored and a row count within 50% of the fixture.',
  '',
  'Read first: src/extract.js (the contract is in its header comment), api.json, test/harness.js, test/fixtures.test.js, test/contract.test.js, fixtures/*/meta.json and fixtures/*/expected.json (the audited Tier 0 values you must reproduce). The saved page is fixtures/*/page.txt (the text every excerpt is copied from) and fixtures/*/page.html (the raw HTML; it is large, so Grep it or Read it in slices instead of reading it whole).',
  '',
  'Rules:',
  '- Change only src/extract.js (helper modules next to it under src/ are allowed). Template plumbing (src/main.js, src/run.js, src/fetchers.js, src/lib/), tests, fixtures, api.json, contract.json and package.json are read-only; writes to them are denied.',
  '- No LLM, no network, no new dependencies: plain JavaScript ES modules with Node built-ins only. Parse page.html and/or page.text with string and regex code.',
  '- Values and excerpts are copied verbatim from page.text; the quote anchor only normalizes whitespace and case. Never compute, reformat or guess a value; leave a field out when the listing does not show it.',
  '- It must also work on the live page: key off the page structure (markup patterns, labels), and never hardcode fixture values, product names or counts.',
  '- Run tests with the forge___run_command tool: `pnpm test`, or `node --test test/fixtures.test.js`. Shell operators, network access and other commands are denied; do not retry a denied call.',
  '',
  'When the tests pass, reply with a short summary of your approach.',
].join('\n');

const repairPrompt = (failed: TestResult[]) => [
  'The version tests failed after your change. Fix src/extract.js so they pass; the same rules apply.',
  ...failed.map((r) => `\n--- ${r.kind} test (exit ${r.exitCode}) ---\n${r.output.slice(-6000)}`),
].join('\n');

const apiKey = secrets.FACTORY_API_KEY;
const command = { decide: decideCompile, env: cleanEnv };
const attempts: Array<{ attempt: number; mode: 'create' | 'resume'; result: unknown; tests: Array<Omit<TestResult, 'output'>> }> = [];
let disabled: string[] = [];
let final: TestResult[] = [];

{
  const lock = await createLockedSession({ cwd: actorDir, apiKey, onCommand, command, permissionHandler });
  disabled = lock.disabled;
  sessionRef.id = lock.session.id;
  logEvent({ kind: 'session_created', keptTools: lock.kept, disabledCount: lock.disabled.length, cwd: actorDir });
  logEvent({ kind: 'prompt', attempt: 1, text: compilePrompt });
  let result;
  try { result = await streamTurn(lock.session, compilePrompt, 1); } finally { await lock.session.close(); }
  enforceFilePolicy(1);
  final = runAllTests(1);
  attempts.push({ attempt: 1, mode: 'create', result, tests: final.map(({ output, ...r }) => r) });
}

const failed = () => final.filter((r) => r.status === 'fail');
if (failed().length) {
  const { session } = await resumeLockedSession(sessionRef.id!, { cwd: actorDir, apiKey, onCommand, command, permissionHandler, disabled });
  const prompt = repairPrompt(failed());
  logEvent({ kind: 'repair_started', attempt: 2, failed: failed().map((r) => r.kind), resumedSessionId: session.id });
  logEvent({ kind: 'prompt', attempt: 2, text: clipped(prompt, 20000) });
  let result;
  try { result = await streamTurn(session, prompt, 2); } finally { await session.close(); }
  enforceFilePolicy(2);
  final = runAllTests(2);
  attempts.push({ attempt: 2, mode: 'resume', result, tests: final.map(({ output, ...r }) => r) });
}

// ---------- 4. diff, copy back, summary ----------
const diff = spawnSync('git', ['diff', '--no-index', '--no-color', '--', 'baseline/src', `actors/${apiName}/src`], { cwd: work, encoding: 'utf8' });
writeFileSync(diffPath, diff.stdout);

const target = join(repo, 'actors', apiName);
if (copyBack) {
  cpSync(actorDir, target, { recursive: true, force: true, filter: (src) => !/(^|\/)(node_modules|\.npmrc)$/.test(relative(actorDir, src)) });
}

const summary = {
  api: apiName,
  sessionId: sessionRef.id,
  passed: final.every((r) => r.status !== 'fail'),
  attempts: attempts.length,
  tests: Object.fromEntries(final.map((r) => [r.kind, { status: r.status, pass: r.pass, fail: r.fail, skipped: r.skipped, live: r.live }])),
  attemptLog: attempts,
  denied,
  wallMs: Date.now() - t0,
  work: actorDir,
  copiedTo: copyBack ? target : null,
  logPath,
  diffPath,
};
logEvent({ kind: 'compile_finished', ...summary });
console.log(JSON.stringify(summary, null, 2));
if (!summary.passed) process.exitCode = 1;
