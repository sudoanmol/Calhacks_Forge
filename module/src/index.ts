import { schema, table, t, SenderError, Router, SyncResponse, type InferSchema, type ReducerCtx, type ProcedureCtx } from 'spacetimedb/server';
import { ScheduleAt, TimeDuration, Timestamp, type Identity } from 'spacetimedb';
import { base64, classify, compareChallenge, verifyValue, type Rung } from './text';
import { parseParams, resolveSources, validateApiInputs } from './params';
import { validateConfigValue } from './config';
import { droppedFields, evaluateTriggers, parseFields, refitBudget, testsPassed, type RunCounts } from './compile';
import { compareTexts, hostOf, looksLikeHtml, precheckSources, quotedOn, reachabilityProblem, robotsUrlFor, robotsVerdict, splitUrl, textHash } from './research';

const LEASE_MS = 10 * 60 * 1000;
const LEASE_SWEEP_EVERY_MICROS = 15_000_000n;

const ROLES = ['founder', 'front_desk', 'coo', 'research', 'cfo', 'auditor', 'droid_runner', 'canary'] as const;

// Founder levers (AGENTS.md §8). Values are strings; reducers parse what they need.
const CONFIG_DEFAULTS: Record<string, string> = {
  creao_max_concurrency: '2',
  refund_limit_cents: '500',
  page_cap: '25',
  blocked_domains: JSON.stringify(['facebook.com', 'instagram.com']),
  classify_min_confidence: '0.7',
  compile_min_buyers: '2',
  compile_min_verified_rate: '0.8',
  compile_window_runs: '5',
  compile_max_attempts: '3', // Auditor rejections a compile may get before the job fails
  markup_pct: '40',
  'bonus_rate.coo': '5',
  'bonus_rate.research': '5',
  'bonus_rate.cfo': '5',
  'bonus_rate.auditor': '5',
  'bonus_rate.droid_runner': '10',
  // Vendor prices for micro-USD cost per call. 1 USD per million tokens is 1 micro-USD per token.
  'price.llm_input_usd_per_mtok': '0.1', // Claude Haiku 5.5, prompts under 100K tokens
  'price.llm_output_usd_per_mtok': '0.5',
  'price.brightdata_unlocker_usd_per_1k': '1.5',
};

const config = table(
  { name: 'config', public: true },
  {
    key: t.string().primaryKey(),
    value: t.string(),
    updatedAt: t.timestamp(),
  },
);

const staff = table(
  { name: 'staff', public: true },
  {
    identity: t.identity().primaryKey(),
    role: t.string(),
    label: t.string(),
    addedAt: t.timestamp(),
  },
);

