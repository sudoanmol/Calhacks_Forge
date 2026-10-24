// Usage: pnpm --filter @forge/droid-runner runner [--once] [--check] [--repair-turns <n>]
// The droid_runner seat: claims `compile` and `ship` tasks from SpacetimeDB and works them.
//   compile: runs Droid on the API (a rework resumes the same session with the Auditor's reason),
//            streams every message and tool decision through log_droid_event, asks the founder
//            (droid_action) about commands off the allowlist, then submit_compile or compile_failed.
//   ship:    after the founder approved api_ship: `apify push` of the audited actors/<api> and
//            record_api_version (Tier 1, engine actor).
// --check verifies the seat, the droid CLI and the queue without claiming anything.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { runCompile } from './compiler.ts';
import { REPO, readSecrets } from './env.ts';
import { clipped, type DroidEvent } from './events.ts';
import { auditedSrcHash, compileResults, droidEventArgs, previousTests } from './results.ts';
import { shipActor } from './ship.ts';
import { Stdb, type Row } from './stdb.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const repairTurns = Number(value('repair-turns') ?? 0);
if (!Number.isInteger(repairTurns) || repairTurns < 0) throw new Error('--repair-turns must be a whole number');

const POLL_MS = 10_000;
const RENEW_MS = 2 * 60_000;
const APPROVAL_POLL_MS = 3_000;
const APPROVAL_WAIT_MS = 10 * 60_000;
const KINDS = ['ship', 'compile'] as const;

const secrets = readSecrets();
for (const k of ['SPACETIME_HOST', 'SPACETIME_DB', 'SPACETIME_TOKEN_DROID_RUNNER']) if (!secrets[k]) throw new Error(`${k} is not set in .env`);
const db = new Stdb(secrets.SPACETIME_HOST!, secrets.SPACETIME_DB!, secrets.SPACETIME_TOKEN_DROID_RUNNER!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));

const seat = (await db.sql('SELECT * FROM staff')).find((s) => s.identity === db.identity);
if (seat?.role !== 'droid_runner') throw new Error(`identity ${db.identity} is ${seat ? `staff role ${String(seat.role)}` : 'not staff'}, not droid_runner`);

const mine = async (kind: string): Promise<Row[]> => (await db.sql(`SELECT * FROM task WHERE kind = '${kind}' AND status = 'claimed'`))
  .filter((t) => t.lease_owner === db.identity).sort((a, b) => Number(a.id) - Number(b.id));

if (flag('check')) {
  const droid = spawnSync('droid', ['--version'], { encoding: 'utf8' });
  const queued = Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k, (await db.sql(`SELECT * FROM task WHERE kind = '${k}' AND status = 'queued'`)).length])));
  console.log(JSON.stringify({
    seat: 'droid_runner', identity: db.identity, label: seat.label,
    droidCli: droid.status === 0 ? droid.stdout.trim() : `missing (${droid.error?.message ?? droid.stderr})`,
    factoryApiKey: Boolean(secrets.FACTORY_API_KEY), apifyToken: Boolean(secrets.APIFY_TOKEN && secrets.APIFY_USERNAME),
    queued, claimedByMe: Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k, (await mine(k)).length]))),
  }, null, 2));
  process.exit(0);
}

// Streams events to log_droid_event in order. A lost event is reported here and never stops the work.
function dbLog(taskId: number) {
  let chain = Promise.resolve();
  const emit = (evt: DroidEvent) => {
    const [kind, payload] = droidEventArgs(clipped(evt, 3000));
    chain = chain.then(() => db.call('log_droid_event', [taskId, kind, payload])).catch((err) => log('log_droid_event failed', { taskId, kind, error: String(err) }));
  };
  return { emit, flush: () => chain };
}

function keepLease(taskId: number) {
  const timer = setInterval(() => { db.call('renew_lease', [taskId]).catch((err) => log('renew_lease failed', { taskId, error: String(err) })); }, RENEW_MS);
  return () => clearInterval(timer);
}

