// Flow B (AGENTS.md §6 B) against Maincloud with real seat identities: a canary order the COO sends to
// Research; Research fetches robots.txt, a Google search, the terms page and the source page through
// Bright Data (twice, two minutes apart), records cited gate checks and its report; the COO creates a
// Tier 0 API (a real Apify Task of forge-extract) and accepts; the run is ingested and verified.
// Canary orders are never dispatched to paid CREAO runs and stop at auditing.
// The test API and its Apify Task are removed at the end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, sql, founderToken } from './client.mjs';

const seat = (role) => {
  const tok = process.env[`SPACETIME_TOKEN_${role.toUpperCase()}`];
  if (!tok) throw new Error(`SPACETIME_TOKEN_${role.toUpperCase()} is not set`);
  return tok;
};
const stamp = Date.now();
const SOURCE = 'https://en.wikipedia.org/wiki/Palace_of_Fine_Arts';
const TERMS = 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use';
const API_NAME = `flowb-${stamp}`;
let founder, canary, coo, research;
let order, quoted;
let apifyTaskId = '';

const ok = (r) => assert.equal(r.status, 200, r.body);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = async (q) => (await sql(founder, q))[0];
const opt = (v) => (Array.isArray(v) && v[0] === 0 ? v[1] : undefined);
const fetchAs = async (tok, kind, target, orderId = order.id) => {
  const r = await call(tok, 'research_fetch', [orderId, kind, target]);
  return { ...r, json: r.ok ? JSON.parse(JSON.parse(r.body)) : null };
};
const gate = (check, result, url, text, tok = research) => call(tok, 'record_gate_check', [order.id, check, result, url, text]);
// A verbatim slice of the fetched page around the first match, the way forge research-fetch --find shows it.
const around = (text, re, chars = 120) => {
  const flat = text.replace(/\s+/g, ' ');
  const m = re.exec(flat);
  assert.ok(m, `${re} is on the page`);
  return flat.slice(Math.max(0, m.index - chars), m.index + m[0].length + chars).trim();
};

async function canaryOrder(ref, text) {
  ok(await call(canary, 'create_order', [ref, 'canary', text, '{"origin":"research test"}', 0]));
  ok(await call(canary, 'record_payment', [ref, 'canary-no-payment']));
  return one(`SELECT * FROM orders WHERE ref = '${ref}'`);
}

before(async () => {
  founder = founderToken();
  [canary, coo, research] = ['canary', 'coo', 'research'].map(seat);
  order = await canaryOrder(`rs-${stamp}`, 'Palace of Fine Arts from Wikipedia: architect, year opened and location');
  quoted = await canaryOrder(`rs-${stamp}-other`, 'research test: an order that stays with the COO');
});

after(async () => {
  for (const o of [order, quoted]) {
    const cur = o && await one(`SELECT * FROM orders WHERE id = ${o.id}`);
    if (cur && ['paid', 'triaging'].includes(cur.status)) await call(coo, 'coo_decide', [cur.id, 'REJECT', '-', 'research test cleanup']);
  }
  for (const t of await sql(founder, "SELECT * FROM task WHERE status = 'queued'")) {
    if ([order?.id, quoted?.id].includes(opt(t.order_id))) await call(founder, 'cancel_task', [t.id, 'research test cleanup']);
  }
  if (apifyTaskId) {
    const r = await fetch(`https://api.apify.com/v2/actor-tasks/${apifyTaskId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}` } });
    console.log(JSON.stringify({ deletedApifyTask: apifyTaskId, status: r.status }));
  }
  if (await one(`SELECT * FROM api WHERE name = '${API_NAME}'`)) await call(founder, 'retire_api', [API_NAME, 'Test API from research.test.mjs.']);
});

test('REQUEST_RESEARCH queues a research_gate task; only the research seat fetches and records', async () => {
  ok(await call(coo, 'coo_decide', [order.id, 'REQUEST_RESEARCH', '', 'New source: a Wikipedia article, no catalog API covers it.']));
  const task = (await sql(founder, "SELECT * FROM task WHERE kind = 'research_gate'")).find((x) => opt(x.order_id) === order.id);
  assert.deepEqual([task.role, task.status], ['research', 'queued']);
  for (const tok of [coo, canary]) {
    assert.match((await fetchAs(tok, 'robots', SOURCE)).body, /may not do this/);
    assert.match((await gate('robots', 'pass', 'https://en.wikipedia.org/robots.txt', 'User-agent: *', tok)).body, /may not do this/);
  }
  assert.match((await fetchAs(research, 'robots', SOURCE, quoted.id)).body, /is paid; research fetches are only for an order in researching/);
  assert.match((await fetchAs(research, 'mirror', SOURCE)).body, /kind must be one of/);
  assert.match((await fetchAs(research, 'page', 'https://www.facebook.com/x')).body, /blocked domain/);
  assert.match((await fetchAs(research, 'page', 'file:///etc/passwd')).body, /http\(s\) URL/);
  assert.match((await gate('robots', 'pass', 'https://en.wikipedia.org/robots.txt', 'User-agent: *')).body, /was not fetched for order/);
  assert.match((await gate('legal', 'pass', SOURCE, 'x')).body, /check must be one of/);
  assert.match((await call(research, 'research_report', [order.id, 'too early', `["${SOURCE}"]`, '[]', 'stable', 0, 0.5])).body, /missing: robots, terms, reachability, volatility/);
});