const task = table(
  { name: 'task', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string().index('btree'),
    role: t.string(),
    status: t.string(), // queued | claimed | done | failed
    orderId: t.option(t.u64()),
    ticketId: t.option(t.u64()),
    leaseOwner: t.option(t.identity()),
    leaseUntil: t.option(t.timestamp()),
    attempt: t.u32(),
    input: t.string(),
    output: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const event = table(
  { name: 'event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    at: t.timestamp(),
    actor: t.string(),
    kind: t.string(),
    refType: t.string(),
    refId: t.u64(),
    payload: t.string(),
  },
);

// One row per external run (CREAO, Apify, Bright Data, Droid).
const run = table(
  { name: 'run', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    provider: t.string(),
    externalId: t.string().index('btree'),
    appId: t.string(),
    taskId: t.option(t.u64()),
    threadId: t.string(),
    status: t.string(), // starting | pending | running | completed | failed | cancelled | start_failed
    resultText: t.string(),
    shareUrl: t.string(),
    costCents: t.u32(),
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
  },
);

// One-time tokens in webhook URLs. Private: only procedures and routes read them.
const callbackToken = table(
  { name: 'callback_token' },
  {
    token: t.string().primaryKey(),
    provider: t.string(),
    runRef: t.u64(),
    usedAt: t.option(t.timestamp()),
  },
);
const leaseSweepSchedule = table(
  { name: 'lease_sweep_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);

// ---- Gate 1 schema (frozen after Gate 1: additive changes only) ----

const customer = table(
  { name: 'customer', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    asiSender: t.string().unique(),
    createdAt: t.timestamp(),
  },
);

// A named, re-runnable API over public web data (AGENTS.md §3).
const api = table(
  { name: 'api', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string().unique(),
    description: t.string(),
    inputs: t.string(), // JSON
    sources: t.string(), // JSON array of URLs, URL patterns or search queries
    outputSchema: t.string(), // JSON Schema
    volatility: t.string(), // stable | volatile
    freshnessWindowMin: t.u32(),
    pageCap: t.u32(),
    tier: t.u8(),
    currentVersionId: t.option(t.u64()),
    buyerCount: t.u32(),
    verifiedRateBp: t.u32(), // basis points over the last compile_window_runs runs
    costPerCallCents: t.u32(),
    createdAt: t.timestamp(),
  },
);

const apiVersion = table(
  { name: 'api_version', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    apiId: t.u64().index('btree'),
    version: t.string(),
    tier: t.u8(),
    engine: t.string(), // task | actor
    apifyId: t.string(),
    fields: t.string(), // JSON array of output field names
    droidSessionId: t.string(),
    testsPassed: t.bool(),
    shippedAt: t.option(t.timestamp()),
  },
);

const gateCheck = table(
  { name: 'gate_check', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    orderId: t.option(t.u64()),
    ticketId: t.option(t.u64()),
    check: t.string(),
    result: t.string(), // pass | fail | unclear
    citationUrl: t.string(),
    citationText: t.string(),
    at: t.timestamp(),
  },
);

// "order" is an SQL keyword, so the table is "orders".
const orders = table(
  { name: 'orders', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    ref: t.string().unique(), // chosen by the Front Desk so it can find the row it created
    customerId: t.u64().index('btree'),
    apiId: t.option(t.u64()),
    requestText: t.string(),
    intent: t.string(), // JSON from the Front Desk's ASI-1 parse
    params: t.string(), // JSON
    priceCents: t.u32(),
    // quoted | rejected_at_desk | paid | triaging | accepted | counteroffered | rejected | researching
    // | running | verifying | auditing | delivered | audit_rejected | failed
    status: t.string(),
    apiVersionId: t.option(t.u64()),
    apifyRunId: t.string(),
    datasetUrl: t.string(),
    stripeSessionId: t.string(),
    decisionReason: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const ticket = table(
  { name: 'ticket', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    orderId: t.option(t.u64()),
    apiId: t.option(t.u64()),
    label: t.string(), // challenge | enhancement | coverage | format | question | status | compile | warranty
    text: t.string(),
    confidenceBp: t.u32(),
    status: t.string(),
    createdAt: t.timestamp(),
  },
);

const valueRecord = table(
  { name: 'value_record', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    orderId: t.u64().index('btree'),
    apiId: t.u64(),
    row: t.u32(),
    entity: t.string(),
    metric: t.string(),
    value: t.string(),
    sourceUrl: t.string(),
    excerpt: t.string(),
    snapshotKey: t.string(),
    snapshotHash: t.string(),
    observedAt: t.timestamp(),
    verifiedAt: t.option(t.timestamp()),
    apiVersionId: t.u64(),
    tier: t.u8(),
    method: t.string(),
    status: t.string(), // extracted | verified | stale | mismatch | unverifiable | corrected
    freshValue: t.string(),
    supersedesId: t.option(t.u64()),
  },
);

// One row per Bright Data attempt (the fallback ladder is visible here).
const evidence = table(
  { name: 'evidence', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    valueRecordId: t.option(t.u64()),
    orderId: t.option(t.u64()),
    url: t.string(),
    method: t.string(), // unlocker | browser
    country: t.string(),
    httpStatus: t.u32(),
    attempt: t.u32(),
    ms: t.u32(),
    matched: t.bool(),
    reason: t.string(),
    snapshotHash: t.string(),
    fetchedAt: t.timestamp(),
  },
);

const challenge = table(
  { name: 'challenge', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    orderId: t.u64(),
    valueRecordId: t.u64(),
    reason: t.string(),
    status: t.string(), // rechecking | auditing | upheld | rejected
    verdict: t.string(),
    auditorReason: t.string(),
    createdAt: t.timestamp(),
    resolvedAt: t.option(t.timestamp()),
  },
);

const approval = table(
  { name: 'approval', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string(), // spend_over_cap | api_ship | droid_action | refund_over_limit
    refType: t.string(),
    refId: t.u64(),
    amountCents: t.u32(),
    detail: t.string(),
    status: t.string(), // pending | approved | rejected
    createdAt: t.timestamp(),
    decidedAt: t.option(t.timestamp()),
  },
);

const budget = table(
  { name: 'budget', public: true },
  {
    name: t.string().primaryKey(),
    capCents: t.u32(),
    reservedCents: t.u32(),
    spentCents: t.u32(),
  },
);

const bonus = table(
  { name: 'bonus', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    role: t.string(),
    orderId: t.option(t.u64()),
    taskId: t.option(t.u64()),
    amountCents: t.u32(),
    status: t.string(), // accrued | paid | clawed_back
    createdAt: t.timestamp(),
  },
);

// Double-entry ledger. Private: the dashboard reads the books summary instead.
const ledger = table(
  { name: 'ledger' },
  {
    id: t.u64().primaryKey().autoInc(),
    txId: t.u64().index('btree'),
    account: t.string(),
    amountCents: t.i64(),
    memo: t.string(),
    at: t.timestamp(),
  },
);

// Public per-account balances maintained by the Treasurer helpers.
const books = table(
  { name: 'books', public: true },
  {
    account: t.string().primaryKey(),
    balanceCents: t.i64(),
    updatedAt: t.timestamp(),
  },
);

// One-shot schedules: reducers queue outbound work here; the procedures do the IO.
const apiRunSchedule = table(
  { name: 'api_run_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    orderId: t.u64(),
  },
);
const verifySchedule = table(
  { name: 'verify_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    orderId: t.u64(),
  },
);

const dispatchSchedule = table(
  { name: 'dispatch_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);
// ---- Additions after the Gate 1 freeze (new tables only) ----

// Orders created by the canary seat. They run and verify for real but are never audited,
// never delivered and never count as buyers.
const canaryOrder = table(
  { name: 'canary_order', public: true },
  {
    orderId: t.u64().primaryKey(),
    markedAt: t.timestamp(),
  },
);

// A retired API stays in the api table for history but is hidden from the catalog and cannot be accepted.
const apiRetired = table(
  { name: 'api_retired', public: true },
  {
    apiId: t.u64().primaryKey(),
    name: t.string(),
    reason: t.string(),
    retiredAt: t.timestamp(),
  },
);

// Exact vendor cost of one Apify run of an API, in micro-USD (the ledger keeps rounded cents).
const runCost = table(
  { name: 'run_cost', public: true },
  {
    runId: t.u64().primaryKey(), // run.id of the Apify run
    orderId: t.u64().index('btree'),
    apiId: t.u64().index('btree'),
    apifyMicros: t.u64(),
    llmMicros: t.u64(),
    brightdataMicros: t.u64(),
    totalMicros: t.u64(),
    llmInputTokens: t.u64(),
    llmOutputTokens: t.u64(),
    actorUnlockerRequests: t.u32(), // successful Unlocker requests made by the Actor
    verifyUnlockerRequests: t.u32(), // successful Unlocker requests made by verify_values
    finalized: t.bool(), // true once verification is done and the vendor entries are booked
    at: t.timestamp(),
  },
);

// Average total cost per call over the API's last compile_window_runs finalized runs.
const apiCost = table(
  { name: 'api_cost', public: true },
  {
    apiId: t.u64().primaryKey(),
    costPerCallMicros: t.u64(),
    runs: t.u32(),
    updatedAt: t.timestamp(),
  },
);

// Apify's usageTotalUsd can still grow after a run ends; settle_run_cost re-reads it once later.
const costSettleSchedule = table(
  { name: 'cost_settle_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    runRef: t.u64(),
  },
);

// The recheck of a challenged value (AGENTS.md §3 Addition 2): the saved page the extractor read
// versus a fresh Bright Data fetch. One row per challenge, written by the recheck procedure.
const challengeCheck = table(
  { name: 'challenge_check', public: true },
  {
    challengeId: t.u64().primaryKey(),
    orderId: t.u64().index('btree'),
    valueRecordId: t.u64(),
    row: t.u32(),
    entity: t.string(),
    metric: t.string(),
    value: t.string(), // the delivered value
    excerpt: t.string(), // the delivered quote
    sourceUrl: t.string(),
    observedAt: t.timestamp(), // when the extractor read the saved page
    savedResult: t.string(), // match | changed | missing | unavailable
    savedReason: t.string(),
    savedValue: t.string(),
    savedQuote: t.string(),
    savedContext: t.string(),
    savedMs: t.u32(),
    freshResult: t.string(), // match | changed | missing | unavailable
    freshReason: t.string(),
    freshValue: t.string(),
    freshQuote: t.string(),
    freshContext: t.string(),
    freshMs: t.u32(),
    freshFetchedAt: t.timestamp(),
    correctedValue: t.string(), // a different value quoted verbatim from the saved page, or ''
    correctedExcerpt: t.string(),
    totalMs: t.u32(),
    checkedAt: t.timestamp(),
  },
);

// Test-mode refunds. Over config refund_limit_cents a refund waits on a founder approval.
const refund = table(
  { name: 'refund', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    orderId: t.u64().index('btree'),
    challengeId: t.u64(),
    amountCents: t.u32(),
    status: t.string(), // issued | pending_approval | rejected
    createdAt: t.timestamp(),
    decidedAt: t.option(t.timestamp()),
  },
);

const recheckSchedule = table(
  { name: 'recheck_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    challengeId: t.u64(),
  },
);

// One row per compile ticket (flow C): the trigger, the CFO's decision, the engineering budget reservation,
// the Droid session and its test results, through to the shipped Tier 1 version.
const compileJob = table(
  { name: 'compile_job', public: true },
  {
    ticketId: t.u64().primaryKey(),
    apiId: t.u64().index('btree'),
    trigger: t.string(), // verified_rate | buyers | challenge_upheld
    triggerDetail: t.string(), // JSON: the numbers that met the trigger
    // awaiting_cfo | awaiting_approval | queued | compiling | auditing | rework | ineligible | ship_pending | shipping
    // | shipped | deferred | repriced | rejected | ship_rejected | failed | closed
    status: t.string(),
    decision: t.string(), // '' until the CFO decides: COMPILE | DEFER | REPRICE
    amountCents: t.u32(), // COMPILE: the investment; REPRICE: the proposed price per call
    rationale: t.string(),
    overCapApproved: t.bool(),
    reservedCents: t.u32(),
    spentCents: t.u32(),
    attempt: t.u32(), // compile attempts submitted to the Auditor
    droidSessionId: t.string(),
    testsPassed: t.bool(),
    testResults: t.string(), // JSON from the droid-runner: tests, denied actions, diff
    feedback: t.string(), // the Auditor's last reason
    costBeforeMicros: t.u64(), // the API's cost per call when the ticket opened
    versionId: t.option(t.u64()),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);
// ---- Research seat (flow B): layer-3 gate fetches, reports and Tier 0 Task creation ----

// One row per research_fetch call. The fetched text is private (research_page_text) because it can be
// hundreds of KB; record_gate_check checks quotes against it.
const researchPage = table(
  { name: 'research_page', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    orderId: t.u64().index('btree'),
    kind: t.string(), // page | robots | search
    target: t.string(), // what Research asked for: a URL or a search query
    url: t.string(), // what was fetched: the page, its robots.txt, or the Google search URL
    ok: t.bool(),
    httpStatus: t.u32(),
    reason: t.string(),
    chars: t.u32(),
    textHash: t.string(),
    summary: t.string(), // JSON: robots verdict, search results count, or the comparison with the previous fetch
    ms: t.u32(),
    fetchedAt: t.timestamp(),
  },
);

const researchPageText = table(
  { name: 'research_page_text' },
  {
    pageId: t.u64().primaryKey(),
    text: t.string(),
  },
);

// The research_report reducer's findings (the table cannot share the reducer's name).
const researchFindings = table(
  { name: 'research_findings', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    orderId: t.u64().index('btree'),
    taskId: t.option(t.u64()),
    summary: t.string(),
    sources: t.string(), // JSON array of URLs or URL templates
    fields: t.string(), // JSON array of output field names
    volatility: t.string(), // stable | volatile
    freshnessWindowMin: t.u32(),
    confidenceBp: t.u32(),
    checks: t.string(), // JSON: the latest gate check per check name when the report was filed
    createdAt: t.timestamp(),
  },
);

// The Apify Task of forge-extract behind a COO-created Tier 0 API. Orders accepted before it exists wait.
const apifyTaskJob = table(
  { name: 'apify_task_job', public: true },
  {
    apiId: t.u64().primaryKey(),
    status: t.string(), // pending | created | failed
    apifyTaskId: t.string(),
    input: t.string(), // JSON Task input for forge-extract
    error: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const apifyTaskSchedule = table(
  { name: 'apify_task_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    apiId: t.u64(),
  },
);

const admissionJob = table({ name: 'admission_job', public: true }, {
  orderId: t.u64().primaryKey(), sources: t.string(), status: t.string(), volatility: t.string(),
  nextFetchAt: t.timestamp(), reason: t.string(), updatedAt: t.timestamp(),
});
const admissionSchedule = table({ name: 'admission_schedule' }, {
  scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), orderId: t.u64(), phase: t.u8(),
});

const spacetimedb = schema(
  {
    config, staff, task, event, run, callbackToken, leaseSweepSchedule,
    customer, api, apiVersion, gateCheck, orders, ticket, valueRecord, evidence, challenge,
    approval, budget, bonus, ledger, books, apiRunSchedule, verifySchedule, dispatchSchedule,
    canaryOrder, apiRetired, runCost, apiCost, costSettleSchedule, challengeCheck, refund, recheckSchedule, compileJob,
    researchPage, researchPageText, researchFindings, apifyTaskJob, apifyTaskSchedule, admissionJob, admissionSchedule,
  },
  // Set at publish time from the shell environment (spacetime publish reads declared names).
  {
    env: {
      CREAO_API_KEY: t.option(t.string()), PUBLIC_ROUTE_BASE: t.option(t.string()),
      APIFY_TOKEN: t.option(t.string()), BRIGHTDATA_API_KEY: t.option(t.string()), BRIGHTDATA_UNLOCKER_ZONE: t.option(t.string()),
      BRIGHTDATA_SERP_ZONE: t.option(t.string()),
      CREAO_APP_ID_COO: t.option(t.string()), CREAO_APP_ID_RESEARCH: t.option(t.string()),
      CREAO_APP_ID_CFO: t.option(t.string()), CREAO_APP_ID_AUDITOR: t.option(t.string()),
    },
  },
);
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function roleOf(ctx: Ctx, who: Identity): string | undefined {
  return ctx.db.staff.identity.find(who)?.role;
}

function requireRole(ctx: Ctx, ...allowed: string[]): string {
  const role = roleOf(ctx, ctx.sender);
  if (!role) throw new SenderError('unknown identity');
  if (!allowed.includes(role)) throw new SenderError(`role ${role} may not do this`);
  return role;
}

function logEvent(ctx: Ctx, actor: string, kind: string, refType: string, refId: bigint, payload: unknown) {
  ctx.db.event.insert({
    id: 0n, at: ctx.timestamp, actor, kind, refType, refId,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function addMs(ts: Timestamp, ms: number): Timestamp {
  return new Timestamp(ts.microsSinceUnixEpoch + BigInt(ms) * 1000n);
}

export const init = spacetimedb.init((ctx) => {
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    ctx.db.config.insert({ key, value, updatedAt: ctx.timestamp });
  }
  ctx.db.staff.insert({ identity: ctx.sender, role: 'founder', label: 'founder', addedAt: ctx.timestamp });
  ctx.db.leaseSweepSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(LEASE_SWEEP_EVERY_MICROS) });
  ctx.db.budget.insert({ name: 'engineering', capCents: 2000, reservedCents: 0, spentCents: 0 });
  ctx.db.dispatchSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(DISPATCH_EVERY_MICROS) });
  logEvent(ctx, 'founder', 'module_init', 'config', 0n, { configKeys: Object.keys(CONFIG_DEFAULTS).length });
});

export const set_staff = spacetimedb.reducer(
  { identity: t.identity(), role: t.string(), label: t.string() },
  (ctx, { identity, role, label }) => {
    requireRole(ctx, 'founder');
    if (!(ROLES as readonly string[]).includes(role)) throw new SenderError(`unknown role ${role}`);
    if (identity.isEqual(ctx.sender) && role !== 'founder') throw new SenderError('founder cannot demote itself');
    const existing = ctx.db.staff.identity.find(identity);
    if (existing) ctx.db.staff.identity.update({ ...existing, role, label });
    else ctx.db.staff.insert({ identity, role, label, addedAt: ctx.timestamp });
    logEvent(ctx, 'founder', 'staff_set', 'staff', 0n, { identity: identity.toHexString(), role, label });
  },
);

export const set_config = spacetimedb.reducer(
  { key: t.string(), value: t.string() },
  (ctx, { key, value }) => {
    requireRole(ctx, 'founder');
    const existing = ctx.db.config.key.find(key);
    if (!existing) throw new SenderError(`unknown config key ${key}`);
    try { validateConfigValue(key, value); } catch (err) { throw new SenderError(err instanceof Error ? err.message : String(err)); }
    ctx.db.config.key.update({ ...existing, value, updatedAt: ctx.timestamp });
    logEvent(ctx, 'founder', 'config_set', 'config', 0n, { key, from: existing.value, to: value });
    if (COMPILE_TRIGGER_KEYS.includes(key)) checkCompileTriggers(ctx, undefined, true);
  },
);

// Flows create tasks internally; this entry point exists for the canary and the founder.
export const enqueue_task = spacetimedb.reducer(
  { kind: t.string(), role: t.string(), input: t.string() },
  (ctx, { kind, role, input }) => {
    const actor = requireRole(ctx, 'founder', 'canary');
    if (!(ROLES as readonly string[]).includes(role)) throw new SenderError(`unknown role ${role}`);
    const row = ctx.db.task.insert({
      id: 0n, kind, role, status: 'queued', orderId: undefined, ticketId: undefined,
      leaseOwner: undefined, leaseUntil: undefined, attempt: 0, input, output: '',
      createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
    logEvent(ctx, actor, 'task_queued', 'task', row.id, { kind, role });
  },
);

export const cancel_task = spacetimedb.reducer({ id: t.u64(), reason: t.string() }, (ctx, { id, reason }) => {
  const actor = requireRole(ctx, 'founder');
  const row = ctx.db.task.id.find(id);
  if (!row) throw new SenderError(`task ${id} not found`);
  if (row.status !== 'queued') throw new SenderError(`task ${id} is ${row.status}, only queued tasks can be cancelled`);
  if (!reason.trim()) throw new SenderError('reason required');
  ctx.db.task.id.update({ ...row, status: 'cancelled', output: JSON.stringify({ reason }), updatedAt: ctx.timestamp });
  if (row.ticketId !== undefined && COMPILE_TASK_KINDS.includes(row.kind)) {
    const job = ctx.db.compileJob.ticketId.find(row.ticketId);
    if (job && JOB_ACTIVE.includes(job.status)) endJob(ctx, job, 'closed', actor, 'compile_closed', { reason });
  }
  logEvent(ctx, actor, 'task_cancelled', 'task', id, { reason });
});

export const claim_task = spacetimedb.reducer({ kind: t.string() }, (ctx, { kind }) => {
  const role = requireRole(ctx, ...ROLES.filter((r) => r !== 'founder'));
  const next = [...ctx.db.task.kind.filter(kind)]
    .filter((r) => r.role === role && r.status === 'queued')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (!next) return;
  ctx.db.task.id.update({
    ...next, status: 'claimed', leaseOwner: ctx.sender, leaseUntil: addMs(ctx.timestamp, LEASE_MS),
    attempt: next.attempt + 1, updatedAt: ctx.timestamp,
  });
  logEvent(ctx, role, 'task_claimed', 'task', next.id, { kind, attempt: next.attempt + 1 });
  onTaskClaimed(ctx, next);
});

export const complete_task = spacetimedb.reducer(
  { id: t.u64(), output: t.string() },
  (ctx, { id, output }) => {
    const role = requireRole(ctx, ...ROLES.filter((r) => r !== 'founder'));
    const row = ctx.db.task.id.find(id);
    if (!row) throw new SenderError(`no task ${id}`);
    if (row.status !== 'claimed' || !row.leaseOwner || !row.leaseOwner.isEqual(ctx.sender)) {
      throw new SenderError('not the lease owner');
    }
    if (row.leaseUntil && row.leaseUntil.microsSinceUnixEpoch < ctx.timestamp.microsSinceUnixEpoch) {
      throw new SenderError('lease expired');
    }
    ctx.db.task.id.update({ ...row, status: 'done', output, leaseUntil: undefined, updatedAt: ctx.timestamp });
    logEvent(ctx, role, 'task_done', 'task', id, { kind: row.kind });
  },
);

export const lease_sweep = spacetimedb.reducer(
  { onSchedule: leaseSweepSchedule },
  { arg: leaseSweepSchedule.rowType },
  (ctx, _args) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;
    for (const row of ctx.db.task.iter()) {
      if (row.status === 'claimed' && row.leaseUntil && row.leaseUntil.microsSinceUnixEpoch < now) {
        ctx.db.task.id.update({ ...row, status: 'queued', leaseOwner: undefined, leaseUntil: undefined, updatedAt: ctx.timestamp });
        logEvent(ctx, 'schedule', 'task_lease_expired', 'task', row.id, { attempt: row.attempt });
      }
    }
  },
);

// ---- Treasurer (code, not an LLM). Every txId's entries sum to zero. ----

function postTx(ctx: Ctx, memo: string, entries: [account: string, cents: bigint][]) {
  const sum = entries.reduce((s, [, c]) => s + c, 0n);
  if (sum !== 0n) throw new Error(`unbalanced tx ${memo}: ${sum}`);
  let txId = 0n;
  for (const [account, amountCents] of entries) {
    const row = ctx.db.ledger.insert({ id: 0n, txId, account, amountCents, memo, at: ctx.timestamp });
    // The first entry's row id names the transaction.
    if (txId === 0n) { txId = row.id; ctx.db.ledger.id.update({ ...row, txId }); }
    const cur = ctx.db.books.account.find(account);
    if (cur) ctx.db.books.account.update({ ...cur, balanceCents: cur.balanceCents + amountCents, updatedAt: ctx.timestamp });
    else ctx.db.books.insert({ account, balanceCents: amountCents, updatedAt: ctx.timestamp });
  }
  return txId;
}

function cfgInt(ctx: Ctx, key: string): number {
  const v = Number(ctx.db.config.key.find(key)?.value);
  if (!Number.isFinite(v)) throw new Error(`config ${key} is not a number`);
  return v;
}

function cfgNum(ctx: Ctx, key: string, fallback: number): number {
  const v = Number(ctx.db.config.key.find(key)?.value);
  return Number.isFinite(v) ? v : fallback;
}

const isCanary = (ctx: Ctx, orderId: bigint) => Boolean(ctx.db.canaryOrder.orderId.find(orderId));

// ---- Orders (flow A, AGENTS.md §6) ----

type Order = NonNullable<ReturnType<Ctx['db']['orders']['id']['find']>>;

function setOrder(ctx: Ctx, o: Order, patch: Partial<Order>, actor: string, kind: string, payload: unknown = {}) {
  const next = { ...o, ...patch, updatedAt: ctx.timestamp };
  ctx.db.orders.id.update(next);
  logEvent(ctx, actor, kind, 'order', o.id, { status: next.status, ...(payload as object) });
  return next;
}

function findOrder(ctx: Ctx, id: bigint): Order {
  const o = ctx.db.orders.id.find(id);
  if (!o) throw new SenderError(`no order ${id}`);
  return o;
}

function customerFor(ctx: Ctx, asiSender: string) {
  const existing = ctx.db.customer.asiSender.find(asiSender);
  if (existing) return existing;
  const row = ctx.db.customer.insert({ id: 0n, asiSender, createdAt: ctx.timestamp });
  logEvent(ctx, 'front_desk', 'customer_registered', 'customer', row.id, {});
  return row;
}

function queueTask(ctx: Ctx, kind: string, role: string, orderId: bigint | undefined, input: unknown) {
  const row = ctx.db.task.insert({
    id: 0n, kind, role, status: 'queued', orderId, ticketId: undefined,
    leaseOwner: undefined, leaseUntil: undefined, attempt: 0, input: JSON.stringify(input), output: '',
    createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
  });
  logEvent(ctx, 'rules', 'task_queued', 'task', row.id, { kind, role, orderId: orderId?.toString() ?? '' });
  return row;
}

function closeTasks(ctx: Ctx, orderId: bigint, kind: string, output: unknown) {
  for (const row of ctx.db.task.kind.filter(kind)) {
    if (row.orderId === orderId && row.status !== 'done') {
      ctx.db.task.id.update({ ...row, status: 'done', output: JSON.stringify(output), leaseUntil: undefined, updatedAt: ctx.timestamp });
    }
  }
}

export const create_order = spacetimedb.reducer(
  { ref: t.string(), asiSender: t.string(), requestText: t.string(), intent: t.string(), priceCents: t.u32() },
  (ctx, { ref, asiSender, requestText, intent, priceCents }) => {
    const role = requireRole(ctx, 'front_desk', 'canary');
    if (ctx.db.orders.ref.find(ref)) throw new SenderError(`order ref ${ref} exists`);
    const c = customerFor(ctx, asiSender);
    const o = ctx.db.orders.insert({
      id: 0n, ref, customerId: c.id, apiId: undefined, requestText, intent, params: '{}', priceCents, status: 'quoted',
      apiVersionId: undefined, apifyRunId: '', datasetUrl: '', stripeSessionId: '', decisionReason: '',
      createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
    ctx.db.gateCheck.insert({ id: 0n, orderId: o.id, ticketId: undefined, check: 'layer2', result: 'pass', citationUrl: '', citationText: '', at: ctx.timestamp });
    if (role === 'canary') ctx.db.canaryOrder.insert({ orderId: o.id, markedAt: ctx.timestamp });
    logEvent(ctx, role, 'order_quoted', 'order', o.id, { priceCents, customerId: c.id.toString(), canary: role === 'canary' });
  },
);

// Params for a templated API (contract in params.ts and above start_api_run). Set before the COO decides.
export const set_order_params = spacetimedb.reducer(
  { ref: t.string(), params: t.string() },
  (ctx, { ref, params }) => {
    const role = requireRole(ctx, 'front_desk', 'canary');
    const o = ctx.db.orders.ref.find(ref);
    if (!o) throw new SenderError(`no order ref ${ref}`);
    if (!['quoted', 'paid', 'triaging'].includes(o.status)) throw new SenderError(`order ${o.id} is ${o.status}; params are fixed`);
    let parsed: Record<string, string>;
    try { parsed = parseParams(params); } catch (err) { throw new SenderError((err as Error).message); }
    setOrder(ctx, o, { params: JSON.stringify(parsed) }, role, 'order_params_set', { params: parsed });
  },
);

export const reject_at_desk = spacetimedb.reducer(
  { ref: t.string(), asiSender: t.string(), requestText: t.string(), intent: t.string(), check: t.string(), reason: t.string() },
  (ctx, { ref, asiSender, requestText, intent, check, reason }) => {
    requireRole(ctx, 'front_desk', 'canary');
    if (ctx.db.orders.ref.find(ref)) throw new SenderError(`order ref ${ref} exists`);
    const c = customerFor(ctx, asiSender);
    const o = ctx.db.orders.insert({
      id: 0n, ref, customerId: c.id, apiId: undefined, requestText, intent, params: '{}', priceCents: 0, status: 'rejected_at_desk',
      apiVersionId: undefined, apifyRunId: '', datasetUrl: '', stripeSessionId: '', decisionReason: reason,
      createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
    ctx.db.gateCheck.insert({ id: 0n, orderId: o.id, ticketId: undefined, check, result: 'fail', citationUrl: '', citationText: reason, at: ctx.timestamp });
    logEvent(ctx, 'front_desk', 'order_rejected_at_desk', 'order', o.id, { check, reason });
  },
);

// The Front Desk calls this only after Stripe reports the checkout session as paid.
export const record_payment = spacetimedb.reducer(
  { ref: t.string(), stripeSessionId: t.string() },
  (ctx, { ref, stripeSessionId }) => {
    requireRole(ctx, 'front_desk', 'canary');
    const o = ctx.db.orders.ref.find(ref);
    if (!o) throw new SenderError(`no order ref ${ref}`);
    if (o.status !== 'quoted') throw new SenderError(`order ${o.id} is ${o.status}, not quoted`);
    const paid = setOrder(ctx, o, { status: 'paid', stripeSessionId }, 'front_desk', 'order_paid', { priceCents: o.priceCents });
    postTx(ctx, `payment order ${o.id} (TEST MODE)`, [['treasury', BigInt(o.priceCents)], [`customer:${o.id}`, -BigInt(o.priceCents)]]);
    queueTask(ctx, 'coo_triage', 'coo', paid.id, { orderId: paid.id.toString() });
  },
);

// Founder seeds the catalog; the COO creates APIs after accepting a new request (Gate 2).
export const create_api = spacetimedb.reducer(
  { spec: t.string(), apifyId: t.string(), engine: t.string() },
  (ctx, { spec, apifyId, engine }) => {
    const actor = requireRole(ctx, 'founder', 'coo');
    let s: {
      name: string; description: string; inputs?: unknown; sources: unknown[]; outputSchema: { properties?: Record<string, unknown> };
      volatility: string; freshnessWindowMin?: number; pageCap?: number; instructions?: unknown; markers?: unknown;
    };
    try { s = JSON.parse(spec); } catch { throw new SenderError('spec is not valid JSON'); }
    if (!/^[a-z0-9-]{3,40}$/.test(s.name)) throw new SenderError('api name must be 3-40 chars of a-z, 0-9, -');
    if (ctx.db.api.name.find(s.name)) throw new SenderError(`api ${s.name} exists`);
    if (!['stable', 'volatile'].includes(s.volatility)) throw new SenderError('volatility must be stable or volatile');
    if (!['task', 'actor'].includes(engine)) throw new SenderError('engine must be task or actor');
    try { validateApiInputs(JSON.stringify(s.inputs ?? {}), JSON.stringify(s.sources)); } catch (err) { throw new SenderError((err as Error).message); }
    const taskInput = actor === 'coo' ? cooTaskInput(ctx, s, apifyId, engine) : null;
    const a = ctx.db.api.insert({
      id: 0n, name: s.name, description: s.description, inputs: JSON.stringify(s.inputs ?? {}), sources: JSON.stringify(s.sources),
      outputSchema: JSON.stringify(s.outputSchema), volatility: s.volatility, freshnessWindowMin: s.freshnessWindowMin ?? 0,
      pageCap: s.pageCap ?? cfgInt(ctx, 'page_cap'), tier: 0, currentVersionId: undefined, buyerCount: 0, verifiedRateBp: 0,
      costPerCallCents: 0, createdAt: ctx.timestamp,
    });
    const v = ctx.db.apiVersion.insert({
      id: 0n, apiId: a.id, version: '0.1', tier: 0, engine, apifyId,
      fields: JSON.stringify(Object.keys(s.outputSchema.properties ?? {})), droidSessionId: '', testsPassed: false, shippedAt: ctx.timestamp,
    });
    ctx.db.api.id.update({ ...a, currentVersionId: v.id });
    logEvent(ctx, actor, 'api_created', 'api', a.id, { name: s.name, tier: 0, apifyId });
    if (taskInput) {
      ctx.db.apifyTaskJob.insert({ apiId: a.id, status: 'pending', apifyTaskId: '', input: JSON.stringify(taskInput), error: '', createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
      ctx.db.apifyTaskSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch), apiId: a.id });
      logEvent(ctx, actor, 'apify_task_queued', 'api', a.id, { name: s.name, sources: taskInput.sources });
    }
  },
);

const COO_DECISIONS = ['ACCEPT', 'COUNTEROFFER', 'REQUEST_RESEARCH', 'REJECT'];

export const coo_decide = spacetimedb.reducer(
  { orderId: t.u64(), decision: t.string(), apiName: t.string(), reason: t.string() },
  (ctx, { orderId, decision, apiName, reason }) => {
    requireRole(ctx, 'coo');
    if (!COO_DECISIONS.includes(decision)) throw new SenderError(`decision must be one of ${COO_DECISIONS.join(', ')}`);
    if (!reason.trim()) throw new SenderError('a reason is required');
    const o = findOrder(ctx, orderId);
    if (o.status !== 'paid' && o.status !== 'triaging') throw new SenderError(`order ${orderId} is ${o.status}; nothing to decide`);
    closeTasks(ctx, orderId, 'coo_triage', { decision, apiName, reason });
    if (decision === 'ACCEPT') {
      const a = ctx.db.api.name.find(apiName);
      if (!a) throw new SenderError(`no api ${apiName}; use REQUEST_RESEARCH for a new API`);
      if (ctx.db.apiRetired.apiId.find(a.id)) throw new SenderError(`api ${apiName} is retired`);
      try { resolveSources(a.inputs, a.sources, o.params); } catch (err) {
        throw new SenderError(`order params do not fit api ${apiName}: ${(err as Error).message}`);
      }
      setOrder(ctx, o, { status: 'accepted', apiId: a.id, apiVersionId: a.currentVersionId, decisionReason: reason }, 'coo', 'coo_accepted', { api: apiName, reason });
      ctx.db.apiRunSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch), orderId });
    } else if (decision === 'REQUEST_RESEARCH') {
      if ([...ctx.db.researchFindings.orderId.filter(orderId)].length) {
        throw new SenderError(`order ${orderId} already has a research report; decide ACCEPT, COUNTEROFFER or REJECT on its gate checks`);
      }
      setOrder(ctx, o, { status: 'researching', decisionReason: reason }, 'coo', 'coo_requested_research', { reason });
      startAdmission(ctx, o);
    } else {
      const status = decision === 'REJECT' ? 'rejected' : 'counteroffered';
      setOrder(ctx, o, { status, decisionReason: reason }, 'coo', `coo_${status}`, { reason });
    }
  },
);

export const audit_verdict = spacetimedb.reducer(
  { orderId: t.u64(), verdict: t.string(), reason: t.string() },
  (ctx, { orderId, verdict, reason }) => {
    requireRole(ctx, 'auditor');
    if (verdict !== 'ACCEPT' && verdict !== 'REJECT') throw new SenderError('verdict must be ACCEPT or REJECT');
    if (!reason.trim()) throw new SenderError('a reason is required');
    const o = findOrder(ctx, orderId);
    if (o.status !== 'auditing') throw new SenderError(`order ${orderId} is ${o.status}, not auditing`);
    if (isCanary(ctx, orderId)) throw new SenderError(`order ${orderId} is a canary order; canary orders are not audited`);
    closeTasks(ctx, orderId, 'audit', { verdict, reason });
    if (verdict === 'REJECT') {
      setOrder(ctx, o, { status: 'audit_rejected', decisionReason: reason }, 'auditor', 'audit_rejected', { reason });
      if (o.apiId !== undefined) checkCompileTriggers(ctx, o.apiId, false);
      return;
    }
    setOrder(ctx, o, { status: 'delivered', decisionReason: reason }, 'auditor', 'audit_accepted', { reason });
    // Bonuses accrue only on accepted work.
    for (const role of ['coo', 'auditor']) {
      const cents = Math.floor((o.priceCents * cfgInt(ctx, `bonus_rate.${role}`)) / 100);
      if (cents <= 0) continue;
      ctx.db.bonus.insert({ id: 0n, role, orderId, taskId: undefined, amountCents: cents, status: 'accrued', createdAt: ctx.timestamp });
      postTx(ctx, `bonus ${role} order ${orderId}`, [[`seat:${role}`, BigInt(cents)], ['treasury', -BigInt(cents)]]);
    }
    if (o.apiId !== undefined) {
      const a = ctx.db.api.id.find(o.apiId);
      const priorBuyer = [...ctx.db.orders.iter()].some((x) => x.id !== o.id && x.apiId === o.apiId && x.customerId === o.customerId
        && x.status === 'delivered' && !isCanary(ctx, x.id));
      if (a && !priorBuyer) ctx.db.api.id.update({ ...a, buyerCount: a.buyerCount + 1 });
      checkCompileTriggers(ctx, o.apiId, false);
    }
  },
);
// ---- Customer challenge (AGENTS.md §3 Addition 2, flow D) ----

const CHALLENGEABLE = ['verified', 'stale', 'corrected']; // statuses delivered as facts
const CHALLENGE_OPEN = ['rechecking', 'auditing'];
const metricKey = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, '_');

// The order's values as the customer sees them: a record another record supersedes is left out.
function currentValues(ctx: Ctx, orderId: bigint) {
  const recs = [...ctx.db.valueRecord.orderId.filter(orderId)];
  const superseded = new Set(recs.map((r) => r.supersedesId).filter((x) => x !== undefined));
  return recs.filter((r) => !superseded.has(r.id));
}

function closeChallengeTasks(ctx: Ctx, challengeId: bigint, output: unknown) {
  for (const row of ctx.db.task.kind.filter('audit_challenge')) {
    let input: { challengeId?: string } = {};
    try { input = JSON.parse(row.input); } catch { /* not ours */ }
    if (input.challengeId === challengeId.toString() && ['queued', 'claimed', 'dispatched'].includes(row.status)) {
      ctx.db.task.id.update({ ...row, status: 'done', output: JSON.stringify(output), leaseUntil: undefined, updatedAt: ctx.timestamp });
    }
  }
}

// The Front Desk opens a challenge for the customer who owns the delivered order. metric picks the value
// when the row has several; '' is fine for a one-value row.
export const open_challenge = spacetimedb.reducer(
  { orderId: t.u64(), asiSender: t.string(), row: t.u32(), metric: t.string(), reason: t.string() },
  (ctx, { orderId, asiSender, row, metric, reason }) => {
    requireRole(ctx, 'front_desk');
    if (!reason.trim()) throw new SenderError('a reason is required');
    const o = findOrder(ctx, orderId);
    const c = ctx.db.customer.asiSender.find(asiSender);
    if (!c || c.id !== o.customerId) throw new SenderError(`order ${orderId} does not belong to this customer`);
    if (o.status !== 'delivered') throw new SenderError(`order ${orderId} is ${o.status}; only a delivered order can be challenged`);
    const inRow = currentValues(ctx, orderId).filter((r) => r.row === row && r.metric !== '_page');
    if (!inRow.length) throw new SenderError(`order ${orderId} has no row ${row}`);
    const picked = metric.trim() ? inRow.filter((r) => metricKey(r.metric) === metricKey(metric)) : inRow;
    if (!picked.length) throw new SenderError(`row ${row} has no ${metric}; it has ${inRow.map((r) => r.metric).join(', ')}`);
    if (picked.length > 1) throw new SenderError(`row ${row} has ${picked.length} values (${picked.map((r) => r.metric).join(', ')}); say which one is wrong`);
    const v = picked[0]!;
    if (!CHALLENGEABLE.includes(v.status)) throw new SenderError(`row ${row} ${v.metric} was not delivered as a fact (status ${v.status})`);
    const open = [...ctx.db.challenge.iter()].find((x) => x.valueRecordId === v.id && CHALLENGE_OPEN.includes(x.status));
    if (open) throw new SenderError(`challenge ${open.id} on row ${row} ${v.metric} is already ${open.status}`);
    const ch = ctx.db.challenge.insert({
      id: 0n, orderId, valueRecordId: v.id, reason: reason.slice(0, 1000), status: 'rechecking', verdict: '', auditorReason: '',
      createdAt: ctx.timestamp, resolvedAt: undefined,
    });
    ctx.db.recheckSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch), challengeId: ch.id });
    logEvent(ctx, 'front_desk', 'challenge_opened', 'challenge', ch.id, {
      orderId: orderId.toString(), valueRecordId: v.id.toString(), row, metric: v.metric, value: v.value, reason: ch.reason,
    });
  },
);

const CHALLENGE_VERDICTS = ['UPHELD', 'REJECTED'];

// Auditor, after the recheck: UPHELD only when the saved page shows the extractor misread it.
export const challenge_verdict = spacetimedb.reducer(
  { challengeId: t.u64(), verdict: t.string(), reason: t.string() },
  (ctx, { challengeId, verdict, reason }) => {
    requireRole(ctx, 'auditor');
    if (!CHALLENGE_VERDICTS.includes(verdict)) throw new SenderError('verdict must be UPHELD or REJECTED');
    if (!reason.trim()) throw new SenderError('a reason is required');
    const ch = ctx.db.challenge.id.find(challengeId);
    if (!ch) throw new SenderError(`no challenge ${challengeId}`);
    if (ch.status !== 'auditing') throw new SenderError(`challenge ${challengeId} is ${ch.status}, not auditing`);
    const o = findOrder(ctx, ch.orderId);
    const v = ctx.db.valueRecord.id.find(ch.valueRecordId);
    if (!v) throw new Error(`challenge ${challengeId} has no value record`);
    const check = ctx.db.challengeCheck.challengeId.find(challengeId);
    closeChallengeTasks(ctx, challengeId, { verdict, reason });
    const resolved = { ...ch, verdict, auditorReason: reason, resolvedAt: ctx.timestamp };
    if (verdict === 'REJECTED') {
      ctx.db.challenge.id.update({ ...resolved, status: 'rejected' });
      logEvent(ctx, 'auditor', 'challenge_rejected', 'challenge', challengeId, {
        orderId: o.id.toString(), row: v.row, metric: v.metric, reason,
        savedQuote: check?.savedQuote ?? '', freshResult: check?.freshResult ?? '', freshValue: check?.freshValue ?? '',
      });
      return;
    }

    // The challenged value is superseded: by the value the saved page really shows, or withdrawn.
    const corrected = Boolean(check?.correctedValue);
    const next = ctx.db.valueRecord.insert({
      ...v, id: 0n, value: corrected ? check!.correctedValue : '', excerpt: corrected ? check!.correctedExcerpt : '',
      status: corrected ? 'corrected' : 'unverifiable', freshValue: '', verifiedAt: corrected ? ctx.timestamp : undefined,
      method: 'challenge', supersedesId: v.id,
    });

    // Refund what is left of the order's price; over the limit it waits on the founder.
    const refunded = [...ctx.db.refund.orderId.filter(o.id)].filter((r) => r.status !== 'rejected').reduce((s, r) => s + r.amountCents, 0);
    const amount = Math.max(0, o.priceCents - refunded);
    let refundRow: { id: bigint; status: string; amountCents: number } | undefined;
    if (amount > 0) {
      const overLimit = amount > cfgInt(ctx, 'refund_limit_cents');
      refundRow = ctx.db.refund.insert({
        id: 0n, orderId: o.id, challengeId, amountCents: amount, status: overLimit ? 'pending_approval' : 'issued',
        createdAt: ctx.timestamp, decidedAt: overLimit ? undefined : ctx.timestamp,
      });
      if (overLimit) {
        const ap = ctx.db.approval.insert({
          id: 0n, kind: 'refund_over_limit', refType: 'refund', refId: refundRow.id, amountCents: amount,
          detail: JSON.stringify({ orderId: o.id.toString(), challengeId: challengeId.toString(), limitCents: cfgInt(ctx, 'refund_limit_cents') }),
          status: 'pending', createdAt: ctx.timestamp, decidedAt: undefined,
        });
        logEvent(ctx, 'treasurer', 'approval_requested', 'approval', ap.id, { kind: ap.kind, amountCents: amount, refundId: refundRow.id.toString() });
      } else {
        postTx(ctx, `refund order ${o.id} challenge ${challengeId} (TEST MODE)`, [[`customer:${o.id}`, BigInt(amount)], ['treasury', -BigInt(amount)]]);
      }
    }

    // Bonuses are paid only for accepted work; this deliverable turned out wrong.
    const clawed: string[] = [];
    for (const b of [...ctx.db.bonus.iter()].filter((x) => x.orderId === o.id && (x.status === 'accrued' || x.status === 'paid'))) {
      ctx.db.bonus.id.update({ ...b, status: 'clawed_back' });
      postTx(ctx, `claw back ${b.role} bonus order ${o.id} challenge ${challengeId}`, [['treasury', BigInt(b.amountCents)], [`seat:${b.role}`, -BigInt(b.amountCents)]]);
      clawed.push(`${b.role}:${b.amountCents}`);
    }

    // An extractor error on a Tier 0 API is a compile trigger; on Tier 1 it is a warranty fix (AGENTS.md §3).
    const a = ctx.db.api.id.find(v.apiId);
    const label = a && a.tier === 0 ? 'compile' : 'warranty';
    const ticketText = `challenge ${challengeId} upheld on order ${o.id} row ${v.row} ${v.metric} (${a?.name ?? 'api ' + v.apiId}): ${reason}`.slice(0, 2000);
    let t = label === 'compile'
      ? openCompileTicket(ctx, v.apiId, 'challenge_upheld', { challengeId: challengeId.toString(), orderId: o.id.toString(), row: v.row, metric: v.metric }, ticketText, o.id)
      : [...ctx.db.ticket.iter()].find((x) => x.apiId === v.apiId && x.label === label && x.status === 'open');
    if (!t) {
      t = ctx.db.ticket.insert({
        id: 0n, orderId: o.id, apiId: v.apiId, label, confidenceBp: 10_000, status: 'open', createdAt: ctx.timestamp, text: ticketText,
      });
      logEvent(ctx, 'rules', 'ticket_opened', 'ticket', t.id, { label, apiId: v.apiId.toString(), trigger: 'challenge_upheld', challengeId: challengeId.toString() });
    }

    ctx.db.challenge.id.update({ ...resolved, status: 'upheld' });
    logEvent(ctx, 'auditor', 'challenge_upheld', 'challenge', challengeId, {
      orderId: o.id.toString(), row: v.row, metric: v.metric, reason, supersededBy: next.id.toString(), newStatus: next.status, newValue: next.value,
      refund: refundRow ? { id: refundRow.id.toString(), amountCents: refundRow.amountCents, status: refundRow.status } : null,
      clawedBack: clawed, ticketId: t.id.toString(),
    });
  },
);

// Founder: the only path that unblocks a gated action.
export const decide_approval = spacetimedb.reducer(
  { id: t.u64(), approve: t.bool() },
  (ctx, { id, approve }) => {
    requireRole(ctx, 'founder');
    const ap = ctx.db.approval.id.find(id);
    if (!ap) throw new SenderError(`no approval ${id}`);
    if (ap.status !== 'pending') throw new SenderError(`approval ${id} is ${ap.status}`);
    if (ap.kind === 'spend_over_cap' || ap.kind === 'api_ship' || ap.kind === 'droid_action') {
      ctx.db.approval.id.update({ ...ap, status: approve ? 'approved' : 'rejected', decidedAt: ctx.timestamp });
      // A droid_action decision is read by the waiting droid-runner; the compile kinds move the job on.
      if (ap.kind !== 'droid_action') decideCompileApproval(ctx, ap.kind, ap.refId, approve);
      logEvent(ctx, 'founder', approve ? 'approval_approved' : 'approval_rejected', 'approval', id, { kind: ap.kind, refType: ap.refType, refId: ap.refId.toString(), amountCents: ap.amountCents });
      return;
    }
    if (ap.kind !== 'refund_over_limit') throw new SenderError(`approval kind ${ap.kind} has no handler yet`);
    const r = ctx.db.refund.id.find(ap.refId);
    if (!r || r.status !== 'pending_approval') throw new SenderError(`refund ${ap.refId} is not pending approval`);
    ctx.db.approval.id.update({ ...ap, status: approve ? 'approved' : 'rejected', decidedAt: ctx.timestamp });
    ctx.db.refund.id.update({ ...r, status: approve ? 'issued' : 'rejected', decidedAt: ctx.timestamp });
    if (approve) postTx(ctx, `refund order ${r.orderId} challenge ${r.challengeId} (TEST MODE, founder-approved)`, [[`customer:${r.orderId}`, BigInt(r.amountCents)], ['treasury', -BigInt(r.amountCents)]]);
    logEvent(ctx, 'founder', approve ? 'approval_approved' : 'approval_rejected', 'approval', id, { kind: ap.kind, refundId: r.id.toString(), amountCents: r.amountCents });
  },
);

// Founder: change an API's params, sources or page cap. The output schema, name and volatility
// never change here (versions are additive only, AGENTS.md §2 rule 10).
export const update_api = spacetimedb.reducer(
  { name: t.string(), patch: t.string() },
  (ctx, { name, patch }) => {
    requireRole(ctx, 'founder');
    const a = ctx.db.api.name.find(name);
    if (!a) throw new SenderError(`no api ${name}`);
    let p: { description?: unknown; inputs?: unknown; sources?: unknown; pageCap?: unknown };
    try { p = JSON.parse(patch); } catch { throw new SenderError('patch is not valid JSON'); }
    const allowed = ['description', 'inputs', 'sources', 'pageCap'];
    const extra = Object.keys(p).filter((k) => !allowed.includes(k));
    if (extra.length) throw new SenderError(`patch may only set ${allowed.join(', ')}; got ${extra.join(', ')}`);
    const next = { ...a };
    if (p.description !== undefined) {
      if (typeof p.description !== 'string' || !p.description.trim()) throw new SenderError('description must be a non-empty string');
      next.description = p.description;
    }
    if (p.inputs !== undefined) next.inputs = JSON.stringify(p.inputs);
    if (p.sources !== undefined) {
      if (!Array.isArray(p.sources) || !p.sources.length) throw new SenderError('sources must be a non-empty array');
      next.sources = JSON.stringify(p.sources);
    }
    if (p.pageCap !== undefined) {
      if (!Number.isInteger(p.pageCap) || (p.pageCap as number) < 1 || (p.pageCap as number) > 50) throw new SenderError('pageCap must be an integer 1-50');
      next.pageCap = p.pageCap as number;
    }
    try { validateApiInputs(next.inputs, next.sources); } catch (err) { throw new SenderError((err as Error).message); }
    ctx.db.api.id.update(next);
    const from = { description: a.description, inputs: a.inputs, sources: a.sources, pageCap: a.pageCap };
    logEvent(ctx, 'founder', 'api_updated', 'api', a.id, { name, from, to: { description: next.description, inputs: next.inputs, sources: next.sources, pageCap: next.pageCap } });
  },
);

// Retirement stops new sales and preserves past orders, evidence, and accounting.
export const retire_api = spacetimedb.reducer(
  { name: t.string(), reason: t.string() },
  (ctx, { name, reason }) => {
    requireRole(ctx, 'founder');
    if (!reason.trim()) throw new SenderError('a reason is required');
    const a = ctx.db.api.name.find(name);
    if (!a) throw new SenderError(`no api ${name}`);
    if (ctx.db.apiRetired.apiId.find(a.id)) throw new SenderError(`api ${name} is already retired`);
    const open = [...ctx.db.orders.iter()].filter((o) => o.apiId === a.id && ['accepted', 'running', 'verifying', 'auditing'].includes(o.status));
    if (open.length) throw new SenderError(`api ${name} has ${open.length} order(s) in flight`);
    ctx.db.apiRetired.insert({ apiId: a.id, name, reason, retiredAt: ctx.timestamp });
    for (const j of ctx.db.compileJob.apiId.filter(a.id)) {
      if (JOB_ACTIVE.includes(j.status)) endJob(ctx, j, 'closed', 'founder', 'compile_closed', { reason: `api retired: ${reason}` });
    }
    logEvent(ctx, 'founder', 'api_retired', 'api', a.id, { name, reason });
  },
);

// Founder, one-off: mark canary orders created before canary_order existed and close their audit tasks.
export const backfill_canary_orders = spacetimedb.reducer((ctx) => {
  requireRole(ctx, 'founder');
  const canaryCustomer = ctx.db.customer.asiSender.find('canary');
  let marked = 0;
  let closed = 0;
  if (canaryCustomer) {
    for (const o of ctx.db.orders.customerId.filter(canaryCustomer.id)) {
      if (!isCanary(ctx, o.id)) { ctx.db.canaryOrder.insert({ orderId: o.id, markedAt: ctx.timestamp }); marked++; }
    }
  }
  for (const row of ctx.db.task.kind.filter('audit')) {
    if (row.orderId !== undefined && isCanary(ctx, row.orderId) && ['queued', 'claimed', 'dispatched'].includes(row.status)) {
      ctx.db.task.id.update({ ...row, status: 'cancelled', output: JSON.stringify({ reason: 'canary orders are not audited' }), leaseOwner: undefined, leaseUntil: undefined, updatedAt: ctx.timestamp });
      closed++;
    }
  }
  logEvent(ctx, 'founder', 'canary_orders_backfilled', 'order', 0n, { marked, auditTasksCancelled: closed });
});

// Gate 0 smoke test: a procedure that calls the outside world with no transaction open.
export const http_smoke = spacetimedb.procedure({ url: t.string() }, t.unit(), (ctx, { url }) => {
  ctx.withTx((tx) => requireRole(tx, 'founder', 'canary'));
  let status = 0;
  let bytes = 0;
  let error = '';
  try {
    const res = ctx.http.fetch(url, { method: 'GET' });
    status = res.status;
    bytes = res.text().length;
  } catch (err) {
    error = String(err);
  }
  ctx.withTx((tx) => logEvent(tx, 'procedure', 'http_smoke', 'url', 0n, { url, status, bytes, error }));
  return {};
});

export const ping = spacetimedb.httpHandler((ctx, req) => {
  const body = req.text();
  ctx.withTx((tx) => logEvent(tx, 'route', 'route_ping', 'route', 0n, { uri: String(req.uri), bytes: body.length }));
  return new SyncResponse('pong', { status: 200, headers: { 'content-type': 'text/plain' } });
});

const CREAO_BASE = 'https://agent.creao.ai';
const CREAO_TERMINAL = ['completed', 'failed', 'cancelled'];
const RESULT_TEXT_MAX = 20_000;

type CreaoRun = { id?: string; runId?: string; status?: string; threadId?: string; result?: { text?: string; chatText?: string } };

function creaoKey(env: IoCtx['env']): string {
  const key = env.get('CREAO_API_KEY');
  if (!key) throw new SenderError('CREAO_API_KEY is not set on the module');
  return key;
}

function addCallbackToken(ctx: Ctx, provider: string, runRef: bigint): string {
  // The run id keeps tokens unique even if a scheduled procedure repeats its RNG seed.
  const token = `${ctx.newUuidV4()}-${runRef}`;
  ctx.db.callbackToken.insert({ token, provider, runRef, usedAt: undefined });
  return token;
}

// Starts a CREAO run with a one-time webhook token. Gate 0 entry point; the dispatch schedule
// replaces direct calls once orders exist.
export const creao_start = spacetimedb.procedure(
  { appId: t.string(), inputs: t.string(), idempotencyKey: t.string(), threadId: t.string() },
  t.unit(),
  (ctx, { appId, inputs, idempotencyKey, threadId }) => {
    const { runId, token } = ctx.withTx((tx) => {
      requireRole(tx, 'founder', 'canary');
      const row = tx.db.run.insert({
        id: 0n, provider: 'creao', externalId: '', appId, taskId: undefined, threadId, status: 'starting',
        resultText: '', shareUrl: '', costCents: 0, startedAt: tx.timestamp, endedAt: undefined,
      });
      return { runId: row.id, token: addCallbackToken(tx, 'creao', row.id) };
    });
    const base = ctx.env.get('PUBLIC_ROUTE_BASE');
    const body: Record<string, unknown> = { appId, inputs: JSON.parse(inputs), idempotencyKey };
    if (base) body.webhookUrl = `${base}/creao-callback?token=${token}`;
    if (threadId) body.threadId = threadId;
    let status = 0;
    let text = '';
    try {
      const res = ctx.http.fetch(`${CREAO_BASE}/api/v1/runs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creaoKey(ctx.env)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      status = res.status;
      text = res.text();
    } catch (err) {
      text = String(err);
    }
    ctx.withTx((tx) => {
      const row = tx.db.run.id.find(runId)!;
      let parsed: CreaoRun = {};
      try { parsed = JSON.parse(text); } catch { /* error body */ }
      const ok = status === 202 || status === 200;
      tx.db.run.id.update({
        ...row,
        externalId: parsed.id ?? parsed.runId ?? '',
        status: ok ? (parsed.status ?? 'pending') : 'start_failed',
        resultText: ok ? '' : text.slice(0, 2000),
      });
      logEvent(tx, 'procedure', ok ? 'creao_run_started' : 'creao_run_start_failed', 'run', runId,
        { appId, httpStatus: status, externalId: parsed.id ?? parsed.runId ?? '', webhook: Boolean(base) });
    });
    return {};
  },
);

// Re-fetches a CREAO run with our key and stores the trusted status. Shared by the webhook
// route and the poll fallback. Webhook bodies are never trusted.
type IoCtx = Pick<ProcedureCtx<InferSchema<typeof spacetimedb>>, 'http' | 'env' | 'withTx'>;

function refreshCreaoRun(ctx: IoCtx, runRef: bigint, actor: string) {
  const row = ctx.withTx((tx) => tx.db.run.id.find(runRef));
  if (!row || !row.externalId) return { changed: false, status: row?.status ?? 'missing' };
  if (CREAO_TERMINAL.includes(row.status)) return { changed: false, status: row.status };
  const res = ctx.http.fetch(`${CREAO_BASE}/api/v1/runs/${encodeURIComponent(row.externalId)}`, {
    method: 'GET', headers: { Authorization: `Bearer ${creaoKey(ctx.env)}` },
  });
  const text = res.text();
  if (res.status !== 200) {
    ctx.withTx((tx) => logEvent(tx, actor, 'creao_refresh_failed', 'run', runRef, { httpStatus: res.status }));
    return { changed: false, status: row.status };
  }
  const fresh = JSON.parse(text) as CreaoRun;
  return ctx.withTx((tx) => {
    const cur = tx.db.run.id.find(runRef)!;
    const status = fresh.status ?? cur.status;
    if (status === cur.status) return { changed: false, status };
    const done = CREAO_TERMINAL.includes(status);
    const result = fresh.result?.text ?? fresh.result?.chatText ?? '';
    tx.db.run.id.update({
      ...cur, status, threadId: fresh.threadId ?? cur.threadId,
      resultText: result.slice(0, RESULT_TEXT_MAX), endedAt: done ? tx.timestamp : cur.endedAt,
    });
    logEvent(tx, actor, `creao_run_${status}`, 'run', runRef, { externalId: cur.externalId, threadId: fresh.threadId ?? '', resultChars: result.length });
    const task = done && cur.taskId !== undefined ? tx.db.task.id.find(cur.taskId) : undefined;
    if (task && task.status === 'dispatched') {
      // The agent acts only through reducers; a run that ends without one leaves the task undecided.
      tx.db.task.id.update({ ...task, status: 'failed', output: JSON.stringify({ runStatus: status, result: result.slice(0, 2000) }), updatedAt: tx.timestamp });
      logEvent(tx, actor, 'task_ended_without_decision', 'task', task.id, { runRef: runRef.toString(), runStatus: status });
    }
    return { changed: true, status };
  });
}

export const creao_poll = spacetimedb.procedure({ runRef: t.u64() }, t.unit(), (ctx, { runRef }) => {
  ctx.withTx((tx) => requireRole(tx, 'founder', 'canary'));
  refreshCreaoRun(ctx, runRef, 'procedure');
  return {};
});

export const creao_callback = spacetimedb.httpHandler((ctx, req) => {
  const token = /[?&]token=([^&]+)/.exec(String(req.uri))?.[1] ?? '';
  const claim = ctx.withTx((tx) => {
    const row = token ? tx.db.callbackToken.token.find(decodeURIComponent(token)) : undefined;
    if (!row || row.provider !== 'creao') return { ok: false as const, reason: 'unknown token' };
    if (row.usedAt) return { ok: false as const, reason: 'token already used' };
    return { ok: true as const, runRef: row.runRef };
  });
  if (!claim.ok) {
    ctx.withTx((tx) => logEvent(tx, 'route', 'creao_callback_rejected', 'run', 0n, { reason: claim.reason }));
    return new SyncResponse(claim.reason, { status: 403 });
  }
  const { status } = refreshCreaoRun(ctx, claim.runRef, 'route');
  // The token is spent only once the run is terminal, so CREAO's retries and any
  // intermediate notifications still get through.
  if (CREAO_TERMINAL.includes(status)) {
    ctx.withTx((tx) => {
      const row = tx.db.callbackToken.token.find(decodeURIComponent(token))!;
      tx.db.callbackToken.token.update({ ...row, usedAt: tx.timestamp });
    });
  }
  return new SyncResponse('ok', { status: 200 });
});
// ---- Outbound work for flow A. Pattern: read in a tx, close it, fetch, write in a new tx. ----

const APIFY_BASE = 'https://api.apify.com/v2';
const APIFY_TERMINAL = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'];
const ROLE_APP_ENV = { coo: 'CREAO_APP_ID_COO', research: 'CREAO_APP_ID_RESEARCH', cfo: 'CREAO_APP_ID_CFO', auditor: 'CREAO_APP_ID_AUDITOR' } as const;
const CREAO_ROLES = Object.keys(ROLE_APP_ENV);
// Tasks of any other kind (test fixtures, worker-only kinds) and canary orders' tasks are never sent to a paid CREAO run;
// the canary plays the COO itself.
const CREAO_KINDS = ['coo_triage', 'research_gate', 'audit', 'audit_challenge', 'cfo_compile', 'audit_compile'];
const DISPATCH_EVERY_MICROS = 5_000_000n;

function envOrThrow(env: IoCtx['env'], name: 'APIFY_TOKEN' | 'BRIGHTDATA_API_KEY' | 'BRIGHTDATA_UNLOCKER_ZONE' | 'BRIGHTDATA_SERP_ZONE'): string {
  const v = env.get(name);
  if (!v) throw new Error(`${name} is not set on the module`);
  return v;
}

function failOrder(tx: Ctx, orderId: bigint, actor: string, reason: string) {
  const o = tx.db.orders.id.find(orderId);
  if (o) setOrder(tx, o, { status: 'failed', decisionReason: reason }, actor, 'order_failed', { reason });
}

// Param contract (see params.ts). An API declares params in api.inputs and uses them as {name} in
// api.sources; the Front Desk sends values with set_order_params as a JSON object of strings:
//   open-roles: {"board":"<greenhouse board token>"}  (default "discord"), e.g. {"board":"lattice"}
//   yc-directory, gpu-listings: {} (no params)
// Values must match /^[a-z0-9-]{1,60}$/ and may not change a source's host. The run posts an input
// override of {pageCap: api.pageCap} plus {sources: <resolved>} when any source is templated (always
// for an Actor engine); everything else (outputSchema, instructions, markers) comes from the saved Task input.
export const start_api_run = spacetimedb.procedure(
  { onSchedule: apiRunSchedule },
  { arg: apiRunSchedule.rowType },
  t.unit(),
  (ctx, { arg }) => {
    const job = ctx.withTx((tx) => {
      const o = tx.db.orders.id.find(arg.orderId);
      if (!o || o.status !== 'accepted') return null;
      const v = o.apiVersionId !== undefined ? tx.db.apiVersion.id.find(o.apiVersionId) : undefined;
      if (v && !v.apifyId && tx.db.apifyTaskJob.apiId.find(v.apiId)?.status === 'pending') {
        // create_apify_task schedules this run again once the Tier 0 Task exists.
        logEvent(tx, 'procedure', 'api_run_waiting_for_task', 'order', o.id, { apiId: v.apiId.toString() });
        return null;
      }
      if (!v || !v.apifyId) { failOrder(tx, o.id, 'procedure', 'api has no runnable version'); return null; }
      const a = o.apiId !== undefined ? tx.db.api.id.find(o.apiId) : undefined;
      if (!a) { failOrder(tx, o.id, 'procedure', 'order has no api'); return null; }
      let resolved;
      try { resolved = resolveSources(a.inputs, a.sources, o.params); } catch (err) {
        failOrder(tx, o.id, 'procedure', `params: ${(err as Error).message}`);
        return null;
      }
      // A Task merges the body into its saved input; an Actor run takes the body as its whole input.
      const input: Record<string, unknown> = { pageCap: a.pageCap, ...(resolved.templated || v.engine !== 'task' ? { sources: resolved.sources } : {}) };
      const run = tx.db.run.insert({
        id: 0n, provider: 'apify', externalId: '', appId: v.apifyId, taskId: undefined, threadId: o.id.toString(), status: 'starting',
        resultText: '', shareUrl: '', costCents: 0, startedAt: tx.timestamp, endedAt: undefined,
      });
      return { orderId: o.id, apifyId: v.apifyId, engine: v.engine, runRef: run.id, input, params: resolved.params, token: addCallbackToken(tx, 'apify', run.id) };
    });
    if (!job) return {};
    const base = ctx.env.get('PUBLIC_ROUTE_BASE');
    const hooks = base ? [{ eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED_OUT'], requestUrl: `${base}/apify-callback?token=${job.token}` }] : [];
    const path = job.engine === 'task' ? `actor-tasks/${job.apifyId}` : `acts/${job.apifyId}`;
    let status = 0;
    let text = '';
    try {
      const res = ctx.http.fetch(`${APIFY_BASE}/${path}/runs?webhooks=${encodeURIComponent(base64(JSON.stringify(hooks)))}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${envOrThrow(ctx.env, 'APIFY_TOKEN')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(job.input),
      });
      status = res.status;
      text = res.text();
    } catch (err) {
      text = String(err);
    }
    ctx.withTx((tx) => {
      const run = tx.db.run.id.find(job.runRef)!;
      let data: { id?: string; status?: string } = {};
      try { data = (JSON.parse(text) as { data?: typeof data }).data ?? {}; } catch { /* error body */ }
      if (status !== 201 || !data.id) {
        tx.db.run.id.update({ ...run, status: 'start_failed', resultText: text.slice(0, 2000), endedAt: tx.timestamp });
        failOrder(tx, job.orderId, 'procedure', `apify start failed (http ${status})`);
        return;
      }
      tx.db.run.id.update({ ...run, externalId: data.id, status: data.status ?? 'READY',
        shareUrl: `https://console.apify.com/view/runs/${data.id}` });
      const o = tx.db.orders.id.find(job.orderId)!;
      setOrder(tx, o, { status: 'running', apifyRunId: data.id }, 'procedure', 'api_run_started', { apifyRunId: data.id, engine: job.engine, input: job.input, params: job.params });
    });
    return {};
  },
);

type ApifyItem = {
  row?: number; entity?: string; metric?: string; value?: string | null; excerpt?: string | null; sourceUrl?: string;
  snapshotKey?: string; snapshotHash?: string; observedAt?: string; method?: string; status?: string; reason?: string;
};

// RUN_SUMMARY written by forge-extract to the run's key-value store.
type RunSummary = { usage?: { inputTokens?: number; outputTokens?: number }; pages?: { attempts?: { method?: string; ok?: boolean }[] }[] };
type RunCost = NonNullable<ReturnType<Ctx['db']['runCost']['runId']['find']>>;

const usdToMicros = (usd: number) => BigInt(Math.max(0, Math.round(usd * 1_000_000)));
const microsToCents = (m: bigint) => (m + 5_000n) / 10_000n;

// Bright Data bills Web Unlocker per successful request, so only successful requests are counted.
function priceRunCost(tx: Ctx, r: RunCost): RunCost {
  const llm = Math.round(Number(r.llmInputTokens) * cfgNum(tx, 'price.llm_input_usd_per_mtok', 0)
    + Number(r.llmOutputTokens) * cfgNum(tx, 'price.llm_output_usd_per_mtok', 0));
  const bd = Math.round((r.actorUnlockerRequests + r.verifyUnlockerRequests) * cfgNum(tx, 'price.brightdata_unlocker_usd_per_1k', 0) * 1000);
  const llmMicros = BigInt(Math.max(0, llm));
  const brightdataMicros = BigInt(Math.max(0, bd));
  return { ...r, llmMicros, brightdataMicros, totalMicros: r.apifyMicros + llmMicros + brightdataMicros };
}

function recordRunCost(tx: Ctx, runRef: bigint, orderId: bigint, apiId: bigint, apifyUsd: number, summary: RunSummary | null) {
  if (tx.db.runCost.runId.find(runRef)) return;
  const tokens = (n: number | undefined) => BigInt(Math.max(0, Math.round(n ?? 0)));
  const actorUnlockerRequests = (summary?.pages ?? []).flatMap((pg) => pg.attempts ?? []).filter((a) => a.method === 'unlocker' && a.ok).length;
  tx.db.runCost.insert(priceRunCost(tx, {
    runId: runRef, orderId, apiId, apifyMicros: usdToMicros(apifyUsd), llmMicros: 0n, brightdataMicros: 0n, totalMicros: 0n,
    llmInputTokens: tokens(summary?.usage?.inputTokens), llmOutputTokens: tokens(summary?.usage?.outputTokens),
    actorUnlockerRequests, verifyUnlockerRequests: 0, finalized: false, at: tx.timestamp,
  }));
}

// Books the run's vendor costs once (rounded cents in the ledger, exact micro-USD in run_cost) and
// refreshes the API's average cost per call.
function finalizeRunCost(tx: Ctx, runRef: bigint, apifyUsd: number | undefined, verifyUnlockerRequests: number) {
  const cur = tx.db.runCost.runId.find(runRef);
  if (!cur || cur.finalized) return;
  const r = priceRunCost(tx, {
    ...cur, verifyUnlockerRequests, finalized: true, at: tx.timestamp,
    ...(apifyUsd !== undefined ? { apifyMicros: usdToMicros(apifyUsd) } : {}),
  });
  tx.db.runCost.runId.update(r);
  const run = tx.db.run.id.find(runRef);
  if (run) tx.db.run.id.update({ ...run, costCents: Number(microsToCents(r.apifyMicros)) });
  for (const [account, micros] of [['vendor:apify', r.apifyMicros], ['vendor:llm', r.llmMicros], ['vendor:brightdata', r.brightdataMicros]] as const) {
    const cents = microsToCents(micros);
    if (cents > 0n) postTx(tx, `${account} run ${runRef}`, [[account, cents], ['treasury', -cents]]);
  }
  const avg = refreshApiCost(tx, r.apiId);
  tx.db.costSettleSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(addMs(tx.timestamp, APIFY_SETTLE_MS).microsSinceUnixEpoch), runRef });
  logEvent(tx, 'treasurer', 'run_cost_booked', 'run', runRef, {
    apiId: r.apiId.toString(), apifyMicros: r.apifyMicros.toString(), llmMicros: r.llmMicros.toString(),
    brightdataMicros: r.brightdataMicros.toString(), totalMicros: r.totalMicros.toString(), apiCostPerCallMicros: avg.toString(),
  });
}

const APIFY_SETTLE_MS = 60_000;

function refreshApiCost(tx: Ctx, apiId: bigint): bigint {
  const window = Math.max(1, cfgInt(tx, 'compile_window_runs'));
  const finalized = [...tx.db.runCost.apiId.filter(apiId)].filter((x) => x.finalized);
  // Once the current version (e.g. a freshly compiled Tier 1) has runs, cost per call is measured on it alone.
  const current = tx.db.api.id.find(apiId)?.currentVersionId;
  const onCurrent = current === undefined ? [] : finalized.filter((x) => tx.db.orders.id.find(x.orderId)?.apiVersionId === current);
  const recent = (onCurrent.length ? onCurrent : finalized).sort((a, b) => (a.runId < b.runId ? 1 : -1)).slice(0, window);
  if (!recent.length) return 0n;
  const avg = recent.reduce((s, x) => s + x.totalMicros, 0n) / BigInt(recent.length);
  const row = { apiId, costPerCallMicros: avg, runs: recent.length, updatedAt: tx.timestamp };
  if (tx.db.apiCost.apiId.find(apiId)) tx.db.apiCost.apiId.update(row); else tx.db.apiCost.insert(row);
  const a = tx.db.api.id.find(apiId);
  if (a) tx.db.api.id.update({ ...a, costPerCallCents: Number(microsToCents(avg)) });
  return avg;
}

export const settle_run_cost = spacetimedb.procedure(
  { onSchedule: costSettleSchedule },
  { arg: costSettleSchedule.rowType },
  t.unit(),
  (ctx, { arg }) => {
    const externalId = ctx.withTx((tx) => {
      const cost = tx.db.runCost.runId.find(arg.runRef);
      const run = tx.db.run.id.find(arg.runRef);
      return cost?.finalized && run?.externalId ? run.externalId : null;
    });
    if (!externalId) return {};
    const res = ctx.http.fetch(`${APIFY_BASE}/actor-runs/${externalId}`, { headers: { Authorization: `Bearer ${envOrThrow(ctx.env, 'APIFY_TOKEN')}` } });
    if (res.status !== 200) {
      ctx.withTx((tx) => logEvent(tx, 'procedure', 'run_cost_settle_failed', 'run', arg.runRef, { httpStatus: res.status }));
      return {};
    }
    const usd = (JSON.parse(res.text()) as { data: { usageTotalUsd?: number } }).data.usageTotalUsd;
    if (usd === undefined) return {};
    ctx.withTx((tx) => {
      const cur = tx.db.runCost.runId.find(arg.runRef);
      if (!cur) return;
      const apifyMicros = usdToMicros(usd);
      if (apifyMicros === cur.apifyMicros) return;
      const r = priceRunCost(tx, { ...cur, apifyMicros });
      tx.db.runCost.runId.update(r);
      const run = tx.db.run.id.find(arg.runRef);
      if (run) tx.db.run.id.update({ ...run, costCents: Number(microsToCents(apifyMicros)) });
      const delta = microsToCents(apifyMicros) - microsToCents(cur.apifyMicros);
      if (delta !== 0n) postTx(tx, `vendor:apify settle run ${arg.runRef}`, [['vendor:apify', delta], ['treasury', -delta]]);
      const avg = refreshApiCost(tx, r.apiId);
      logEvent(tx, 'treasurer', 'run_cost_settled', 'run', arg.runRef, {
        apifyMicrosFrom: cur.apifyMicros.toString(), apifyMicros: apifyMicros.toString(), totalMicros: r.totalMicros.toString(), apiCostPerCallMicros: avg.toString(),
      });
    });
    return {};
  },
);

// Re-fetches an Apify run with our key and ingests its dataset once. Webhook bodies are never trusted.
function refreshApifyRun(ctx: IoCtx, runRef: bigint, actor: string): string {
  const row = ctx.withTx((tx) => tx.db.run.id.find(runRef));
  if (!row || !row.externalId) return row?.status ?? 'missing';
  if (APIFY_TERMINAL.includes(row.status)) return row.status;
  const key = envOrThrow(ctx.env, 'APIFY_TOKEN');
  const res = ctx.http.fetch(`${APIFY_BASE}/actor-runs/${row.externalId}`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status !== 200) {
    ctx.withTx((tx) => logEvent(tx, actor, 'apify_refresh_failed', 'run', runRef, { httpStatus: res.status }));
    return row.status;
  }
  const run = (JSON.parse(res.text()) as { data: { status: string; defaultDatasetId: string; defaultKeyValueStoreId?: string; usageTotalUsd?: number } }).data;
  if (!APIFY_TERMINAL.includes(run.status)) {
    ctx.withTx((tx) => { const cur = tx.db.run.id.find(runRef)!; if (cur.status !== run.status) tx.db.run.id.update({ ...cur, status: run.status }); });
    return run.status;
  }
  let items: ApifyItem[] = [];
  if (run.status === 'SUCCEEDED') {
    const r = ctx.http.fetch(`${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?clean=1&format=json`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.status === 200) items = JSON.parse(r.text()) as ApifyItem[];
  }
  let summary: RunSummary | null = null;
  if (run.defaultKeyValueStoreId) {
    const r = ctx.http.fetch(`${APIFY_BASE}/key-value-stores/${run.defaultKeyValueStoreId}/records/RUN_SUMMARY`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.status === 200) { try { summary = JSON.parse(r.text()) as RunSummary; } catch { /* no summary */ } }
  }
  const datasetUrl = `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?clean=1&format=json`;
  ctx.withTx((tx) => {
    const cur = tx.db.run.id.find(runRef)!;
    if (APIFY_TERMINAL.includes(cur.status)) return; // a retry already ingested this run
    const costCents = Math.round((run.usageTotalUsd ?? 0) * 100);
    tx.db.run.id.update({ ...cur, status: run.status, costCents, endedAt: tx.timestamp });
    const orderId = BigInt(cur.threadId);
    const o = tx.db.orders.id.find(orderId);
    if (!o || o.status !== 'running') return;
    recordRunCost(tx, runRef, orderId, o.apiId ?? 0n, run.usageTotalUsd ?? 0, summary);
    if (run.status !== 'SUCCEEDED') {
      finalizeRunCost(tx, runRef, undefined, 0);
      failOrder(tx, orderId, actor, `apify run ${run.status}`);
      return;
    }
    const v = o.apiVersionId !== undefined ? tx.db.apiVersion.id.find(o.apiVersionId) : undefined;
    const rows = new Map<string, number>();
    let extracted = 0;
    for (const it of items) {
      const k = `${it.sourceUrl}#${it.row ?? 'page'}`;
      if (!rows.has(k)) rows.set(k, rows.size);
      const pageFailed = it.metric === undefined;
      const status = it.status === 'extracted' ? 'extracted' : 'unverifiable';
      if (status === 'extracted') extracted++;
      tx.db.valueRecord.insert({
        id: 0n, orderId, apiId: o.apiId ?? 0n, row: rows.get(k)!, entity: pageFailed ? 'page' : String(it.entity ?? ''),
        metric: pageFailed ? '_page' : String(it.metric), value: String(it.value ?? ''),
        sourceUrl: String(it.sourceUrl ?? ''), excerpt: pageFailed ? String(it.reason ?? '') : String(it.excerpt ?? ''),
        snapshotKey: String(it.snapshotKey ?? ''), snapshotHash: String(it.snapshotHash ?? ''),
        observedAt: it.observedAt ? Timestamp.fromDate(new Date(it.observedAt)) : tx.timestamp, verifiedAt: undefined,
        apiVersionId: o.apiVersionId ?? 0n, tier: v?.tier ?? 0, method: String(it.method ?? ''), status, freshValue: '', supersedesId: undefined,
      });
    }
    setOrder(tx, o, { status: 'verifying', datasetUrl }, actor, 'api_run_ingested', { values: items.length, extracted, costCents });
    tx.db.verifySchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(tx.timestamp.microsSinceUnixEpoch), orderId });
  });
  return run.status;
}

export const apify_poll = spacetimedb.procedure({ runRef: t.u64() }, t.unit(), (ctx, { runRef }) => {
  ctx.withTx((tx) => requireRole(tx, 'founder', 'canary'));
  refreshApifyRun(ctx, runRef, 'procedure');
  return {};
});

export const apify_callback = spacetimedb.httpHandler((ctx, req) => {
  const token = decodeURIComponent(/[?&]token=([^&]+)/.exec(String(req.uri))?.[1] ?? '');
  const claim = ctx.withTx((tx) => {
    const row = token ? tx.db.callbackToken.token.find(token) : undefined;
    if (!row || row.provider !== 'apify') return { ok: false as const, reason: 'unknown token' };
    if (row.usedAt) return { ok: false as const, reason: 'token already used' };
    return { ok: true as const, runRef: row.runRef };
  });
  if (!claim.ok) {
    ctx.withTx((tx) => logEvent(tx, 'route', 'apify_callback_rejected', 'run', 0n, { reason: claim.reason }));
    return new SyncResponse(claim.reason, { status: 403 });
  }
  const status = refreshApifyRun(ctx, claim.runRef, 'route');
  if (APIFY_TERMINAL.includes(status)) {
    ctx.withTx((tx) => { const row = tx.db.callbackToken.token.find(token)!; tx.db.callbackToken.token.update({ ...row, usedAt: tx.timestamp }); });
  }
  return new SyncResponse('ok', { status: 200 });
});

// Research reuses the ladder for robots.txt and SERP JSON, which the page classifier would call too short.
type LadderOpts = {
  zone?: 'BRIGHTDATA_UNLOCKER_ZONE' | 'BRIGHTDATA_SERP_ZONE';
  method?: string;
  rung?: (status: number, body: string, brdError: string) => Rung;
};

// Bright Data Web Unlocker with one retry from another country on a block or timeout
// (the module cannot drive the Browser API rung; a JS shell stays unverifiable here).
function unlockerFetch(ctx: IoCtx, url: string, orderId: bigint | undefined, valueRecordId?: bigint, opts: LadderOpts = {}): { ok: boolean; text: string; reason: string; httpStatus: number; evidenceIds: bigint[] } {
  let last = { ok: false, text: '', reason: 'not fetched', httpStatus: 0 };
  const evidenceIds: bigint[] = [];
  let attempt = 0;
  for (const country of ['us', 'gb']) {
    attempt++;
    const t0 = Date.now();
    let status = 0;
    let body = '';
    let brdError = '';
    let thrown = '';
    try {
      const res = ctx.http.fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${envOrThrow(ctx.env, 'BRIGHTDATA_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone: envOrThrow(ctx.env, opts.zone ?? 'BRIGHTDATA_UNLOCKER_ZONE'), url, format: 'raw', country }),
        timeout: TimeDuration.fromMillis(45_000),
      });
      status = res.status;
      body = res.text();
      brdError = res.headers.get('x-brd-error') ?? '';
    } catch (err) {
      thrown = String(err);
    }
    const ms = Date.now() - t0;
    const c = thrown ? { ok: false, kind: /timed? ?out/i.test(thrown) ? 'timeout' : 'error', reason: thrown.slice(0, 200), text: '' } : (opts.rung ?? classify)(status, body, brdError);
    evidenceIds.push(ctx.withTx((tx) => tx.db.evidence.insert({
      id: 0n, valueRecordId, orderId, url, method: opts.method ?? 'unlocker', country, httpStatus: status, attempt, ms: Math.max(0, ms),
      matched: false, reason: c.ok ? '' : c.reason, snapshotHash: '', fetchedAt: tx.timestamp,
    }).id));
    last = { ok: c.ok, text: c.text, reason: c.reason, httpStatus: status };
    if (c.ok || !['blocked', 'timeout'].includes(c.kind)) break;
  }
  return { ...last, evidenceIds };
}

// Challenge recheck (flow D): the saved page the extractor read (the Apify run's key-value store) and a
// fresh Bright Data fetch, both run through the quote anchor. Then the Auditor rules on the results.
export const recheck = spacetimedb.procedure(
  { onSchedule: recheckSchedule },
  { arg: recheckSchedule.rowType },
  t.unit(),
  (ctx, { arg }) => {
    const t0 = Date.now();
    const job = ctx.withTx((tx) => {
      const ch = tx.db.challenge.id.find(arg.challengeId);
      if (!ch || ch.status !== 'rechecking') return null;
      const v = tx.db.valueRecord.id.find(ch.valueRecordId);
      const o = tx.db.orders.id.find(ch.orderId);
      if (!v || !o) return null;
      return { ch, v, apifyRunId: o.apifyRunId };
    });
    if (!job) return {};
    const { ch, v } = job;

    const s0 = Date.now();
    let saved = { ok: false, text: '', reason: '' };
    if (!job.apifyRunId || !v.snapshotKey) saved.reason = 'no saved page recorded for this value';
    else {
      try {
        const res = ctx.http.fetch(`${APIFY_BASE}/actor-runs/${job.apifyRunId}/key-value-store/records/${encodeURIComponent(v.snapshotKey)}`, {
          headers: { Authorization: `Bearer ${envOrThrow(ctx.env, 'APIFY_TOKEN')}` }, timeout: TimeDuration.fromMillis(20_000),
        });
        saved = res.status === 200 ? { ok: true, text: res.text(), reason: '' } : { ok: false, text: '', reason: `saved page: apify http ${res.status}` };
      } catch (err) {
        saved.reason = `saved page: ${String(err).slice(0, 200)}`;
      }
    }
    const savedMs = Date.now() - s0;
    const f0 = Date.now();
    const fresh = unlockerFetch(ctx, v.sourceUrl, ch.orderId, v.id);
    const freshMs = Date.now() - f0;
    const cmp = compareChallenge(saved, fresh, v);
    const totalMs = Date.now() - t0;

    ctx.withTx((tx) => {
      const cur = tx.db.challenge.id.find(ch.id);
      if (!cur || cur.status !== 'rechecking' || tx.db.challengeCheck.challengeId.find(ch.id)) return;
      const last = fresh.evidenceIds[fresh.evidenceIds.length - 1];
      const ev = last !== undefined ? tx.db.evidence.id.find(last) : undefined;
      if (ev) tx.db.evidence.id.update({ ...ev, matched: cmp.fresh.result === 'match' });
      const clip = (s: string, n = 2000) => s.slice(0, n);
      tx.db.challengeCheck.insert({
        challengeId: ch.id, orderId: ch.orderId, valueRecordId: v.id, row: v.row, entity: v.entity, metric: v.metric,
        value: v.value, excerpt: v.excerpt, sourceUrl: v.sourceUrl, observedAt: v.observedAt,
        savedResult: cmp.saved.result, savedReason: saved.reason, savedValue: cmp.saved.value, savedQuote: clip(cmp.saved.quote),
        savedContext: clip(cmp.saved.context), savedMs: Math.max(0, savedMs),
        freshResult: cmp.fresh.result, freshReason: fresh.reason, freshValue: cmp.fresh.value, freshQuote: clip(cmp.fresh.quote),
        freshContext: clip(cmp.fresh.context), freshMs: Math.max(0, freshMs), freshFetchedAt: tx.timestamp,
        correctedValue: cmp.correctedValue, correctedExcerpt: clip(cmp.correctedExcerpt), totalMs: Math.max(0, totalMs), checkedAt: tx.timestamp,
      });
      tx.db.challenge.id.update({ ...cur, status: 'auditing' });
      queueTask(tx, 'audit_challenge', 'auditor', ch.orderId, {
        challengeId: ch.id.toString(), orderId: ch.orderId.toString(), row: v.row, metric: v.metric,
        savedResult: cmp.saved.result, freshResult: cmp.fresh.result,
      });
      logEvent(tx, 'procedure', 'challenge_rechecked', 'challenge', ch.id, {
        orderId: ch.orderId.toString(), row: v.row, metric: v.metric, value: v.value,
        savedResult: cmp.saved.result, savedValue: cmp.saved.value, freshResult: cmp.fresh.result, freshValue: cmp.fresh.value,
        savedMs, freshMs, totalMs, freshAttempts: fresh.evidenceIds.length,
      });
    });
    return {};
  },
);

// Independent re-fetch of every anchored value (AGENTS.md §3 Addition 1), then hand-off to the Auditor.
export const verify_values = spacetimedb.procedure(
  { onSchedule: verifySchedule },
  { arg: verifySchedule.rowType },
  t.unit(),
  (ctx, { arg }) => {
    const job = ctx.withTx((tx) => {
      const o = tx.db.orders.id.find(arg.orderId);
      if (!o || o.status !== 'verifying') return null;
      const a = o.apiId !== undefined ? tx.db.api.id.find(o.apiId) : undefined;
      const recs = [...tx.db.valueRecord.orderId.filter(o.id)].filter((r) => r.status === 'extracted');
      const apifyRun = o.apifyRunId ? [...tx.db.run.externalId.filter(o.apifyRunId)].find((r) => r.provider === 'apify') : undefined;
      return { orderId: o.id, volatility: a?.volatility ?? 'stable', urls: [...new Set(recs.map((r) => r.sourceUrl))], apifyRun };
    });
    if (!job) return {};
    const pages = new Map<string, { ok: boolean; text: string; reason: string }>();
    for (const url of job.urls) pages.set(url, unlockerFetch(ctx, url, job.orderId));
    // usageTotalUsd can be preliminary when the run ends; by now it has had the verification time to settle.
    let apifyUsd: number | undefined;
    if (job.apifyRun) {
      try {
        const res = ctx.http.fetch(`${APIFY_BASE}/actor-runs/${job.apifyRun.externalId}`, { headers: { Authorization: `Bearer ${envOrThrow(ctx.env, 'APIFY_TOKEN')}` } });
        if (res.status === 200) apifyUsd = (JSON.parse(res.text()) as { data: { usageTotalUsd?: number } }).data.usageTotalUsd;
      } catch { /* keep the usage recorded at ingest */ }
    }
    ctx.withTx((tx) => {
      const o = tx.db.orders.id.find(job.orderId);
      if (!o || o.status !== 'verifying') return;
      const counts: Record<string, number> = {};
      for (const r of tx.db.valueRecord.orderId.filter(o.id)) {
        if (r.status !== 'extracted') { counts[r.status] = (counts[r.status] ?? 0) + 1; continue; }
        const { status, freshValue } = verifyValue(pages.get(r.sourceUrl), r, job.volatility);
        counts[status] = (counts[status] ?? 0) + 1;
        tx.db.valueRecord.id.update({ ...r, status, freshValue, verifiedAt: status === 'verified' ? tx.timestamp : undefined });
      }
      if (job.apifyRun) finalizeRunCost(tx, job.apifyRun.id, apifyUsd, [...pages.values()].filter((pg) => pg.ok).length);
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      if (o.apiId !== undefined) {
        const a = tx.db.api.id.find(o.apiId);
        if (a && total) tx.db.api.id.update({ ...a, verifiedRateBp: Math.round(((counts.verified ?? 0) / total) * 10_000) });
      }
      const canary = isCanary(tx, o.id);
      setOrder(tx, o, { status: 'auditing' }, 'procedure', 'values_verified', { counts, pages: pages.size, canary });
      // A canary order stops here: no paid Auditor run, no delivery, no buyer.
      if (canary) logEvent(tx, 'rules', 'audit_skipped_canary', 'order', o.id, { counts });
      else queueTask(tx, 'audit', 'auditor', o.id, { orderId: o.id.toString(), counts });
      // A canary run is a real run of the API, so it counts toward the verified-rate compile trigger.
      if (canary && o.apiId !== undefined) checkCompileTriggers(tx, o.apiId, false);
    });
    return {};
  },
);

// Founder/canary diagnostic: runs the verify_values rule for one value against a live Bright Data fetch
// and logs the outcome as a verify_probe event. Writes no value records.
export const verify_probe = spacetimedb.procedure(
  { url: t.string(), excerpt: t.string(), value: t.string(), entity: t.string(), volatility: t.string(), marker: t.string() },
  t.unit(),
  (ctx, { url, excerpt, value, entity, volatility, marker }) => {
    ctx.withTx((tx) => requireRole(tx, 'founder', 'canary'));
    const page = unlockerFetch(ctx, url, undefined);
    const result = verifyValue(page, { excerpt, value, entity }, volatility);
    ctx.withTx((tx) => logEvent(tx, 'procedure', 'verify_probe', 'url', 0n, { marker, url, pageOk: page.ok, reason: page.reason, ...result }));
    return {};
  },
);

// ---- Research seat: the layer-3 admission gate (AGENTS.md §3, flow B) ----
// research_fetch does the IO (Bright Data Unlocker for pages and robots.txt, SERP for searches) and
// stores what it read; record_gate_check accepts a citation only if it points at a page fetched for
// this order and, where it is a quote, the quote is on that page. research_report hands the order back
// to the COO, who can create a Tier 0 API only over sources that passed robots, terms and reachability.

const GATE_CHECKS = ['robots', 'terms', 'reachability', 'volatility'];
const GATE_RESULTS = ['pass', 'fail', 'unclear'];
const RESEARCH_KINDS = ['page', 'robots', 'search'];
// Per order: bounds what one Research run can spend on Bright Data.
const RESEARCH_MAX_FETCHES = 30;
const RESEARCH_TEXT_MAX = 400_000;
const VOLATILITY_MIN_GAP_MS = 120_000;
const MIN_QUOTE_CHARS = 20;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,39}$/;