// A command off the compile allowlist waits on the founder's droid_action card.
const approver = (taskId: number, emit: (e: DroidEvent) => void) => async (command: string, reason: string): Promise<boolean> => {
  const requestId = `t${taskId}-${randomUUID()}`;
  await db.call('request_droid_action', [taskId, requestId, 'run_command', command, reason]);
  emit({ kind: 'approval_waiting', requestId, command, reason });
  const t0 = Date.now();
  while (Date.now() - t0 < APPROVAL_WAIT_MS) {
    const ap = (await db.sql("SELECT * FROM approval WHERE kind = 'droid_action'")).find((a) => {
      try { return (JSON.parse(String(a.detail)) as { requestId?: string }).requestId === requestId; } catch { return false; }
    });
    if (ap && ap.status !== 'pending') {
      emit({ kind: 'approval_decided', requestId, command, status: ap.status });
      return ap.status === 'approved';
    }
    await sleep(APPROVAL_POLL_MS);
  }
  emit({ kind: 'approval_timed_out', requestId, command, waitedMs: APPROVAL_WAIT_MS });
  return false;
};

const jobOf = async (ticketId: unknown) => {
  const [job] = await db.sql(`SELECT * FROM compile_job WHERE ticket_id = ${Number(ticketId)}`);
  if (!job) throw new Error(`no compile job for ticket ${String(ticketId)}`);
  return job;
};

async function work(task: Row) {
  const taskId = Number(task.id);
  const input = JSON.parse(String(task.input)) as { api?: string };
  const apiName = input.api ?? '';
  const { emit, flush } = dbLog(taskId);
  const stopLease = keepLease(taskId);
  log('task started', { taskId, kind: task.kind, api: apiName, ticketId: task.ticket_id });
  try {
    const job = await jobOf(task.ticket_id);
    if (task.kind === 'compile') {
      const sessionId = String(job.droid_session_id ?? '');
      const s = await runCompile({
        repo: REPO, apiName, secrets, emit, repairTurns, copyBack: true, firstTurn: Number(job.attempt) + 1,
        approve: approver(taskId, emit),
        resume: sessionId ? { sessionId, feedback: String(job.feedback ?? ''), previousTests: previousTests(String(job.test_results ?? '')) } : undefined,
      });
      if (!s.sessionId) throw new Error('Droid returned no session id');
      await flush();
      await db.call('submit_compile', [taskId, s.sessionId, compileResults(s)]);
      log('compile submitted', { taskId, api: apiName, passed: s.passed, sessionId: s.sessionId, logPath: s.logPath });
    } else {
      const expected = auditedSrcHash(String(job.test_results ?? ''));
      if (!expected) throw new Error('the audited compile results carry no srcHash');
      const r = await shipActor({ repo: REPO, apiName, secrets, expectedSrcHash: expected, emit });
      emit({ kind: 'ship_build_confirmed', actorId: r.actorId, actorName: r.actorName, buildId: r.buildId, buildNumber: r.buildNumber, status: r.buildStatus });
      await flush();
      await db.call('record_api_version', [taskId, r.version, 1, 'actor', r.actorId, JSON.stringify(r.fields), String(job.droid_session_id), true]);
      log('version recorded', { taskId, api: apiName, actorId: r.actorId, version: r.version });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log('task failed', { taskId, kind: task.kind, error: reason });
    emit({ kind: 'runner_error', error: reason.slice(0, 2000) });
    await flush();
    await db.call('compile_failed', [taskId, `${task.kind}: ${reason}`.slice(0, 1900)]).catch((e) => log('compile_failed failed', { taskId, error: String(e) }));
  } finally {
    stopLease();
  }
}

// Leases this seat still holds (a restart mid-task) come first, then new claims.
async function next(): Promise<Row | undefined> {
  for (const kind of KINDS) {
    const [held] = await mine(kind);
    if (held) return held;
  }
  for (const kind of KINDS) {
    await db.call('claim_task', [kind]);
    const [claimed] = await mine(kind);
    if (claimed) return claimed;
  }
  return undefined;
}

log('droid-runner up', { identity: db.identity, repairTurns, once: flag('once') });
for (;;) {
  let task: Row | undefined;
  try { task = await next(); } catch (err) { log('claim failed', { error: String(err) }); }
  if (task) await work(task);
  if (flag('once')) break;
  if (!task) await sleep(POLL_MS);
}