test('flow B: robots, search, terms, reachability and measured volatility, then the report', { timeout: 6 * 60_000 }, async () => {
  const robots = await fetchAs(research, 'robots', SOURCE);
  assert.equal(robots.status, 200, robots.body);
  assert.equal(robots.json.url, 'https://en.wikipedia.org/robots.txt');
  assert.equal(robots.json.found, true);
  assert.equal(robots.json.allowed, true, JSON.stringify(robots.json.rule));
  assert.equal(robots.json.path, '/wiki/Palace_of_Fine_Arts');
  console.log(JSON.stringify({ robots: { ms: robots.json.ms, rule: robots.json.rule, attempts: robots.json.attempts } }));
  const ev = (await sql(founder, 'SELECT * FROM evidence')).filter((e) => opt(e.order_id) === order.id);
  assert.ok(ev.some((e) => e.url === robots.json.url && e.method === 'unlocker'), 'the fetch is logged as evidence');
  assert.match((await gate('robots', 'pass', robots.json.url, 'Disallow: /everything-is-allowed-here')).body, /must quote a line of the robots.txt/);
  assert.match((await gate('robots', 'fail', robots.json.url, 'User-agent: *')).body, /allows every path checked/);
  ok(await gate('robots', 'pass', robots.json.url, 'User-agent: *'));

  const serp = await fetchAs(research, 'search', 'wikimedia foundation terms of use');
  assert.equal(serp.status, 200, serp.body);
  assert.ok(serp.json.results.length >= 3, JSON.stringify(serp.json.results));
  assert.ok(serp.json.results.some((x) => /wikimedia/i.test(`${x.title} ${x.link} ${x.description}`)), JSON.stringify(serp.json.results.slice(0, 5)));
  console.log(JSON.stringify({ serp: { ms: serp.json.ms, top: serp.json.results.slice(0, 3).map((x) => x.link) } }));
  assert.ok((await sql(founder, 'SELECT * FROM evidence')).some((e) => opt(e.order_id) === order.id && e.method === 'serp'));

  const terms = await fetchAs(research, 'page', TERMS);
  assert.equal(terms.status, 200, terms.body);
  assert.ok(terms.json.ok, terms.json.reason);
  const clause = around(terms.json.text, /Engaging in automated uses of the Project Websites/);
  assert.match((await gate('terms', 'pass', TERMS, 'You may scrape the Project Websites without limits.')).body, /not on the page fetched/);
  assert.match((await gate('terms', 'pass', TERMS, 'automated')).body, /at least 20 chars/);
  ok(await gate('terms', 'pass', TERMS, clause));

  const first = await fetchAs(research, 'page', SOURCE);
  assert.ok(first.json.ok, first.json.reason);
  assert.equal(first.json.compare, undefined);
  ok(await gate('reachability', 'pass', SOURCE, around(first.json.text, /Bernard Maybeck/, 60)));
  assert.match((await gate('volatility', 'pass', SOURCE, 'one fetch only')).body, /fetch .* twice at least 120 s apart \(now 1 fetch/);

  await sleep(125_000);
  const second = await fetchAs(research, 'page', SOURCE);
  assert.ok(second.json.ok, second.json.reason);
  const c = second.json.compare;
  assert.ok(c && c.enoughGap && c.secondsApart >= 120, JSON.stringify(c));
  console.log(JSON.stringify({ volatility: { secondsApart: c.secondsApart, changedLines: c.changedLines, numbersChanged: c.numbersChanged, suggested: c.suggested } }));
  ok(await gate('volatility', 'pass', SOURCE, `Fetched ${c.secondsApart} s apart: ${c.changedLines} changed lines, ${c.numbersChanged} changed numbers; ${c.suggested}.`));

  ok(await call(research, 'research_report', [order.id, 'Wikipedia article; robots allows /wiki/, terms allow non-abusive automated use, data visible by URL.',
    JSON.stringify([SOURCE]), JSON.stringify(['architect', 'opened', 'location']), 'stable', 0, 0.85]));
  const o = await one(`SELECT * FROM orders WHERE id = ${order.id}`);
  assert.equal(o.status, 'triaging');
  const rep = await one(`SELECT * FROM research_findings WHERE order_id = ${order.id}`);
  assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(rep.checks)).map(([k, v]) => [k, v.result])), { robots: 'pass', terms: 'pass', reachability: 'pass', volatility: 'pass' });
  const tasks = (await sql(founder, 'SELECT * FROM task')).filter((x) => opt(x.order_id) === order.id);
  assert.equal(tasks.find((x) => x.kind === 'research_gate').status, 'done');
  const triage = tasks.filter((x) => x.kind === 'coo_triage' && x.status === 'queued');
  assert.equal(triage.length, 1);
  assert.equal(JSON.parse(triage[0].input).researchReportId, String(rep.id));
  assert.match((await call(research, 'research_report', [order.id, 'again', `["${SOURCE}"]`, '[]', 'stable', 0, 0.5])).body, /is triaging, not researching/);
  assert.match((await call(coo, 'coo_decide', [order.id, 'REQUEST_RESEARCH', '', 'again'])).body, /already has a research report/);
});