type GateCheckRow = NonNullable<ReturnType<Ctx['db']['gateCheck']['id']['find']>>;

function latestGateChecks(ctx: Ctx, orderId: bigint): Record<string, GateCheckRow> {
  const out: Record<string, GateCheckRow> = {};
  for (const g of ctx.db.gateCheck.iter()) {
    if (g.orderId !== orderId || !GATE_CHECKS.includes(g.check)) continue;
    const cur = out[g.check];
    if (!cur || g.id > cur.id) out[g.check] = g;
  }
  return out;
}

function blockedHost(ctx: Ctx, host: string): string | undefined {
  let blocked: unknown = [];
  try { blocked = JSON.parse(ctx.db.config.key.find('blocked_domains')?.value ?? '[]'); } catch { /* none */ }
  const h = host.replace(/^www\./, '');
  return (Array.isArray(blocked) ? blocked : []).map(String).find((d) => h === d || h.endsWith(`.${d}`));
}

function httpUrl(ctx: Ctx, raw: string, what: string): string {
  const url = raw.trim();
  const u = splitUrl(url);
  if (!u || url.length > 2000) throw new SenderError(`${what} must be an http(s) URL under 2000 chars, got ${JSON.stringify(raw.slice(0, 200))}`);
  const b = blockedHost(ctx, u.host);
  if (b) throw new SenderError(`${u.host} is on the blocked domain list (${b})`);
  return url;
}

