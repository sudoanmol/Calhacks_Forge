// Usage: node scripts/make-fixtures.mjs <apiName> [--out <actorDir>]
// Pulls the latest Tier 0 run of an API that has verified values and writes, into the Actor dir:
//   api.json       the API's spec (sources, outputSchema, markers, render, pageCap) from its Apify Task input
//   contract.json  the fields of the version being replaced (the contract test keeps them)
//   fixtures/<snapshotKey>/{meta.json, page.txt, page.html, expected.json}
// Reads SpacetimeDB anonymously (public tables) and Apify with APIFY_TOKEN.
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const apiName = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : join(fileURLToPath(import.meta.url), '../..'));
if (!apiName) throw new Error('usage: make-fixtures.mjs <apiName> [--out <actorDir>]');

const need = (k) => { if (!process.env[k]) throw new Error(`${k} is not set`); return process.env[k]; };
const host = need('SPACETIME_HOST');
const db = need('SPACETIME_DB');
const apifyToken = need('APIFY_TOKEN');

// SATS-JSON: an option is [0, v] (some) or [1, []] (none); a timestamp is [micros].
const decode = (type, v) => {
  const variants = type.Sum?.variants;
  if (variants && Array.isArray(v) && variants.length === 2 && variants.some((x) => x.name.some === 'some')) {
    return variants[v[0]]?.name.some === 'some' ? decode(variants[v[0]].algebraic_type, v[1]) : undefined;
  }
  const els = type.Product?.elements;
  if (els?.length === 1 && els[0].name.some === '__timestamp_micros_since_unix_epoch__' && Array.isArray(v)) return v[0];
  return v;
};
const sql = async (query) => {
  const r = await fetch(`${host}/v1/database/${db}/sql`, { method: 'POST', body: query });
  if (!r.ok) throw new Error(`sql ${r.status}: ${(await r.text()).slice(0, 300)} (${query})`);
  const [res] = await r.json();
  const cols = res.schema.elements;
  return res.rows.map((row) => Object.fromEntries(row.map((v, i) => [cols[i].name.some, decode(cols[i].algebraic_type, v)])));
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const apify = async (path, { raw = false } = {}) => {
  const r = await fetch(`https://api.apify.com/v2${path}`, { headers: { Authorization: `Bearer ${apifyToken}` } });
  if (!r.ok) throw new Error(`apify GET ${path}: ${r.status}`);
  return raw ? r.text() : (await r.json()).data;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

const [api] = await sql(`SELECT * FROM api WHERE name = ${lit(apiName)}`);
if (!api) throw new Error(`no api named ${apiName}`);
const [version] = await sql(`SELECT * FROM api_version WHERE id = ${api.current_version_id}`);
if (!version || version.engine !== 'task' || !version.apify_id) throw new Error(`${apiName}: current version is not a Tier 0 Task`);
const task = await apify(`/actor-tasks/${version.apify_id}`);
const taskInput = task.input ?? {};

const values = await sql(`SELECT * FROM value_record WHERE api_id = ${api.id}`);
const verified = values.filter((v) => v.status === 'verified');
if (!verified.length) throw new Error(`${apiName}: no verified values yet`);
const orderId = verified.reduce((m, v) => (v.order_id > m ? v.order_id : m), 0);
const rows = verified.filter((v) => v.order_id === orderId);
const [order] = await sql(`SELECT * FROM orders WHERE id = ${orderId}`);
if (!order?.apify_run_id) throw new Error(`order ${orderId} has no Apify run`);
const run = await apify(`/actor-runs/${order.apify_run_id}`);

const spec = {
  name: api.name,
  description: api.description,
  sources: taskInput.sources ?? JSON.parse(api.sources || '[]'),
  outputSchema: taskInput.outputSchema ?? JSON.parse(api.output_schema),
  markers: taskInput.markers ?? [],
  render: taskInput.render ?? 'unlocker',
  pageCap: api.page_cap ?? taskInput.pageCap ?? 1,
  volatility: api.volatility,
};
const fields = JSON.parse(version.fields || '[]');

mkdirSync(outDir, { recursive: true });
writeJson(join(outDir, 'api.json'), spec);
writeJson(join(outDir, 'contract.json'), {
  api: api.name, replacesVersion: version.version, replacesTier: version.tier, fields,
  outputSchema: { type: 'object', properties: Object.fromEntries(fields.map((f) => [f, spec.outputSchema.properties?.[f] ?? {}])) },
});

const fixturesDir = join(outDir, 'fixtures');
rmSync(fixturesDir, { recursive: true, force: true });
const byKey = Map.groupBy(rows, (v) => v.snapshot_key);
const summary = [];
for (const [snapshotKey, vals] of byKey) {
  const store = run.defaultKeyValueStoreId;
  const text = await apify(`/key-value-stores/${store}/records/${snapshotKey}?attachment=1`, { raw: true });
  let html = '';
  try { html = await apify(`/key-value-stores/${store}/records/${snapshotKey}-html?attachment=1`, { raw: true }); } catch { /* text-only snapshot */ }
  const hash = sha256(text);
  if (hash !== vals[0].snapshot_hash) throw new Error(`${snapshotKey}: saved page hash ${hash} != recorded ${vals[0].snapshot_hash}`);
  const dir = join(fixturesDir, snapshotKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'page.txt'), text);
  if (html) writeFileSync(join(dir, 'page.html'), html);
  writeJson(join(dir, 'meta.json'), {
    url: vals[0].source_url, snapshotKey, snapshotHash: hash, orderId, apifyRunId: order.apify_run_id,
    observedAt: new Date(Number(vals[0].observed_at) / 1000).toISOString(),
    note: 'Saved Tier 0 page; expected.json holds the values verified on an independent Bright Data re-fetch.',
  });
  const expected = vals.sort((a, b) => a.row - b.row || a.metric.localeCompare(b.metric))
    .map((v) => ({ row: v.row, entity: v.entity, metric: v.metric, value: v.value }));
  writeJson(join(dir, 'expected.json'), expected);
  summary.push({ snapshotKey, url: vals[0].source_url, expected: expected.length, rows: new Set(expected.map((e) => e.row)).size, textChars: text.length, htmlChars: html.length });
}
console.log(JSON.stringify({ api: api.name, orderId, apifyRunId: order.apify_run_id, outDir, fields, fixtures: summary }, null, 2));