test('flow B: the COO creates a Tier 0 API over researched sources; the order runs on its new Apify Task', { timeout: 8 * 60_000 }, async () => {
  const spec = {
    name: API_NAME, description: 'Palace of Fine Arts facts from its Wikipedia article (research test).', inputs: {},
    sources: [SOURCE], outputSchema: { type: 'object', properties: { architect: { type: 'string' }, opened: { type: 'string' }, location: { type: 'string' } } },
    volatility: 'stable', pageCap: 1, instructions: 'One row for the Palace of Fine Arts: its architect(s), the year it opened and its location, from the infobox or lead.',
  };
  assert.match((await call(coo, 'create_api', [JSON.stringify({ ...spec, sources: ['https://www.example.org/x'] }), '', 'task'])).body, /example.org has no research report/);
  assert.match((await call(coo, 'create_api', [JSON.stringify(spec), 'someTaskId', 'task'])).body, /COO creates Tier 0 APIs only/);
  assert.match((await call(coo, 'create_api', [JSON.stringify({ ...spec, pageCap: 999 }), '', 'task'])).body, /pageCap must be an integer/);
  ok(await call(coo, 'create_api', [JSON.stringify(spec), '', 'task']));
  const api = await one(`SELECT * FROM api WHERE name = '${API_NAME}'`);
  ok(await call(coo, 'coo_decide', [order.id, 'ACCEPT', API_NAME, 'Research passed robots, terms and reachability; new Tier 0 API over the article.']));

  const t0 = Date.now();
  let job;
  while (Date.now() - t0 < 60_000) {
    job = await one(`SELECT * FROM apify_task_job WHERE api_id = ${api.id}`);
    if (job.status !== 'pending') break;
    await sleep(1_000);
  }
  assert.equal(job.status, 'created', job.error);
  apifyTaskId = job.apify_task_id;
  const v = await one(`SELECT * FROM api_version WHERE api_id = ${api.id}`);
  assert.equal(v.apify_id, apifyTaskId);
  const input = await (await fetch(`https://api.apify.com/v2/actor-tasks/${apifyTaskId}/input`, { headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}` } })).json();
  assert.deepEqual(input.sources, [SOURCE]);
  assert.equal(input.instructions, spec.instructions);
  console.log(JSON.stringify({ apifyTask: apifyTaskId, createdInMs: Date.now() - t0 }));

  let o;
  while (Date.now() - t0 < 7 * 60_000) {
    o = await one(`SELECT * FROM orders WHERE id = ${order.id}`);
    if (['auditing', 'failed'].includes(o.status)) break;
    if (o.status === 'running' && o.apify_run_id && Date.now() - t0 > 90_000) {
      const run = await one(`SELECT * FROM run WHERE external_id = '${o.apify_run_id}'`);
      if (run) await call(canary, 'apify_poll', [run.id]);
    }
    await sleep(3_000);
  }
  assert.equal(o.status, 'auditing', `${o.status}: ${o.decision_reason}`);
  const values = await sql(founder, `SELECT * FROM value_record WHERE order_id = ${order.id}`);
  const counts = values.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ orderId: Number(order.id), elapsedMs: Date.now() - t0, counts, sample: values.slice(0, 3).map((x) => [x.metric, x.value, x.status]) }));
  assert.ok((counts.verified ?? 0) >= 1, JSON.stringify(counts));
});