// Robots and SERP bodies are short or JSON: only transport failures and blocks are failures here.
// A 4xx robots.txt (other than 403/429) means the site has none, which RFC 9309 reads as allow-all.
const rawRung = (status: number, body: string, brdError: string): Rung => {
  if (brdError || status === 0 || status === 403 || status === 429 || status >= 500) return classify(status, body, brdError);
  if (status >= 400) return { ok: true, kind: 'ok', reason: `http ${status}`, text: '' };
  if (!body.trim()) return { ok: false, kind: 'shell', reason: 'empty body', text: '' };
  return { ok: true, kind: 'ok', reason: '', text: body };
};

type SerpResult = { rank: number; title: string; link: string; description: string };

function serpResults(body: string): SerpResult[] {
  let data: { organic?: { rank?: number; title?: string; link?: string; description?: string }[] } = {};
  try { data = JSON.parse(body); } catch { return []; }
  return (data.organic ?? []).slice(0, 10).map((o, i) => ({
    rank: o.rank ?? i + 1, title: String(o.title ?? '').slice(0, 200), link: String(o.link ?? ''), description: String(o.description ?? '').slice(0, 400),
  }));
}

// Research seat (and the founder, for diagnostics): one fetch for an order in `researching`.
//   kind page:   target is a URL, fetched through the Unlocker ladder. A second fetch of the same URL
//                is compared with the first (the measured volatility check).
//   kind robots: target is a source URL; its site's /robots.txt is fetched and the target's path is
//                judged in code (RFC 9309, user-agent *).
//   kind search: target is a search query, run through the Bright Data SERP zone (Google, brd_json=1).
// Returns JSON with the page text, so forge-cli can print and search it.
function fetchResearchPage(ctx: IoCtx, orderId: bigint, kind: string, target: string): string {
    const plan = ctx.withTx((tx) => {
      if (!RESEARCH_KINDS.includes(kind)) throw new SenderError(`kind must be one of ${RESEARCH_KINDS.join(', ')}`);
      const o = findOrder(tx, orderId);
      if (o.status !== 'researching') throw new SenderError(`order ${orderId} is ${o.status}; research fetches are only for an order in researching`);
      const pages = [...tx.db.researchPage.orderId.filter(orderId)];
      if (pages.length >= RESEARCH_MAX_FETCHES) throw new SenderError(`order ${orderId} has used all ${RESEARCH_MAX_FETCHES} research fetches`);
      const q = target.trim();
      if (!q) throw new SenderError('target is required');
      if (kind === 'search') {
        if (q.length > 300) throw new SenderError('search query must be under 300 chars');
        return { url: `https://www.google.com/search?q=${encodeURIComponent(q)}&brd_json=1`, target: q, previous: null };
      }
      const pageUrl = httpUrl(tx, q, 'target');
      if (kind === 'robots') return { url: robotsUrlFor(pageUrl), target: pageUrl, previous: null };
      const prev = pages.filter((p) => p.kind === 'page' && p.ok && p.url === pageUrl).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
      const prevText = prev ? tx.db.researchPageText.pageId.find(prev.id)?.text ?? '' : '';
      return { url: pageUrl, target: pageUrl, previous: prev ? { id: prev.id, at: prev.fetchedAt, text: prevText } : null };
    });

    const t0 = Date.now();
    const fetched = kind === 'search'
      ? unlockerFetch(ctx, plan.url, orderId, undefined, { zone: 'BRIGHTDATA_SERP_ZONE', method: 'serp', rung: rawRung })
      : kind === 'robots'
        ? unlockerFetch(ctx, plan.url, orderId, undefined, { method: 'unlocker', rung: rawRung })
        : unlockerFetch(ctx, plan.url, orderId);
    const ms = Date.now() - t0;

    let summary: Record<string, unknown> = {};
    let text = fetched.text;
    if (kind === 'robots' && fetched.ok) {
      const found = fetched.httpStatus < 400 && !looksLikeHtml(text);
      summary = found
        ? { found, ...robotsVerdict(text, plan.target) }
        : { found, allowed: true, rule: null, path: splitUrl(plan.target)?.path ?? '/', note: `no robots.txt (http ${fetched.httpStatus}${fetched.httpStatus < 400 ? ', an HTML page' : ''}); RFC 9309 allows all paths` };
    } else if (kind === 'search' && fetched.ok) {
      const results = serpResults(text);
      summary = { results };
      text = JSON.stringify(results, null, 1);
    }
    const stored = text.slice(0, RESEARCH_TEXT_MAX);

    return ctx.withTx((tx) => {
      let compare: unknown = null;
      if (kind === 'page' && fetched.ok && plan.previous) {
        const gapMs = Number((tx.timestamp.microsSinceUnixEpoch - plan.previous.at.microsSinceUnixEpoch) / 1000n);
        compare = { previousId: plan.previous.id.toString(), secondsApart: Math.round(gapMs / 1000), enoughGap: gapMs >= VOLATILITY_MIN_GAP_MS, ...compareTexts(plan.previous.text, stored) };
        summary = { compare };
      }
      const row = tx.db.researchPage.insert({
        id: 0n, orderId, kind, target: plan.target, url: plan.url, ok: fetched.ok, httpStatus: fetched.httpStatus, reason: fetched.reason,
        chars: stored.length, textHash: fetched.ok ? textHash(text) : '', summary: JSON.stringify(summary).slice(0, 20_000), ms: Math.max(0, ms), fetchedAt: tx.timestamp,
      });
      if (fetched.ok && stored) tx.db.researchPageText.insert({ pageId: row.id, text: stored });
      logEvent(tx, 'research', 'research_fetched', 'order', orderId, {
        researchPageId: row.id.toString(), kind, target: plan.target, url: plan.url, ok: fetched.ok, httpStatus: fetched.httpStatus,
        reason: fetched.reason, chars: stored.length, ms, attempts: fetched.evidenceIds.length,
        ...(kind === 'robots' ? { allowed: summary.allowed, rule: summary.rule } : {}),
        ...(compare ? { suggestedVolatility: (compare as { suggested: string }).suggested } : {}),
      });
      return JSON.stringify({
        researchPageId: row.id.toString(), orderId: orderId.toString(), kind, target: plan.target, url: plan.url, ok: fetched.ok,
        httpStatus: fetched.httpStatus, reason: fetched.reason, ms, attempts: fetched.evidenceIds.length,
        chars: stored.length, truncated: text.length > stored.length, textHash: row.textHash, fetchedAt: row.fetchedAt.toDate().toISOString(),
        ...summary, text: stored,
      });
    });
}

