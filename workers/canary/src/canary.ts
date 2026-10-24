// Canary (AGENTS.md §10): a scripted end-to-end order on each seeded API through the real
// reducers, Apify run, ingest and Bright Data verification. Desk steps run as the canary seat,
// the ACCEPT as the COO seat. It stops at `auditing`: the Auditor's verdict is not the canary's
// to give. Results go to workers/canary/results/<timestamp>.json; README numbers come only from there.
// Usage: pnpm --filter @forge/canary canary [api-name[:param=value,...] ...], e.g. yc-directory:company=stripe
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Apify, Stdb, requireEnv, sleep, sqlString, type Row } from './clients.ts';
import { CATALOG, defaultSources, type SeededApi } from './catalog.ts';
import { judge, scoreValues, type ValueRow } from './summary.ts';

const TIMEOUT_MS = Number(process.env.CANARY_TIMEOUT_MS ?? 6 * 60_000);
const MIN_VERIFIED_RATE = Number(process.env.CANARY_MIN_VERIFIED_RATE ?? 0.8);
const POLL_MS = 3_000;
// After this long in `running`, nudge ingest with apify_poll in case the webhook never arrived.
const WEBHOOK_GRACE_MS = 90_000;
const TERMINAL = ['auditing', 'delivered', 'audit_rejected', 'failed', 'rejected', 'counteroffered', 'rejected_at_desk'];
const CANARY_SENDER = 'canary';

const stdb = new Stdb();
const apify = new Apify();
const canaryToken = requireEnv('SPACETIME_TOKEN_CANARY');
const cooToken = requireEnv('SPACETIME_TOKEN_COO');

const wanted = process.argv.slice(2).map((arg) => {
  const [name, spec = ''] = arg.split(':');
  const params = Object.fromEntries(spec.split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string]));
  return { name: name!, params };
});
const apis = wanted.length
  ? wanted.map((w) => ({ api: CATALOG.find((a) => a.name === w.name), params: w.params }))
  : CATALOG.map((api) => ({ api, params: {} as Record<string, string> }));
if (apis.some((x) => !x.api)) {
  throw new Error(`unknown api in ${wanted.map((w) => w.name).join(', ')}; seeded: ${CATALOG.map((a) => a.name).join(', ')}`);
}

const orderById = async (id: number): Promise<Row> => {
  const [row] = await stdb.sql(canaryToken, `SELECT * FROM orders WHERE id = ${id}`);
  if (!row) throw new Error(`order ${id} not found`);
  return row;
};

type ApifyRun = {
  id: string; status: string; usageTotalUsd?: number; startedAt?: string; finishedAt?: string;
  defaultKeyValueStoreId: string; stats?: { runTimeSecs?: number };
};
type RunSummary = {
  llm?: unknown; usage?: unknown;
  pages?: { url: string; status: string; method?: string; country?: string; truncated?: boolean; error?: string | null; reason?: string; attempts?: unknown[] }[];
};

