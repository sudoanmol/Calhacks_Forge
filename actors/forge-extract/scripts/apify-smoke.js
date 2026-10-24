// Apify smoke test through the REST API: Tier 0 API as a Task of forge-extract → run → dataset + cost.
// Usage: pnpm --filter @forge/forge-extract apify-smoke
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { APIFY_TOKEN, APIFY_USERNAME } = process.env;
const api = async (path, init = {}) => {
  const r = await fetch(`https://api.apify.com/v2${path}`, {
    ...init, headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = JSON.parse(readFileSync(join(here, 'targets.json'), 'utf8')).find((t) => t.name.startsWith('yc-directory'));
const actor = (await api(`/acts/${APIFY_USERNAME}~forge-extract`)).data;
const taskName = 'yc-directory';
const input = { sources: [target.url], outputSchema: target.outputSchema, instructions: target.instructions, pageCap: 1 };

const existing = (await api(`/actor-tasks?limit=100`)).data.items.find((t) => t.name === taskName);
const task = existing
  ? (await api(`/actor-tasks/${existing.id}`, { method: 'PUT', body: JSON.stringify({ input }) })).data
  : (await api('/actor-tasks', { method: 'POST', body: JSON.stringify({ actId: actor.id, name: taskName, input, options: { timeoutSecs: 300, memoryMbytes: 1024 } }) })).data;
console.log(`task ${task.id} (${existing ? 'updated' : 'created'})`);

const t0 = Date.now();
let run = (await api(`/actor-tasks/${task.id}/runs`, { method: 'POST', body: '{}' })).data;
console.log(`run ${run.id} started`);
while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
  run = (await api(`/actor-runs/${run.id}?waitForFinish=60`)).data;
}
console.log(`run ${run.status} in ${Date.now() - t0}ms`);
await sleep(10_000); // cost fields can be preliminary right after the run ends
run = (await api(`/actor-runs/${run.id}`)).data;

const items = await api(`/datasets/${run.defaultDatasetId}/items?clean=1`);
const summaryRes = await fetch(`https://api.apify.com/v2/key-value-stores/${run.defaultKeyValueStoreId}/records/RUN_SUMMARY`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } });
const summary = summaryRes.ok ? await summaryRes.json() : null;
console.log(JSON.stringify({
  status: run.status, usageTotalUsd: run.usageTotalUsd, items: items.length,
  statuses: items.reduce((a, i) => ({ ...a, [i.status]: (a[i.status] ?? 0) + 1 }), {}),
  sample: items.slice(0, 3).map(({ metric, value, excerpt, status, snapshotKey }) => ({ metric, value, excerpt, status, snapshotKey })),
  summary: summary && { usage: summary.usage, total: summary.total, extracted: summary.extracted },
  datasetUrl: `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=1&format=json`,
  runUrl: `https://console.apify.com/actors/${actor.id}/runs/${run.id}`,
}, null, 2));
if (run.status !== 'SUCCEEDED' || !items.length) process.exit(1);