export const research_fetch = spacetimedb.procedure(
  { orderId: t.u64(), kind: t.string(), target: t.string() }, t.string(), (ctx, { orderId, kind, target }) => {
    ctx.withTx((tx) => requireRole(tx, 'research', 'founder'));
    return fetchResearchPage(ctx, orderId, kind, target);
  },
);

function startAdmission(ctx: Ctx, o: Order) {
  const sources = precheckSources(o.intent, o.requestText);
  ctx.db.admissionJob.insert({ orderId: o.id, sources: JSON.stringify(sources), status: sources.length ? 'pending' : 'needs_sources',
    volatility: 'stable', nextFetchAt: ctx.timestamp, reason: '', updatedAt: ctx.timestamp });
  if (!sources.length) {
    queueTask(ctx, 'research_gate', 'research', o.id, { orderId: o.id.toString(), prechecked: false, reason: 'No explicit source URL; discover a source and run all four checks.' });
  } else {
    ctx.db.admissionSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch), orderId: o.id, phase: 0 });
  }
  logEvent(ctx, 'rules', 'admission_started', 'order', o.id, { sources, discoveryRequired: !sources.length });
}

type AdmissionFetch = {
  ok: boolean; url: string; text: string; reason: string; allowed?: boolean; rule?: string | null; note?: string;
  compare?: { enoughGap: boolean; secondsApart: number; changedLines: number; numbersChanged: number; suggested: string };
};