const runOne = async (a: SeededApi, params: Record<string, string>, stamp: string) => {
  const t0 = Date.now();
  const ref = `canary-${a.name}-${Object.values(params).join('-') || 'default'}-${stamp}`;
  const intent = { api: a.name, fields: Object.keys(a.outputSchema.properties), sources: defaultSources(a), params, origin: 'canary' };
  // Price 0: the canary takes no payment, so it books no revenue (TEST MODE).
  await stdb.call(canaryToken, 'create_order', [ref, CANARY_SENDER, a.sampleRequest, JSON.stringify(intent), 0]);
  if (Object.keys(params).length) await stdb.call(canaryToken, 'set_order_params', [ref, JSON.stringify(params)]);
  await stdb.call(canaryToken, 'record_payment', [ref, 'canary-no-payment']);
  const [created] = await stdb.sql(canaryToken, `SELECT * FROM orders WHERE ref = ${sqlString(ref)}`);
  if (!created) throw new Error(`order ${ref} was not created`);
  const orderId = Number(created.id);
  await stdb.call(cooToken, 'coo_decide', [orderId, 'ACCEPT', a.name, `Canary: scripted order on the seeded API ${a.name}.`]);

  const transitions: { status: string; atMs: number }[] = [];
  let order: Row = created;
  let runningSince = 0;
  let lastNudge = 0;
  let nudges = 0;
  while (Date.now() - t0 < TIMEOUT_MS) {
    order = await orderById(orderId);
    const status = String(order.status);
    if (transitions.at(-1)?.status !== status) transitions.push({ status, atMs: Date.now() - t0 });
    if (TERMINAL.includes(status)) break;
    if (status === 'running') {
      runningSince ||= Date.now();
      if (Date.now() - runningSince > WEBHOOK_GRACE_MS && Date.now() - lastNudge > 30_000 && order.apify_run_id !== '') {
        const [run] = await stdb.sql(canaryToken, `SELECT * FROM run WHERE external_id = ${sqlString(String(order.apify_run_id))}`);
        if (run) { await stdb.call(canaryToken, 'apify_poll', [Number(run.id)]); nudges++; }
        lastNudge = Date.now();
      }
    }
    await sleep(POLL_MS);
  }
  const elapsedMs = Date.now() - t0;
  const finalStatus = String(order.status);
  const timedOut = !TERMINAL.includes(finalStatus);

  const values = (await stdb.sql(canaryToken, `SELECT * FROM value_record WHERE order_id = ${orderId}`)) as (Row & ValueRow)[];
  const score = scoreValues(values);
  const evidence = (await stdb.sql(canaryToken, 'SELECT * FROM evidence')).filter((e) => Number(e.order_id) === orderId);
  const apifyRunId = String(order.apify_run_id ?? '');
  const [runRow] = apifyRunId ? await stdb.sql(canaryToken, `SELECT * FROM run WHERE external_id = ${sqlString(apifyRunId)}`) : [];
  const auditTasks = (await stdb.sql(canaryToken, "SELECT * FROM task WHERE kind = 'audit'")).filter((t) => Number(t.order_id) === orderId);

  let apifyRun: ApifyRun | undefined;
  let runSummary: RunSummary | null = null;
  if (apifyRunId) {
    // usageTotalUsd can be preliminary right after a run ends; the poll above usually gives it time to settle.
    apifyRun = (await apify.req<{ data: ApifyRun }>(`/actor-runs/${apifyRunId}`)).data;
    runSummary = await apify.record<RunSummary>(apifyRun.defaultKeyValueStoreId, 'RUN_SUMMARY');
  }

  const verdict = judge(finalStatus, score, MIN_VERIFIED_RATE);
  if (timedOut) verdict.reasons.unshift(`timed out after ${Math.round(TIMEOUT_MS / 1000)} s`);
  return {
    api: a.name,
    params,
    pass: verdict.pass && !timedOut,
    reasons: verdict.reasons,
    orderId,
    ref,
    finalStatus,
    decisionReason: String(order.decision_reason ?? ''),
    elapsedMs,
    transitions,
    values: score.values,
    rows: new Set(values.filter((v) => v.metric !== '_page').map((v) => `${v.source_url}#${v.row}`)).size,
    valuesByStatus: score.byStatus,
    verifiedRate: Number(score.verifiedRate.toFixed(4)),
    failedPages: score.failedPages,
    apify: {
      runId: apifyRunId,
      status: apifyRun?.status,
      runCostCents: runRow ? Number(runRow.cost_cents) : null,
      usageTotalUsd: apifyRun?.usageTotalUsd ?? null,
      runTimeSecs: apifyRun?.stats?.runTimeSecs ?? null,
      datasetUrl: String(order.dataset_url ?? ''),
      consoleUrl: apifyRunId ? `https://console.apify.com/view/runs/${apifyRunId}` : '',
      pages: runSummary?.pages?.map(({ url, status, method, country, truncated, error, reason, attempts }) => ({
        url, status, method, country, truncated, error, reason, ladderAttempts: attempts?.length ?? 0,
      })),
      llmUsage: runSummary?.usage ?? null,
      webhookNudges: nudges,
    },
    brightDataEvidenceRows: evidence.length,
    evidence: evidence.map((e) => ({ url: e.url, method: e.method, country: e.country, httpStatus: e.http_status, attempt: e.attempt, ms: e.ms, reason: e.reason })),
    auditTask: auditTasks.map((t) => ({ id: t.id, status: t.status, attempt: t.attempt })),
    sampleValues: values.slice(0, 3).map((v) => ({ row: v.row, metric: v.metric, value: v.value, status: v.status, excerpt: String(v.excerpt).slice(0, 120) })),
  };
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const settled = await Promise.allSettled(apis.map((x) => runOne(x.api!, x.params, stamp)));
const results = settled.map((s, i) => (s.status === 'fulfilled' ? s.value : { api: apis[i]!.api!.name, params: apis[i]!.params, pass: false, reasons: [`canary error: ${String(s.reason)}`] }));

const out = {
  mode: 'TEST MODE',
  recordedAt: new Date().toISOString(),
  database: `${stdb.host} / ${stdb.db}`,
  criterion: `order reaches auditing, every source page loads, verified rate >= ${MIN_VERIFIED_RATE} over all value rows`,
  results,
};
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'results');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${stamp}.json`);
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);

for (const r of results) {
  const x = r as { api: string; pass: boolean; reasons: string[]; verifiedRate?: number; values?: number; elapsedMs?: number };
  console.log(`${x.pass ? 'PASS' : 'FAIL'} ${x.api}: ${x.values ?? 0} values, verified ${((x.verifiedRate ?? 0) * 100).toFixed(1)}%, ${Math.round((x.elapsedMs ?? 0) / 1000)} s${x.reasons.length ? ` (${x.reasons.join('; ')})` : ''}`);
}
console.log(`results: ${file}`);
if (results.some((r) => !r.pass)) process.exitCode = 1;