function admissionFinding(ctx: Ctx, orderId: bigint, check: string, result: string, url: string, quote: string) {
  const row = ctx.db.gateCheck.insert({ id: 0n, orderId, ticketId: undefined, check, result,
    citationUrl: url, citationText: quote.slice(0, 2000), at: ctx.timestamp });
  logEvent(ctx, 'rules', 'gate_check_recorded', 'order', orderId, { gateCheckId: row.id.toString(), check, result, citationUrl: url, citationText: quote.slice(0, 300), automatic: true });
}

export const admission_precheck = spacetimedb.procedure(
  { onSchedule: admissionSchedule }, { arg: admissionSchedule.rowType }, t.unit(), (ctx, { arg }) => {
    const job = ctx.withTx((tx) => {
      const j = tx.db.admissionJob.orderId.find(arg.orderId);
      if (!j || tx.db.orders.id.find(arg.orderId)?.status !== 'researching') return null;
      if (arg.phase === 0 ? j.status !== 'pending' : j.status !== 'waiting' || tx.timestamp.microsSinceUnixEpoch < j.nextFetchAt.microsSinceUnixEpoch) return null;
      tx.db.admissionJob.orderId.update({ ...j, status: 'checking', updatedAt: tx.timestamp });
      return { ...j, pageCap: cfgInt(tx, 'page_cap') };
    });
    if (!job) return {};
    const sources: string[] = JSON.parse(job.sources);
    let source = sources[0] ?? '';
    let check = 'reachability';
    try {
      // Leave room within the existing per-order fetch cap for terms and discovery.
      if (sources.length > Math.min(job.pageCap, Math.floor((RESEARCH_MAX_FETCHES - 4) / 3))) throw new Error('Too many source URLs for the admission fetch budget; request fewer sources.');
      let volatility = job.volatility;
      for (source of sources) {
        if (arg.phase === 0) {
          check = 'robots';
          const robots: AdmissionFetch = JSON.parse(fetchResearchPage(ctx, arg.orderId, 'robots', source));
          if (!robots.ok || !robots.allowed) throw new Error(robots.rule ?? robots.reason ?? 'robots.txt could not be checked');
          ctx.withTx((tx) => admissionFinding(tx, arg.orderId, 'robots', 'pass', robots.url, robots.rule ?? robots.note ?? robots.text.split('\n').find((line) => /^\s*user-agent\s*:\s*\*\s*$/i.test(line)) ?? 'No matching disallow rule for user-agent *.'));
        }
        check = 'reachability';
        const page: AdmissionFetch = JSON.parse(fetchResearchPage(ctx, arg.orderId, 'page', source));
        const blocked = reachabilityProblem(page.text);
        if (!page.ok || blocked) throw new Error(blocked ?? page.reason);
        if (arg.phase === 0) {
          ctx.withTx((tx) => admissionFinding(tx, arg.orderId, 'reachability', 'pass', source, page.text.slice(0, 300)));
        } else {
          check = 'volatility';
          if (!page.compare?.enoughGap) throw new Error('The second fetch did not have the required 120-second gap.');
          if (page.compare.suggested === 'volatile') volatility = 'volatile';
          const c = page.compare;
          ctx.withTx((tx) => admissionFinding(tx, arg.orderId, 'volatility', 'pass', source, `Fetched ${c.secondsApart} s apart: ${c.changedLines} changed lines, ${c.numbersChanged} changed numbers; ${c.suggested}`));
        }
      }
      ctx.withTx((tx) => {
        const j = tx.db.admissionJob.orderId.find(arg.orderId)!;
        if (tx.db.orders.id.find(arg.orderId)?.status !== 'researching') return;
        const nextFetchAt = new Timestamp(tx.timestamp.microsSinceUnixEpoch + BigInt(VOLATILITY_MIN_GAP_MS + 1000) * 1000n);
        tx.db.admissionJob.orderId.update({ ...j, status: arg.phase === 0 ? 'waiting' : 'passed', volatility, nextFetchAt, updatedAt: tx.timestamp });
        if (arg.phase === 0) tx.db.admissionSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(nextFetchAt.microsSinceUnixEpoch), orderId: arg.orderId, phase: 1 });
        else queueTask(tx, 'research_gate', 'research', arg.orderId, { orderId: arg.orderId.toString(), prechecked: true, sources, volatility, next: 'Review the requested fields and quoted terms; reuse the mechanical gate checks for these exact sources.' });
        logEvent(tx, 'rules', arg.phase === 0 ? 'admission_waiting' : 'admission_passed', 'order', arg.orderId, { sources, volatility });
      });
    } catch (err) {
      ctx.withTx((tx) => {
        const j = tx.db.admissionJob.orderId.find(arg.orderId)!;
        const o = findOrder(tx, arg.orderId);
        if (o.status !== 'researching') return;
        const reason = `Admission ${check}: ${String(err).slice(0, 1800)} (${source})`;
        admissionFinding(tx, arg.orderId, check, 'fail', check === 'robots' ? robotsUrlFor(source) : source, reason);
        tx.db.admissionJob.orderId.update({ ...j, status: 'rejected', reason, updatedAt: tx.timestamp });
        setOrder(tx, o, { status: 'rejected', decisionReason: reason }, 'rules', 'admission_rejected', { check, source, reason });
      });
    }
    return {};
  },
);

// Research seat: one layer-3 finding with its citation. citationUrl is a URL fetched for this order with
// research_fetch (for robots, the robots.txt URL). A pass/fail on robots, terms or reachability quotes
// the fetched page verbatim (up to whitespace and case); an `unclear` explains why in its own words.
// Volatility needs two fetches of the page at least VOLATILITY_MIN_GAP_MS apart.
export const record_gate_check = spacetimedb.reducer(
  { orderId: t.u64(), check: t.string(), result: t.string(), citationUrl: t.string(), citationText: t.string() },
  (ctx, { orderId, check, result, citationUrl, citationText }) => {
    requireRole(ctx, 'research');
    if (!GATE_CHECKS.includes(check)) throw new SenderError(`check must be one of ${GATE_CHECKS.join(', ')}`);
    if (!GATE_RESULTS.includes(result)) throw new SenderError(`result must be one of ${GATE_RESULTS.join(', ')}`);
    const o = findOrder(ctx, orderId);
    if (o.status !== 'researching') throw new SenderError(`order ${orderId} is ${o.status}, not researching`);
    const url = citationUrl.trim();
    const quote = citationText.trim();
    if (!quote) throw new SenderError('citationText is required');
    const fetched = [...ctx.db.researchPage.orderId.filter(orderId)].filter((p) => p.ok && p.url === url);
    const want = check === 'robots' ? ['robots'] : check === 'reachability' ? ['page', 'search'] : ['page'];
    const pages = fetched.filter((p) => want.includes(p.kind));
    if (!pages.length) {
      const how = check === 'robots' ? 'forge robots' : check === 'reachability' ? 'forge research-fetch or forge search' : 'forge research-fetch';
      throw new SenderError(`${url || '(empty)'} was not fetched for order ${orderId}; fetch it with ${how} and cite the fetched URL`);
    }
    const onPage = () => pages.some((p) => quotedOn(ctx.db.researchPageText.pageId.find(p.id)?.text ?? '', quote));

    if (check === 'robots') {
      const verdicts = pages.map((p) => JSON.parse(p.summary) as { found?: boolean; allowed?: boolean; rule?: string | null; path?: string });
      const denied = verdicts.filter((v) => v.allowed === false);
      if (result === 'pass' && denied.length) throw new SenderError(`robots.txt disallows ${denied.map((v) => `${v.path} (${v.rule})`).join(', ')}; the result is fail`);
      if (result === 'fail' && !denied.length) throw new SenderError('robots.txt allows every path checked for this order; the result is pass');
      if (result !== 'unclear' && verdicts.some((v) => v.found) && !onPage()) throw new SenderError('citationText must quote a line of the robots.txt that was fetched (e.g. the deciding rule or "User-agent: *")');
    } else if (check === 'volatility') {
      const times = pages.filter((p) => p.kind === 'page').map((p) => p.fetchedAt.microsSinceUnixEpoch).sort();
      const gapMs = times.length >= 2 ? Number((times[times.length - 1]! - times[0]!) / 1000n) : 0;
      if (result !== 'unclear' && gapMs < VOLATILITY_MIN_GAP_MS) {
        throw new SenderError(`volatility is measured: fetch ${url} twice at least ${VOLATILITY_MIN_GAP_MS / 1000} s apart (now ${times.length} fetch(es), ${Math.round(gapMs / 1000)} s apart)`);
      }
    } else if (result !== 'unclear') {
      if (check === 'terms' && quote.length < MIN_QUOTE_CHARS) throw new SenderError(`a terms finding quotes the clause (at least ${MIN_QUOTE_CHARS} chars)`);
      if (!onPage()) throw new SenderError(`citationText is not on the page fetched from ${url}; quote it verbatim or record unclear`);
    }

    const row = ctx.db.gateCheck.insert({
      id: 0n, orderId, ticketId: undefined, check, result, citationUrl: url, citationText: quote.slice(0, 2000), at: ctx.timestamp,
    });
    logEvent(ctx, 'research', 'gate_check_recorded', 'order', orderId, { gateCheckId: row.id.toString(), check, result, citationUrl: url, citationText: quote.slice(0, 300) });
  },
);

function parseJsonArray(raw: string, what: string): unknown[] {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new SenderError(`${what} is not valid JSON`); }
  if (!Array.isArray(v)) throw new SenderError(`${what} must be a JSON array`);
  return v;
}

// Research seat, once per order after all four checks: the findings the COO decides on.
export const research_report = spacetimedb.reducer(
  {
    orderId: t.u64(), summary: t.string(), sources: t.string(), fields: t.string(),
    volatility: t.string(), freshnessWindowMin: t.u32(), confidence: t.f64(),
  },
  (ctx, { orderId, summary, sources, fields, volatility, freshnessWindowMin, confidence }) => {
    requireRole(ctx, 'research');
    const o = findOrder(ctx, orderId);
    if (o.status !== 'researching') throw new SenderError(`order ${orderId} is ${o.status}, not researching`);
    if (!summary.trim()) throw new SenderError('summary is required');
    const checks = latestGateChecks(ctx, orderId);
    const missing = GATE_CHECKS.filter((c) => !checks[c]);
    if (missing.length) throw new SenderError(`record every gate check first; missing: ${missing.join(', ')}`);
    const src = parseJsonArray(sources, 'sources');
    if (!src.length || !src.every((s) => typeof s === 'string')) throw new SenderError('sources must be a non-empty JSON array of URL strings');
    const cap = cfgInt(ctx, 'page_cap');
    if (src.length > cap) throw new SenderError(`at most ${cap} sources (config page_cap)`);
    for (const s of src as string[]) httpUrl(ctx, s, 'each source');
    const fl = parseJsonArray(fields, 'fields');
    if (fl.length > 30 || !fl.every((f) => typeof f === 'string' && FIELD_NAME.test(f))) throw new SenderError(`fields must be a JSON array of up to 30 names matching ${FIELD_NAME}`);
    if (!['stable', 'volatile'].includes(volatility)) throw new SenderError('volatility must be stable or volatile');
    if (volatility === 'volatile' && (freshnessWindowMin < 1 || freshnessWindowMin > 1440)) throw new SenderError('a volatile source needs freshnessWindowMin between 1 and 1440');
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new SenderError('confidence must be between 0 and 1');
    const gate = [...ctx.db.task.kind.filter('research_gate')].filter((x) => x.orderId === orderId).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
    const checkSummary = Object.fromEntries(GATE_CHECKS.map((c) => [c, { result: checks[c]!.result, citationUrl: checks[c]!.citationUrl, gateCheckId: checks[c]!.id.toString() }]));
    const rep = ctx.db.researchFindings.insert({
      id: 0n, orderId, taskId: gate?.id, summary: summary.trim().slice(0, 4000), sources: JSON.stringify(src), fields: JSON.stringify(fl),
      volatility, freshnessWindowMin: volatility === 'volatile' ? freshnessWindowMin : 0, confidenceBp: Math.round(confidence * 10_000),
      checks: JSON.stringify(checkSummary), createdAt: ctx.timestamp,
    });
    closeTasks(ctx, orderId, 'research_gate', { researchReportId: rep.id.toString() });
    const triaging = setOrder(ctx, o, { status: 'triaging' }, 'research', 'research_reported', { researchReportId: rep.id.toString(), checks: checkSummary, volatility });
    queueTask(ctx, 'coo_triage', 'coo', triaging.id, {
      orderId: orderId.toString(), researchReportId: rep.id.toString(),
      checks: Object.fromEntries(GATE_CHECKS.map((c) => [c, checks[c]!.result])),
    });
  },
);

// Hosts the COO may build a Tier 0 API on: sources of research reports whose robots, terms and
// reachability checks all passed.
function clearedHosts(ctx: Ctx): Set<string> {
  const out = new Set<string>();
  for (const r of ctx.db.researchFindings.iter()) {
    const checks = latestGateChecks(ctx, r.orderId);
    if (!['robots', 'terms', 'reachability'].every((c) => checks[c]?.result === 'pass')) continue;
    for (const s of JSON.parse(r.sources) as string[]) out.add(hostOf(s));
  }
  return out;
}

// The COO's create_api: Tier 0 only, within the page cap, over researched sources. Returns the
// forge-extract Task input that create_apify_task saves on Apify.
function cooTaskInput(
  ctx: Ctx,
  s: { name: string; description: string; inputs?: unknown; sources: unknown[]; outputSchema: { properties?: Record<string, unknown> }; pageCap?: number; instructions?: unknown; markers?: unknown },
  apifyId: string,
  engine: string,
) {
  if (apifyId || engine !== 'task') throw new SenderError('the COO creates Tier 0 APIs only: pass an empty apifyId and engine task; the Apify Task is created for you');
  if (!s.description?.trim()) throw new SenderError('description is required');
  const fields = Object.keys(s.outputSchema?.properties ?? {});
  if (!fields.length || !fields.every((f) => FIELD_NAME.test(f))) throw new SenderError(`outputSchema.properties must name the fields (names matching ${FIELD_NAME})`);
  const cap = cfgInt(ctx, 'page_cap');
  const pageCap = s.pageCap ?? cap;
  if (!Number.isInteger(pageCap) || pageCap < 1 || pageCap > cap) throw new SenderError(`pageCap must be an integer 1-${cap} (config page_cap)`);
  let resolved;
  try { resolved = resolveSources(JSON.stringify(s.inputs ?? {}), JSON.stringify(s.sources), '{}'); } catch (err) { throw new SenderError((err as Error).message); }
  if (!resolved.sources.length || resolved.sources.length > pageCap) throw new SenderError(`sources must have 1-${pageCap} entries (pageCap)`);
  const cleared = clearedHosts(ctx);
  for (const src of resolved.sources) {
    httpUrl(ctx, src, 'each source');
    if (!cleared.has(hostOf(src))) throw new SenderError(`${hostOf(src)} has no research report with robots, terms and reachability all passing; use REQUEST_RESEARCH first`);
  }
  const markers = Array.isArray(s.markers) ? s.markers.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).slice(0, 5) : [];
  return {
    sources: resolved.sources,
    outputSchema: s.outputSchema,
    instructions: typeof s.instructions === 'string' && s.instructions.trim() ? s.instructions.trim().slice(0, 2000) : s.description,
    pageCap,
    ...(markers.length ? { markers } : {}),
  };
}

// Saves a COO-created Tier 0 API as an Apify Task of forge-extract, then starts the orders waiting on it.
export const create_apify_task = spacetimedb.procedure(
  { onSchedule: apifyTaskSchedule },
  { arg: apifyTaskSchedule.rowType },
  t.unit(),
  (ctx, { arg }) => {
    const job = ctx.withTx((tx) => {
      const j = tx.db.apifyTaskJob.apiId.find(arg.apiId);
      const a = tx.db.api.id.find(arg.apiId);
      return j && a && j.status === 'pending' ? { name: a.name, input: j.input } : null;
    });
    if (!job) return {};
    let taskId = '';
    let error = '';
    try {
      const auth = { Authorization: `Bearer ${envOrThrow(ctx.env, 'APIFY_TOKEN')}` };
      const acts = ctx.http.fetch(`${APIFY_BASE}/acts?my=true&limit=1000`, { headers: auth });
      if (acts.status !== 200) throw new Error(`list actors: http ${acts.status}`);
      const act = (JSON.parse(acts.text()) as { data: { items: { id: string; name: string }[] } }).data.items.find((x) => x.name === 'forge-extract');
      if (!act) throw new Error('forge-extract is not on the Apify account');
      const res = ctx.http.fetch(`${APIFY_BASE}/actor-tasks`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actId: act.id, name: job.name, input: JSON.parse(job.input), options: { timeoutSecs: 300, memoryMbytes: 1024 } }),
      });
      const body = res.text();
      if (res.status !== 201) throw new Error(`create task: http ${res.status} ${body.slice(0, 300)}`);
      taskId = (JSON.parse(body) as { data: { id: string } }).data.id;
    } catch (err) {
      error = String(err).slice(0, 500);
    }
    ctx.withTx((tx) => {
      const j = tx.db.apifyTaskJob.apiId.find(arg.apiId);
      const a = tx.db.api.id.find(arg.apiId);
      if (!j || !a || j.status !== 'pending') return;
      tx.db.apifyTaskJob.apiId.update({ ...j, status: taskId ? 'created' : 'failed', apifyTaskId: taskId, error, updatedAt: tx.timestamp });
      const waiting = [...tx.db.orders.iter()].filter((o) => o.apiId === a.id && o.status === 'accepted' && !o.apifyRunId);
      if (!taskId) {
        logEvent(tx, 'procedure', 'apify_task_failed', 'api', a.id, { name: a.name, error });
        for (const o of waiting) failOrder(tx, o.id, 'procedure', `the API's Apify Task could not be created: ${error}`);
        return;
      }
      const v = a.currentVersionId !== undefined ? tx.db.apiVersion.id.find(a.currentVersionId) : undefined;
      if (v) tx.db.apiVersion.id.update({ ...v, apifyId: taskId });
      logEvent(tx, 'procedure', 'apify_task_created', 'api', a.id, { name: a.name, apifyTaskId: taskId, waitingOrders: waiting.length });
      for (const o of waiting) tx.db.apiRunSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(tx.timestamp.microsSinceUnixEpoch), orderId: o.id });
    });
    return {};
  },
);
// The only thing that starts CREAO runs. Respects creao_max_concurrency; a role with no
// saved agent (CREAO_APP_ID_<ROLE> unset) keeps its tasks queued.
export const dispatch = spacetimedb.procedure(
  { onSchedule: dispatchSchedule },
  { arg: dispatchSchedule.rowType },
  t.unit(),
  (ctx, _args) => {
    const apps: Record<string, string> = {};
    for (const [role, name] of Object.entries(ROLE_APP_ENV)) { const v = ctx.env.get(name); if (v) apps[role] = v; }
    if (!Object.keys(apps).length) return {};
    const picks = ctx.withTx((tx) => {
      const callbackRuns = new Set([...tx.db.callbackToken.iter()].map((c) => c.runRef));
      for (const r of tx.db.run.iter()) {
        if (r.provider !== 'creao' || r.status !== 'starting' || r.externalId || callbackRuns.has(r.id)
          || tx.timestamp.microsSinceUnixEpoch - r.startedAt.microsSinceUnixEpoch < 60_000_000n) continue;
        const task = r.taskId === undefined ? undefined : tx.db.task.id.find(r.taskId);
        tx.db.run.id.update({ ...r, status: 'start_failed', resultText: 'Dispatch stopped before callback token creation; no external call was made.', endedAt: tx.timestamp });
        if (task?.status === 'dispatched') tx.db.task.id.update({ ...task, status: 'queued', updatedAt: tx.timestamp });
        logEvent(tx, 'dispatch', 'orphan_dispatch_recovered', 'run', r.id, { taskId: r.taskId?.toString() });
      }
      const inFlight = [...tx.db.run.iter()].filter((r) => r.provider === 'creao' && ['starting', 'pending', 'running', 'queued'].includes(r.status)).length;
      const free = cfgInt(tx, 'creao_max_concurrency') - inFlight;
      if (free <= 0) return [];
      const queued = [...tx.db.task.iter()]
        .filter((r) => r.status === 'queued' && CREAO_ROLES.includes(r.role) && CREAO_KINDS.includes(r.kind) && apps[r.role]
          && !(r.orderId !== undefined && isCanary(tx, r.orderId)))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, free);
      return queued.map((task) => {
        tx.db.task.id.update({ ...task, status: 'dispatched', attempt: task.attempt + 1, updatedAt: tx.timestamp });
        const run = tx.db.run.insert({
          id: 0n, provider: 'creao', externalId: '', appId: apps[task.role], taskId: task.id, threadId: '', status: 'starting',
          resultText: '', shareUrl: '', costCents: 0, startedAt: tx.timestamp, endedAt: undefined,
        });
        logEvent(tx, 'dispatch', 'task_dispatched', 'task', task.id, { role: task.role, kind: task.kind, runRef: run.id.toString() });
        return { task, runRef: run.id, token: addCallbackToken(tx, 'creao', run.id) };
      });
    });
    const base = ctx.env.get('PUBLIC_ROUTE_BASE');
    for (const { task, runRef, token } of picks) {
      const body: Record<string, unknown> = {
        appId: apps[task.role],
        inputs: { task: JSON.stringify({ kind: task.kind, taskId: task.id.toString(), orderId: task.orderId?.toString() ?? '', input: JSON.parse(task.input) }) },
        idempotencyKey: `forge-task-${task.id}-${task.attempt + 1}`,
      };
      if (base) body.webhookUrl = `${base}/creao-callback?token=${token}`;
      let status = 0;
      let text = '';
      try {
        const res = ctx.http.fetch(`${CREAO_BASE}/api/v1/runs`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${creaoKey(ctx.env)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        status = res.status;
        text = res.text();
      } catch (err) {
        text = String(err);
      }
      ctx.withTx((tx) => {
        const run = tx.db.run.id.find(runRef)!;
        let parsed: CreaoRun = {};
        try { parsed = JSON.parse(text); } catch { /* error body */ }
        const ok = status === 202 || status === 200;
        tx.db.run.id.update({ ...run, externalId: parsed.id ?? parsed.runId ?? '', status: ok ? (parsed.status ?? 'pending') : 'start_failed',
          resultText: ok ? '' : text.slice(0, 2000), endedAt: ok ? undefined : tx.timestamp });
        if (!ok) {
          const cur = tx.db.task.id.find(task.id)!;
          tx.db.task.id.update({ ...cur, status: 'queued', updatedAt: tx.timestamp });
        }
        logEvent(tx, 'dispatch', ok ? 'creao_run_started' : 'creao_run_start_failed', 'run', runRef, { role: task.role, taskId: task.id.toString(), httpStatus: status });
      });
    }
    return {};
  },
);
// ---- Compile (flow C, AGENTS.md §3 compile triggers, §6 C) ----
// A compile ticket carries one compile_job from the trigger to the shipped Tier 1 version:
// trigger -> CFO proposal -> budget reservation (over the cap: founder approval) -> Droid compile
// -> Auditor verdict (reject: rework in the same Droid session) -> founder api_ship approval
// -> ship (apify push by the worker) -> record_api_version.

type Job = NonNullable<ReturnType<Ctx['db']['compileJob']['ticketId']['find']>>;
type TaskRow = NonNullable<ReturnType<Ctx['db']['task']['id']['find']>>;

const JOB_ACTIVE = ['awaiting_cfo', 'awaiting_approval', 'queued', 'compiling', 'auditing', 'rework', 'ineligible', 'ship_pending', 'shipping'];
const TICKET_STATUS_OF: Record<string, string> = {
  shipped: 'shipped', deferred: 'deferred', repriced: 'repriced', rejected: 'rejected', ship_rejected: 'rejected', failed: 'failed', closed: 'closed',
};
const COMPILE_TASK_KINDS = ['cfo_compile', 'compile', 'audit_compile', 'ship'];
const COMPILE_TRIGGER_KEYS = ['compile_min_buyers', 'compile_min_verified_rate', 'compile_window_runs'];
const CFO_DECISIONS = ['COMPILE', 'DEFER', 'REPRICE'];
const MAX_COMPILE_CENTS = 100_000;
const RESULTS_MAX = 30_000;
const DROID_PAYLOAD_MAX = 16_000;

function findJob(ctx: Ctx, ticketId: bigint): Job {
  const j = ctx.db.compileJob.ticketId.find(ticketId);
  if (!j) throw new SenderError(`no compile job for ticket ${ticketId}`);
  return j;
}

const apiNameOf = (ctx: Ctx, apiId: bigint) => ctx.db.api.id.find(apiId)?.name ?? `api ${apiId}`;

function engBudget(ctx: Ctx) {
  const b = ctx.db.budget.name.find('engineering');
  if (!b) throw new Error('no engineering budget row; run ensure_defaults');
  return b;
}

// Every job change is an event; a job that reaches a terminal status closes its ticket.
function setJob(ctx: Ctx, job: Job, patch: Partial<Job>, actor: string, kind: string, payload: Record<string, unknown> = {}): Job {
  const next = { ...job, ...patch, updatedAt: ctx.timestamp };
  ctx.db.compileJob.ticketId.update(next);
  const closed = TICKET_STATUS_OF[next.status];
  if (closed) {
    const tk = ctx.db.ticket.id.find(job.ticketId);
    if (tk && tk.status !== closed) ctx.db.ticket.id.update({ ...tk, status: closed });
  }
  logEvent(ctx, actor, kind, 'ticket', job.ticketId, { status: next.status, api: apiNameOf(ctx, job.apiId), ...payload });
  return next;
}

function queueTicketTask(ctx: Ctx, kind: string, role: string, ticketId: bigint, orderId: bigint | undefined, input: unknown) {
  const row = ctx.db.task.insert({
    id: 0n, kind, role, status: 'queued', orderId, ticketId,
    leaseOwner: undefined, leaseUntil: undefined, attempt: 0, input: JSON.stringify(input), output: '',
    createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
  });
  logEvent(ctx, 'rules', 'task_queued', 'task', row.id, { kind, role, ticketId: ticketId.toString(), orderId: orderId?.toString() ?? '' });
  return row;
}

function closeTicketTasks(ctx: Ctx, ticketId: bigint, kinds: string[], status: 'done' | 'cancelled', output: unknown) {
  for (const kind of kinds) {
    for (const row of ctx.db.task.kind.filter(kind)) {
      if (row.ticketId === ticketId && ['queued', 'claimed', 'dispatched'].includes(row.status)) {
        ctx.db.task.id.update({ ...row, status, output: JSON.stringify(output), leaseUntil: undefined, updatedAt: ctx.timestamp });
      }
    }
  }
}

function queueCompileTask(ctx: Ctx, job: Job) {
  queueTicketTask(ctx, 'compile', 'droid_runner', job.ticketId, undefined, {
    ticketId: job.ticketId.toString(), apiId: job.apiId.toString(), api: apiNameOf(ctx, job.apiId),
    attempt: job.attempt + 1, droidSessionId: job.droidSessionId, feedback: job.feedback,
  });
}

function releaseReservation(ctx: Ctx, job: Job): Job {
  if (!job.reservedCents) return job;
  const b = engBudget(ctx);
  ctx.db.budget.name.update({ ...b, reservedCents: Math.max(0, b.reservedCents - job.reservedCents) });
  const next = { ...job, reservedCents: 0 };
  ctx.db.compileJob.ticketId.update(next);
  return next;
}

// The CFO's investment is spent once Droid has worked on it (shipped or not); the ledger books it.
function bookSpend(ctx: Ctx, job: Job): Job {
  const amount = job.reservedCents;
  if (!amount) return job;
  const b = engBudget(ctx);
  ctx.db.budget.name.update({ ...b, reservedCents: Math.max(0, b.reservedCents - amount), spentCents: b.spentCents + amount });
  postTx(ctx, `engineering: compile ticket ${job.ticketId} (${apiNameOf(ctx, job.apiId)}) (TEST MODE)`, [['budget:engineering', BigInt(amount)], ['treasury', -BigInt(amount)]]);
  const next = { ...job, reservedCents: 0, spentCents: job.spentCents + amount };
  ctx.db.compileJob.ticketId.update(next);
  logEvent(ctx, 'treasurer', 'engineering_spend_booked', 'ticket', job.ticketId, { amountCents: amount, api: apiNameOf(ctx, job.apiId) });
  return next;
}

// Ends a job: spend is booked when a compile attempt or a ship happened, otherwise the reservation is released.
function endJob(ctx: Ctx, job: Job, status: string, actor: string, kind: string, payload: Record<string, unknown> = {}): Job {
  closeTicketTasks(ctx, job.ticketId, COMPILE_TASK_KINDS, 'cancelled', { reason: `compile ${status}` });
  for (const approval of ctx.db.approval.iter()) {
    const task = approval.refType === 'task' ? ctx.db.task.id.find(approval.refId) : undefined;
    if (approval.status === 'pending' && ((approval.refType === 'ticket' && approval.refId === job.ticketId) || task?.ticketId === job.ticketId)) {
      ctx.db.approval.id.update({ ...approval, status: 'rejected', decidedAt: ctx.timestamp });
      logEvent(ctx, actor, 'approval_cancelled', 'approval', approval.id, { ticketId: job.ticketId.toString(), reason: `compile ${status}` });
    }
  }
  const settled = job.attempt > 0 || job.status === 'shipping' ? bookSpend(ctx, job) : releaseReservation(ctx, job);
  return setJob(ctx, settled, { status }, actor, kind, payload);
}

export const close_compile = spacetimedb.reducer({ ticketId: t.u64(), reason: t.string() }, (ctx, { ticketId, reason }) => {
  requireRole(ctx, 'founder');
  if (!reason.trim()) throw new SenderError('a reason is required');
  const job = findJob(ctx, ticketId);
  if (!JOB_ACTIVE.includes(job.status)) throw new SenderError(`ticket ${ticketId} is ${job.status}, not active`);
  if (['compiling', 'shipping'].includes(job.status)) throw new SenderError(`ticket ${ticketId} has a worker in flight`);
  endJob(ctx, job, 'closed', 'founder', 'compile_closed', { reason });
});

// Reserve the job's amount against the engineering budget: spent + reserved + amount must fit the cap,
// unless the founder approved the overrun. Over the cap the job waits on a spend_over_cap approval.
function reserveBudget(ctx: Ctx, job: Job, actor: string): Job {
  const b = engBudget(ctx);
  const available = b.capCents - b.spentCents - b.reservedCents;
  if (job.amountCents > available && !job.overCapApproved) {
    const ap = ctx.db.approval.insert({
      id: 0n, kind: 'spend_over_cap', refType: 'ticket', refId: job.ticketId, amountCents: job.amountCents,
      detail: JSON.stringify({ api: apiNameOf(ctx, job.apiId), capCents: b.capCents, reservedCents: b.reservedCents, spentCents: b.spentCents, availableCents: available }),
      status: 'pending', createdAt: ctx.timestamp, decidedAt: undefined,
    });
    logEvent(ctx, 'treasurer', 'approval_requested', 'approval', ap.id, { kind: ap.kind, amountCents: job.amountCents, ticketId: job.ticketId.toString() });
    return setJob(ctx, job, { status: 'awaiting_approval' }, 'treasurer', 'compile_over_cap', { amountCents: job.amountCents, availableCents: available, approvalId: ap.id.toString() });
  }
  ctx.db.budget.name.update({ ...b, reservedCents: b.reservedCents + job.amountCents });
  const next = setJob(ctx, job, { status: 'queued', reservedCents: job.amountCents }, actor, 'budget_reserved', {
    amountCents: job.amountCents, capCents: b.capCents, reservedCents: b.reservedCents + job.amountCents, spentCents: b.spentCents, overCapApproved: job.overCapApproved,
  });
  queueCompileTask(ctx, next);
  return next;
}

// Opens (or reuses) the API's compile ticket and hands it to the CFO. Only Tier 0 APIs compile.
function openCompileTicket(ctx: Ctx, apiId: bigint, trigger: string, detail: Record<string, unknown>, text: string, orderId: bigint | undefined) {
  const a = ctx.db.api.id.find(apiId);
  if (!a || a.tier !== 0 || ctx.db.apiRetired.apiId.find(apiId)) return undefined;
  let tk = [...ctx.db.ticket.iter()].find((x) => x.apiId === apiId && x.label === 'compile' && x.status === 'open');
  if (tk && ctx.db.compileJob.ticketId.find(tk.id)) return tk;
  if (!tk) {
    tk = ctx.db.ticket.insert({
      id: 0n, orderId, apiId, label: 'compile', text: text.slice(0, 2000), confidenceBp: 10_000, status: 'open', createdAt: ctx.timestamp,
    });
    logEvent(ctx, 'rules', 'ticket_opened', 'ticket', tk.id, { label: 'compile', apiId: apiId.toString(), api: a.name, trigger, ...detail });
  }
  ctx.db.compileJob.insert({
    ticketId: tk.id, apiId, trigger, triggerDetail: JSON.stringify(detail), status: 'awaiting_cfo', decision: '', amountCents: 0, rationale: '',
    overCapApproved: false, reservedCents: 0, spentCents: 0, attempt: 0, droidSessionId: '', testsPassed: false, testResults: '', feedback: '',
    costBeforeMicros: ctx.db.apiCost.apiId.find(apiId)?.costPerCallMicros ?? 0n, versionId: undefined, createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
  });
  queueTicketTask(ctx, 'cfo_compile', 'cfo', tk.id, orderId, { ticketId: tk.id.toString(), api: a.name, trigger, detail });
  logEvent(ctx, 'rules', 'compile_triggered', 'ticket', tk.id, { api: a.name, trigger, ...detail });
  return tk;
}

const RUN_DONE = ['auditing', 'delivered', 'audit_rejected'];

// The API's last `window` verified runs, newest first, counted on the values as the customer sees them.
function recentRuns(ctx: Ctx, apiId: bigint, window: number): RunCounts[] {
  const out: RunCounts[] = [];
  if (window < 1) return out;
  const done = [...ctx.db.orders.iter()].filter((o) => o.apiId === apiId && RUN_DONE.includes(o.status)).sort((a, b) => (a.id < b.id ? 1 : -1));
  for (const o of done) {
    if (out.length >= window) break;
    const vals = currentValues(ctx, o.id);
    if (vals.length) out.push({ orderId: o.id, verified: vals.filter((v) => v.status === 'verified').length, total: vals.length });
  }
  return out;
}

// Opens compile tickets per AGENTS.md §3. After a terminal decision (deferred, failed, ...) the same API
// is not re-ticketed until a compile threshold changes (force) or it gains buyers since that decision.
function checkCompileTriggers(ctx: Ctx, apiId: bigint | undefined, force: boolean) {
  const window = cfgInt(ctx, 'compile_window_runs');
  const minBuyers = cfgInt(ctx, 'compile_min_buyers');
  const minVerifiedRate = cfgNum(ctx, 'compile_min_verified_rate', 0);
  const apis = apiId === undefined ? [...ctx.db.api.iter()] : [ctx.db.api.id.find(apiId)].filter((x): x is NonNullable<typeof x> => x != null);
  for (const a of apis) {
    if (a.tier !== 0 || ctx.db.apiRetired.apiId.find(a.id)) continue;
    const hit = evaluateTriggers({ buyers: a.buyerCount, minBuyers, runs: recentRuns(ctx, a.id, window), window, minVerifiedRate });
    if (!hit) continue;
    const open = [...ctx.db.ticket.iter()].find((x) => x.apiId === a.id && x.label === 'compile' && x.status === 'open');
    if (open && ctx.db.compileJob.ticketId.find(open.id)) continue;
    if (!force && !open) {
      const last = [...ctx.db.compileJob.apiId.filter(a.id)].sort((x, y) => (x.ticketId < y.ticketId ? 1 : -1))[0];
      if (last && !JOB_ACTIVE.includes(last.status)) {
        let prevBuyers = 0;
        try { prevBuyers = Number((JSON.parse(last.triggerDetail) as { buyers?: number }).buyers ?? 0); } catch { /* no detail */ }
        if (!(hit.trigger === 'buyers' && a.buyerCount > prevBuyers)) continue;
      }
    }
    const d = hit.detail as { buyers: number; minBuyers: number; verifiedRate: number; minVerifiedRate: number; runs: number };
    const text = hit.trigger === 'buyers'
      ? `${a.name} reached ${d.buyers} distinct buyers (compile_min_buyers ${d.minBuyers})`
      : `${a.name} verified ${Math.round(d.verifiedRate * 100)}% of values over its last ${d.runs} runs (compile_min_verified_rate ${d.minVerifiedRate})`;
    openCompileTicket(ctx, a.id, hit.trigger, hit.detail, text, undefined);
  }
}

// A claimed compile task means Droid is working on the job.
function onTaskClaimed(ctx: Ctx, row: TaskRow) {
  if (row.kind !== 'compile' || row.ticketId === undefined) return;
  const job = ctx.db.compileJob.ticketId.find(row.ticketId);
  if (job && ['queued', 'rework'].includes(job.status)) {
    setJob(ctx, job, { status: 'compiling' }, 'droid_runner', 'compile_started', { taskId: row.id.toString(), attempt: job.attempt + 1 });
  }
}

function leasedTask(ctx: Ctx, taskId: bigint, kinds: string[]): TaskRow {
  const row = ctx.db.task.id.find(taskId);
  if (!row) throw new SenderError(`no task ${taskId}`);
  if (!kinds.includes(row.kind)) throw new SenderError(`task ${taskId} is a ${row.kind} task, not ${kinds.join(' or ')}`);
  if (row.status !== 'claimed' || !row.leaseOwner || !row.leaseOwner.isEqual(ctx.sender)) throw new SenderError('not the lease owner');
  if (row.leaseUntil && row.leaseUntil.microsSinceUnixEpoch < ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('lease expired');
  return row;
}

function jobOfTask(ctx: Ctx, row: TaskRow): Job {
  if (row.ticketId === undefined) throw new SenderError(`task ${row.id} has no ticket`);
  return findJob(ctx, row.ticketId);
}

function finishTask(ctx: Ctx, row: TaskRow, status: string, output: unknown) {
  ctx.db.task.id.update({ ...row, status, output: JSON.stringify(output), leaseUntil: undefined, updatedAt: ctx.timestamp });
}

export const cfo_propose = spacetimedb.reducer(
  { ticketId: t.u64(), decision: t.string(), amountCents: t.u32(), rationale: t.string() },
  (ctx, { ticketId, decision, amountCents, rationale }) => {
    requireRole(ctx, 'cfo');
    if (!CFO_DECISIONS.includes(decision)) throw new SenderError(`decision must be one of ${CFO_DECISIONS.join(', ')}`);
    if (!rationale.trim()) throw new SenderError('a rationale is required');
    const job = findJob(ctx, ticketId);
    if (job.status !== 'awaiting_cfo') throw new SenderError(`ticket ${ticketId} is ${job.status}; nothing to propose`);
    if (decision === 'COMPILE' && (amountCents < 1 || amountCents > MAX_COMPILE_CENTS)) throw new SenderError(`a COMPILE amount must be 1-${MAX_COMPILE_CENTS} cents`);
    closeTicketTasks(ctx, ticketId, ['cfo_compile'], 'done', { decision, amountCents, rationale });
    const decided = { decision, amountCents: decision === 'DEFER' ? 0 : amountCents, rationale: rationale.slice(0, 4000) };
    if (decision === 'COMPILE') {
      reserveBudget(ctx, setJob(ctx, job, decided, 'cfo', 'cfo_proposed', { decision, amountCents, rationale: decided.rationale }), 'treasurer');
    } else {
      setJob(ctx, job, { ...decided, status: decision === 'DEFER' ? 'deferred' : 'repriced' }, 'cfo', 'cfo_proposed', { decision, amountCents: decided.amountCents, rationale: decided.rationale });
    }
  },
);

// Founder lever: the engineering budget cap. Queued compiles that no longer fit become ineligible
// (their reservation is released and the compile task cancelled); ineligible ones that fit again are requeued.
export const set_budget_cap = spacetimedb.reducer({ capCents: t.u32() }, (ctx, { capCents }) => {
  requireRole(ctx, 'founder');
  const b = engBudget(ctx);
  ctx.db.budget.name.update({ ...b, capCents });
  const { keep, ineligible } = refitBudget(capCents, b.spentCents, [...ctx.db.compileJob.iter()]);
  const madeIneligible: string[] = [];
  const eligibleAgain: string[] = [];
  for (const id of ineligible) {
    const j = findJob(ctx, id);
    if (j.status !== 'queued') continue;
    closeTicketTasks(ctx, id, ['compile'], 'cancelled', { reason: `budget cap lowered to ${capCents} cents` });
    setJob(ctx, releaseReservation(ctx, j), { status: 'ineligible' }, 'treasurer', 'compile_ineligible', { capCents, amountCents: j.amountCents });
    madeIneligible.push(id.toString());
  }
  for (const id of keep) {
    const j = findJob(ctx, id);
    if (j.status !== 'ineligible') continue;
    const cur = engBudget(ctx);
    ctx.db.budget.name.update({ ...cur, reservedCents: cur.reservedCents + j.amountCents });
    queueCompileTask(ctx, setJob(ctx, j, { status: 'queued', reservedCents: j.amountCents }, 'treasurer', 'compile_eligible_again', { capCents, amountCents: j.amountCents }));
    eligibleAgain.push(id.toString());
  }
  logEvent(ctx, 'founder', 'budget_cap_set', 'budget', 0n, { budget: 'engineering', from: b.capCents, to: capCents, ineligible: madeIneligible, eligibleAgain });
});

// Any worker seat: keep a long task's lease alive.
export const renew_lease = spacetimedb.reducer({ taskId: t.u64() }, (ctx, { taskId }) => {
  requireRole(ctx, ...ROLES.filter((r) => r !== 'founder'));
  const row = ctx.db.task.id.find(taskId);
  if (!row) throw new SenderError(`no task ${taskId}`);
  if (row.status !== 'claimed' || !row.leaseOwner || !row.leaseOwner.isEqual(ctx.sender)) throw new SenderError('not the lease owner');
  ctx.db.task.id.update({ ...row, leaseUntil: addMs(ctx.timestamp, LEASE_MS), updatedAt: ctx.timestamp });
});

// The droid-runner streams every Droid message and tool decision here (outcome in the payload:
// auto-allowed | denied | founder-approved). The Engineering tab reads these events.
export const log_droid_event = spacetimedb.reducer(
  { taskId: t.u64(), kind: t.string(), payload: t.string() },
  (ctx, { taskId, kind, payload }) => {
    requireRole(ctx, 'droid_runner');
    if (!/^[a-z][a-z_]{0,39}$/.test(kind)) throw new SenderError('kind must be 1-40 chars of a-z and _');
    const row = leasedTask(ctx, taskId, ['compile', 'ship']);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(payload) as unknown;
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed };
    } catch { body = { text: payload }; }
    let out = JSON.stringify({ ticketId: row.ticketId?.toString() ?? '', taskKind: row.kind, ...body });
    if (out.length > DROID_PAYLOAD_MAX) out = JSON.stringify({ ticketId: row.ticketId?.toString() ?? '', taskKind: row.kind, truncated: true, raw: out.slice(0, DROID_PAYLOAD_MAX) });
    logEvent(ctx, 'droid', `droid_${kind}`, 'task', taskId, out);
  },
);

// A command off the compile allowlist (and off the deny list) waits on a founder droid_action approval.
// The worker polls the approval row it finds by requestId.
export const request_droid_action = spacetimedb.reducer(
  { taskId: t.u64(), requestId: t.string(), tool: t.string(), detail: t.string(), reason: t.string() },
  (ctx, { taskId, requestId, tool, detail, reason }) => {
    requireRole(ctx, 'droid_runner');
    if (!/^[\w-]{8,64}$/.test(requestId)) throw new SenderError('requestId must be 8-64 chars of a-z, 0-9, _ or -');
    const row = leasedTask(ctx, taskId, ['compile']);
    const job = jobOfTask(ctx, row);
    const ap = ctx.db.approval.insert({
      id: 0n, kind: 'droid_action', refType: 'task', refId: taskId, amountCents: 0,
      detail: JSON.stringify({ requestId, ticketId: job.ticketId.toString(), api: apiNameOf(ctx, job.apiId), tool: tool.slice(0, 100), detail: detail.slice(0, 2000), reason: reason.slice(0, 500) }),
      status: 'pending', createdAt: ctx.timestamp, decidedAt: undefined,
    });
    logEvent(ctx, 'droid', 'approval_requested', 'approval', ap.id, { kind: ap.kind, taskId: taskId.toString(), ticketId: job.ticketId.toString(), tool, detail: detail.slice(0, 500) });
  },
);

// The droid-runner's compile result: Droid session, the three version tests, denied actions and the diff.
// The tests pass only when fixtures, contract and live all report 'pass'.
export const submit_compile = spacetimedb.reducer(
  { taskId: t.u64(), droidSessionId: t.string(), results: t.string() },
  (ctx, { taskId, droidSessionId, results }) => {
    requireRole(ctx, 'droid_runner');
    const row = leasedTask(ctx, taskId, ['compile']);
    const job = jobOfTask(ctx, row);
    if (job.status !== 'compiling') throw new SenderError(`ticket ${job.ticketId} is ${job.status}, not compiling`);
    if (!droidSessionId.trim()) throw new SenderError('droidSessionId is required');
    if (job.droidSessionId && job.droidSessionId !== droidSessionId) throw new SenderError(`rework must resume session ${job.droidSessionId}`);
    let parsed: unknown;
    try { parsed = JSON.parse(results); } catch { throw new SenderError('results must be JSON'); }
    const passed = testsPassed(parsed);
    const attempt = job.attempt + 1;
    const tests = (parsed as { tests?: Record<string, unknown> }).tests ?? {};
    finishTask(ctx, row, 'done', { attempt, passed, droidSessionId });
    const next = setJob(ctx, job, {
      status: 'auditing', attempt, droidSessionId, testsPassed: passed, testResults: results.slice(0, RESULTS_MAX),
    }, 'droid_runner', 'compile_submitted', { attempt, passed, droidSessionId, tests });
    queueTicketTask(ctx, 'audit_compile', 'auditor', job.ticketId, undefined, { ticketId: job.ticketId.toString(), api: apiNameOf(ctx, job.apiId), attempt: next.attempt, passed });
  },
);

// The droid-runner could not run the compile or the ship at all (not a test failure): the job fails.
export const compile_failed = spacetimedb.reducer({ taskId: t.u64(), reason: t.string() }, (ctx, { taskId, reason }) => {
  requireRole(ctx, 'droid_runner');
  if (!reason.trim()) throw new SenderError('a reason is required');
  const row = leasedTask(ctx, taskId, ['compile', 'ship']);
  const job = jobOfTask(ctx, row);
  finishTask(ctx, row, 'failed', { reason });
  endJob(ctx, job, 'failed', 'droid_runner', 'compile_failed', { taskKind: row.kind, reason: reason.slice(0, 2000) });
});

// Auditor on a submitted compile. ACCEPT needs all three version tests to have passed and asks the
// founder to approve the ship; REJECT sends the reason back to the same Droid session, up to compile_max_attempts.
export const compile_verdict = spacetimedb.reducer(
  { ticketId: t.u64(), verdict: t.string(), reason: t.string() },
  (ctx, { ticketId, verdict, reason }) => {
    requireRole(ctx, 'auditor');
    if (verdict !== 'ACCEPT' && verdict !== 'REJECT') throw new SenderError('verdict must be ACCEPT or REJECT');
    if (!reason.trim()) throw new SenderError('a reason is required');
    const job = findJob(ctx, ticketId);
    if (job.status !== 'auditing') throw new SenderError(`ticket ${ticketId} is ${job.status}, not auditing`);
    if (verdict === 'ACCEPT' && !job.testsPassed) throw new SenderError('the version tests did not all pass; ACCEPT is not allowed');
    closeTicketTasks(ctx, ticketId, ['audit_compile'], 'done', { verdict, reason });
    const feedback = reason.slice(0, 4000);
    if (verdict === 'ACCEPT') {
      const next = setJob(ctx, job, { status: 'ship_pending', feedback }, 'auditor', 'compile_accepted', { attempt: job.attempt, reason: feedback });
      const ap = ctx.db.approval.insert({
        id: 0n, kind: 'api_ship', refType: 'ticket', refId: ticketId, amountCents: job.spentCents + job.reservedCents,
        detail: JSON.stringify({
          api: apiNameOf(ctx, job.apiId), attempt: next.attempt, droidSessionId: job.droidSessionId,
          costBeforeMicros: job.costBeforeMicros.toString(), auditorReason: feedback,
        }),
        status: 'pending', createdAt: ctx.timestamp, decidedAt: undefined,
      });
      logEvent(ctx, 'auditor', 'approval_requested', 'approval', ap.id, { kind: ap.kind, ticketId: ticketId.toString(), api: apiNameOf(ctx, job.apiId) });
      return;
    }
    const max = Math.max(1, cfgInt(ctx, 'compile_max_attempts'));
    if (job.attempt >= max) {
      endJob(ctx, { ...job, feedback }, 'failed', 'auditor', 'compile_rejected_final', { attempt: job.attempt, maxAttempts: max, reason: feedback });
      return;
    }
    queueCompileTask(ctx, setJob(ctx, job, { status: 'rework', feedback }, 'auditor', 'compile_rejected', { attempt: job.attempt, maxAttempts: max, reason: feedback }));
  },
);

function decideCompileApproval(ctx: Ctx, kind: string, ticketId: bigint, approve: boolean) {
  const job = findJob(ctx, ticketId);
  if (kind === 'spend_over_cap') {
    if (job.status !== 'awaiting_approval') throw new SenderError(`ticket ${ticketId} is ${job.status}, not awaiting approval`);
    if (approve) reserveBudget(ctx, setJob(ctx, job, { overCapApproved: true }, 'founder', 'spend_over_cap_approved', { amountCents: job.amountCents }), 'founder');
    else setJob(ctx, job, { status: 'rejected' }, 'founder', 'spend_over_cap_rejected', { amountCents: job.amountCents });
    return;
  }
  if (job.status !== 'ship_pending') throw new SenderError(`ticket ${ticketId} is ${job.status}, not waiting to ship`);
  if (!approve) { endJob(ctx, job, 'ship_rejected', 'founder', 'api_ship_rejected'); return; }
  const next = setJob(ctx, job, { status: 'shipping' }, 'founder', 'api_ship_approved', { droidSessionId: job.droidSessionId });
  queueTicketTask(ctx, 'ship', 'droid_runner', ticketId, undefined, {
    ticketId: ticketId.toString(), apiId: job.apiId.toString(), api: apiNameOf(ctx, job.apiId), droidSessionId: next.droidSessionId,
  });
}

// The droid-runner after `apify push` of an approved ship. Versions are additive only: every field of the
// current version must still be there. The API switches to the new Tier 1 version for the next order.
export const record_api_version = spacetimedb.reducer(
  {
    taskId: t.u64(), version: t.string(), tier: t.u8(), engine: t.string(), apifyId: t.string(),
    fields: t.string(), droidSessionId: t.string(), testsPassed: t.bool(),
  },
  (ctx, { taskId, version, tier, engine, apifyId, fields, droidSessionId, testsPassed: passed }) => {
    requireRole(ctx, 'droid_runner');
    const row = leasedTask(ctx, taskId, ['ship']);
    const job = jobOfTask(ctx, row);
    if (job.status !== 'shipping') throw new SenderError(`ticket ${job.ticketId} is ${job.status}, not shipping`);
    if (tier !== 1 || engine !== 'actor') throw new SenderError('a compiled version is tier 1 with engine actor');
    if (!apifyId.trim()) throw new SenderError('apifyId is required');
    if (!/^\d+\.\d+$/.test(version)) throw new SenderError('version must look like 1.0');
    if (!passed || !job.testsPassed) throw new SenderError('only a version whose tests passed can ship');
    if (droidSessionId !== job.droidSessionId) throw new SenderError(`droidSessionId must be the audited session ${job.droidSessionId}`);
    let next: string[];
    try { next = parseFields(fields); } catch (err) { throw new SenderError((err as Error).message); }
    const a = ctx.db.api.id.find(job.apiId);
    if (!a) throw new Error(`api ${job.apiId} is missing`);
    const prev = a.currentVersionId !== undefined ? ctx.db.apiVersion.id.find(a.currentVersionId) : undefined;
    const dropped = droppedFields(prev ? parseFields(prev.fields) : [], next);
    if (dropped.length) throw new SenderError(`contract: version ${version} drops field(s) ${dropped.join(', ')} of version ${prev?.version}`);
    if ([...ctx.db.apiVersion.apiId.filter(a.id)].some((v) => v.version === version)) throw new SenderError(`${a.name} already has version ${version}`);
    const v = ctx.db.apiVersion.insert({
      id: 0n, apiId: a.id, version, tier, engine, apifyId, fields: JSON.stringify(next), droidSessionId, testsPassed: true, shippedAt: ctx.timestamp,
    });
    ctx.db.api.id.update({ ...a, tier, currentVersionId: v.id });
    finishTask(ctx, row, 'done', { versionId: v.id.toString(), apifyId });
    const spent = bookSpend(ctx, job);
    const shipped = setJob(ctx, spent, { status: 'shipped', versionId: v.id }, 'droid_runner', 'api_version_shipped', {
      version, tier, engine, apifyId, fields: next, previousVersion: prev?.version ?? '', previousTier: prev?.tier ?? 0,
      costBeforeMicros: job.costBeforeMicros.toString(), buyers: a.buyerCount, droidSessionId, spentCents: spent.spentCents,
    });
    // Bonuses accrue only on accepted, shipped work.
    for (const role of ['droid_runner', 'cfo']) {
      const cents = Math.floor((shipped.spentCents * cfgInt(ctx, `bonus_rate.${role}`)) / 100);
      if (cents <= 0) continue;
      ctx.db.bonus.insert({ id: 0n, role, orderId: undefined, taskId, amountCents: cents, status: 'accrued', createdAt: ctx.timestamp });
      postTx(ctx, `bonus ${role} compile ticket ${job.ticketId}`, [[`seat:${role}`, BigInt(cents)], ['treasury', -BigInt(cents)]]);
    }
  },
);
// Founder: insert config keys and rows added after the database was first initialized.
export const ensure_defaults = spacetimedb.reducer((ctx) => {
  requireRole(ctx, 'founder');
  const added: string[] = [];
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    if (!ctx.db.config.key.find(key)) { ctx.db.config.insert({ key, value, updatedAt: ctx.timestamp }); added.push(key); }
  }
  if (!ctx.db.budget.name.find('engineering')) { ctx.db.budget.insert({ name: 'engineering', capCents: 2000, reservedCents: 0, spentCents: 0 }); added.push('budget:engineering'); }
  if (ctx.db.dispatchSchedule.count() === 0n) { ctx.db.dispatchSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(DISPATCH_EVERY_MICROS) }); added.push('dispatch_schedule'); }
  logEvent(ctx, 'founder', 'defaults_ensured', 'config', 0n, { added });
});

export const routes = spacetimedb.httpRouter(
  new Router().post('/ping', ping).post('/creao-callback', creao_callback).post('/apify-callback', apify_callback),
);
