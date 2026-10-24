#!/usr/bin/env node
// forge-cli: how FORGE's CREAO agents read company state and call their seat's reducers.
// Node built-ins only (global fetch): packages installed during a CREAO run are not saved.
// Env: FORGE_DB_URL (https://maincloud.spacetimedb.com/v1/database/forge) and a seat token.
// CREAO secrets are account-wide, so each seat's token has its own name (FORGE_SEAT_TOKEN_COO,
// FORGE_SEAT_TOKEN_AUDITOR, ...) and each write command picks its seat's token.
// FORGE_SEAT_TOKEN, when set, overrides that choice.

const USAGE = `usage:
  forge task [<task JSON>]                       what to do for this run (default: $FORGE_TASK)
  forge order <id>                               order, gate checks, values, status counts, evidence
  forge catalog                                  live APIs with params, version, tier, fields, rates, cost
  forge decide <orderId> <ACCEPT|COUNTEROFFER|REQUEST_RESEARCH|REJECT> <apiName|-> <reason...>
  forge verdict <orderId> <ACCEPT|REJECT> <reason...>
  forge challenge <challengeId>                  a customer challenge: the value, saved page vs fresh page
  forge challenge-verdict <challengeId> <UPHELD|REJECTED> <reason...>
  forge create-api '<spec JSON>'                 COO: a new Tier 0 API over researched sources
  forge robots <orderId> <url>                   Research: the site's robots.txt and the verdict for this URL's path
  forge research-fetch <orderId> <url> [--find <text>]... [--max <chars>]
                                                 Research: fetch a page through Bright Data; a second fetch compares
  forge search <orderId> <query...>              Research: Google results through the Bright Data SERP API
  forge gate-check <orderId> <robots|terms|reachability|volatility> <pass|fail|unclear> <citationUrl> <citationText...>
  forge report <orderId> '<findings JSON>'       Research: {summary, sources, fields, volatility, freshnessWindowMin, confidence}
env: FORGE_DB_URL, FORGE_SEAT_TOKEN_<SEAT> (decide and create-api use COO; verdict and challenge-verdict use AUDITOR;
     robots, research-fetch, search, gate-check and report use RESEARCH) or FORGE_SEAT_TOKEN`;

class CliError extends Error {}

function env(name) {
  const v = process.env[name];
  if (!v) throw new CliError(`${name} is not set`);
  return v;
}
const dbUrl = () => env('FORGE_DB_URL').replace(/\/+$/, '');

function token(seat) {
  if (process.env.FORGE_SEAT_TOKEN) return process.env.FORGE_SEAT_TOKEN;
  if (seat) return env(`FORGE_SEAT_TOKEN_${seat.toUpperCase()}`);
  // Reads hit public tables, so any seat's token will do.
  const any = Object.keys(process.env).find((k) => k.startsWith('FORGE_SEAT_TOKEN_') && process.env[k]);
  if (!any) throw new CliError('no seat token: set FORGE_SEAT_TOKEN or FORGE_SEAT_TOKEN_<SEAT>');
  return process.env[any];
}

// SATS-JSON from the SQL endpoint: options are [0, value] (some) or [1, []] (none),
// timestamps are [micros], identities are [hex].
function decode(type, v) {
  if (type.Sum) {
    const variants = type.Sum.variants;
    const [tag, inner] = v;
    if (variants.length === 2 && variants[0].name.some === 'some' && variants[1].name.some === 'none') {
      return tag === 0 ? decode(variants[0].algebraic_type, inner) : null;
    }
    return { [variants[tag].name.some]: decode(variants[tag].algebraic_type, inner) };
  }
  if (type.Product) {
    const els = type.Product.elements;
    if (els.length === 1 && els[0].name.some === '__timestamp_micros_since_unix_epoch__') {
      return new Date(Number(BigInt(v[0]) / 1000n)).toISOString();
    }
    if (els.length === 1 && els[0].name.some === '__identity__') return String(v[0]);
    return Object.fromEntries(els.map((e, i) => [e.name.some ?? String(i), decode(e.algebraic_type, v[i])]));
  }
  return v;
}

async function sql(query) {
  const r = await fetch(`${dbUrl()}/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: query,
  });
  const body = await r.text();
  if (!r.ok) throw new CliError(`sql failed (${r.status}): ${body}`);
  const [res] = JSON.parse(body);
  const els = res.schema.elements;
  return res.rows.map((row) => Object.fromEntries(els.map((e, i) => [camel(e.name.some), decode(e.algebraic_type, row[i])])));
}

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

async function call(seat, reducer, args) {
  const r = await fetch(`${dbUrl()}/call/${reducer}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token(seat)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await r.text();
  if (!r.ok) throw new CliError(`${reducer} failed (${r.status}): ${body || r.statusText}`);
  return body;
}

function id(s, what = 'id') {
  if (!/^\d+$/.test(s ?? '')) throw new CliError(`${what} must be a positive integer, got ${JSON.stringify(s)}`);
  return Number(s);
}

const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const countBy = (rows, key) => rows.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + 1 }), {});

async function order(orderId) {
  const [o] = await sql(`SELECT * FROM orders WHERE id = ${orderId}`);
  if (!o) throw new CliError(`no order ${orderId}`);
  // Option columns cannot be filtered in SQL, so gate checks and evidence are filtered here.
  const [gates, values, evidence, apis] = await Promise.all([
    sql('SELECT * FROM gate_check'),
    sql(`SELECT * FROM value_record WHERE order_id = ${orderId}`),
    sql('SELECT * FROM evidence'),
    o.apiId === null ? [] : sql(`SELECT * FROM api WHERE id = ${o.apiId}`),
  ]);
  const ev = evidence.filter((e) => e.orderId === orderId);
  const [fetches, reports] = await Promise.all([
    sql(`SELECT * FROM research_page WHERE order_id = ${orderId}`),
    sql(`SELECT * FROM research_findings WHERE order_id = ${orderId}`),
  ]);
  return {
    order: {
      id: o.id, ref: o.ref, status: o.status, requestText: o.requestText, intent: parseJson(o.intent, o.intent),
      params: parseJson(o.params, {}), priceCents: o.priceCents, api: apis[0]?.name ?? null,
      apiDescription: apis[0]?.description ?? null, apiFields: Object.keys(parseJson(apis[0]?.outputSchema, {}).properties ?? {}),
      apiVersionId: o.apiVersionId, datasetUrl: o.datasetUrl,
      decisionReason: o.decisionReason, createdAt: o.createdAt, updatedAt: o.updatedAt,
    },
    gateChecks: gates.filter((g) => g.orderId === orderId)
      .map(({ check, result, citationUrl, citationText, at }) => ({ check, result, citationUrl, citationText, at })),
    research: {
      fetches: fetches.sort((a, b) => a.id - b.id).map(({ id: pid, kind, target, url, ok, httpStatus, reason, chars, summary, fetchedAt }) => {
        const s = parseJson(summary, {});
        return {
          id: pid, kind, target, url, ok, httpStatus, reason: reason || null, chars, fetchedAt,
          ...(kind === 'robots' ? { allowed: s.allowed, rule: s.rule ?? null } : {}),
          ...(s.compare ? { compare: { secondsApart: s.compare.secondsApart, changedLines: s.compare.changedLines, numbersChanged: s.compare.numbersChanged, suggested: s.compare.suggested } } : {}),
        };
      }),
      reports: reports.map((r) => ({
        id: r.id, summary: r.summary, sources: parseJson(r.sources, []), fields: parseJson(r.fields, []), volatility: r.volatility,
        freshnessWindowMin: r.freshnessWindowMin, confidence: r.confidenceBp / 10_000, checks: parseJson(r.checks, {}), createdAt: r.createdAt,
      })),
    },
    valueCounts: countBy(values, 'status'),
    values: values.sort((a, b) => a.row - b.row || a.id - b.id)
      .map(({ id: vid, row, entity, metric, value, excerpt, sourceUrl, status, freshValue }) =>
        ({ id: vid, row, entity, metric, value, excerpt, sourceUrl, status, ...(freshValue ? { freshValue } : {}) })),
    evidence: {
      attempts: ev.length,
      byUrl: Object.values(ev.reduce((m, e) => {
        const s = (m[e.url] ??= { url: e.url, attempts: 0, ok: false, steps: [] });
        s.attempts++;
        if (!e.reason) s.ok = true;
        s.steps.push({ method: e.method, country: e.country, httpStatus: e.httpStatus, ms: e.ms, reason: e.reason || 'ok' });
        return m;
      }, {})),
    },
  };
}

// Retired APIs are hidden: the COO cannot accept them.
async function catalog() {
  const [apis, versions, retired, costs] = await Promise.all([
    sql('SELECT * FROM api'), sql('SELECT * FROM api_version'), sql('SELECT * FROM api_retired'), sql('SELECT * FROM api_cost'),
  ]);
  const retiredIds = new Set(retired.map((r) => r.apiId));
  return apis.filter((a) => !retiredIds.has(a.id)).map((a) => {
    const v = versions.find((x) => x.id === a.currentVersionId);
    const cost = costs.find((c) => c.apiId === a.id);
    return {
      name: a.name, description: a.description, tier: a.tier, volatility: a.volatility,
      freshnessWindowMin: a.freshnessWindowMin, pageCap: a.pageCap,
      params: parseJson(a.inputs, {}), sources: parseJson(a.sources, a.sources), fields: v ? parseJson(v.fields, []) : [],
      currentVersion: v ? { version: v.version, engine: v.engine, runnable: Boolean(v.apifyId) } : null,
      verifiedRate: a.verifiedRateBp / 10_000, buyers: a.buyerCount, costPerCallCents: a.costPerCallCents,
      costPerCallMicroUsd: cost ? cost.costPerCallMicros : null,
    };
  });
}

async function challenge(challengeId) {
  const [c] = await sql(`SELECT * FROM challenge WHERE id = ${challengeId}`);
  if (!c) throw new CliError(`no challenge ${challengeId}`);
  const [[o], [v], [check], values, refunds] = await Promise.all([
    sql(`SELECT * FROM orders WHERE id = ${c.orderId}`),
    sql(`SELECT * FROM value_record WHERE id = ${c.valueRecordId}`),
    sql(`SELECT * FROM challenge_check WHERE challenge_id = ${challengeId}`),
    sql(`SELECT * FROM value_record WHERE order_id = ${c.orderId}`),
    sql(`SELECT * FROM refund WHERE order_id = ${c.orderId}`),
  ]);
  const [api] = o?.apiId == null ? [] : await sql(`SELECT * FROM api WHERE id = ${o.apiId}`);
  const next = values.find((x) => x.supersedesId === c.valueRecordId);
  const side = (p) => check && ({
    result: check[`${p}Result`], value: check[`${p}Value`], quote: check[`${p}Quote`],
    context: check[`${p}Context`], reason: check[`${p}Reason`] || null, ms: check[`${p}Ms`],
  });
  return {
    challenge: {
      id: c.id, status: c.status, reason: c.reason, verdict: c.verdict || null, auditorReason: c.auditorReason || null,
      createdAt: c.createdAt, resolvedAt: c.resolvedAt,
    },
    order: o && { id: o.id, status: o.status, requestText: o.requestText, api: api?.name ?? null, volatility: api?.volatility ?? null, tier: api?.tier ?? null, priceCents: o.priceCents },
    value: v && { id: v.id, row: v.row, entity: v.entity, metric: v.metric, value: v.value, excerpt: v.excerpt, sourceUrl: v.sourceUrl, status: v.status, observedAt: v.observedAt },
    recheck: check ? {
      saved: { ...side('saved'), observedAt: check.observedAt },
      fresh: { ...side('fresh'), fetchedAt: check.freshFetchedAt },
      correction: check.correctedValue ? { value: check.correctedValue, excerpt: check.correctedExcerpt } : null,
      totalMs: check.totalMs, checkedAt: check.checkedAt,
    } : null,
    supersededBy: next ? { id: next.id, value: next.value, excerpt: next.excerpt, status: next.status } : null,
    refunds: refunds.filter((r) => r.challengeId === c.id).map(({ id: rid, amountCents, status }) => ({ id: rid, amountCents, status })),
  };
}

const NEXT = {
  coo_triage: {
    role: 'coo',
    steps: [
      'Run `forge order <orderId>` to read the request and its desk gate checks.',
      'Run `forge catalog` to see which APIs already exist.',
      'Decide exactly once with `forge decide <orderId> <DECISION> <apiName|-> <reason>`.',
    ],
  },
  audit: {
    role: 'auditor',
    steps: [
      'Run `forge order <orderId>` and read valueCounts, values and evidence.',
      'Rule exactly once with `forge verdict <orderId> <ACCEPT|REJECT> <reason citing the counts>`.',
    ],
  },
  audit_challenge: {
    role: 'auditor',
    steps: [
      'Run `forge challenge <challengeId>` and read the customer reason, the delivered value, and recheck.saved vs recheck.fresh.',
      'Judge against the SAVED page: UPHELD only if recheck.saved shows the extractor misread it (wrong value, entity or metric for that quote).',
      'Rule exactly once with `forge challenge-verdict <challengeId> <UPHELD|REJECTED> <reason quoting the saved page and the fresh result>`.',
    ],
  },
  research_gate: {
    role: 'research',
    steps: [
      'Run `forge order <orderId>`: read requestText and intent (the sources and fields asked for). Find a public source with `forge search <orderId> <query>` if none is named.',
      'robots: `forge robots <orderId> <source URL>`, then `forge gate-check <orderId> robots <pass|fail> <robotsUrl> "<the deciding line, or User-agent: *>"`.',
      'terms: find the terms page (`forge search <orderId> "<site> terms of use"`), fetch it with `forge research-fetch <orderId> <terms URL> --find scrap --find automated --find robot --find crawl`, and record `forge gate-check <orderId> terms <pass|fail|unclear> <terms URL> "<clause quoted verbatim>"`. No clear clause: unclear.',
      'reachability: `forge research-fetch <orderId> <source URL> --find "<a requested value>"`; record `forge gate-check <orderId> reachability <pass|fail> <source URL> "<a verbatim snippet showing the data, or the login wall>"`.',
      'volatility: wait at least 2 minutes after the first source fetch (sleep 150), fetch the same URL again and read `compare`; record `forge gate-check <orderId> volatility pass <source URL> "<what changed: lines, numbers, suggested>"`.',
      'Finish with `forge report <orderId> \'{"summary":"...","sources":["<url>"],"fields":["<field>"],"volatility":"stable|volatile","freshnessWindowMin":0,"confidence":0.8}\'`.',
    ],
  },
};

// A coo_triage task queued by research_report: the gate findings are in, so the COO decides on them.
const AFTER_RESEARCH = [
  'Run `forge order <orderId>`: read gateChecks (robots, terms, reachability, volatility, each with its citation) and research.reports.',
  'If robots, terms and reachability all pass: `forge create-api \'<spec JSON>\'` over the reported sources and fields, then `forge decide <orderId> ACCEPT <name> "<reason>"`.',
  'If the scope is larger than the page cap: `forge decide <orderId> COUNTEROFFER - "<the smaller scope>"`.',
  'Otherwise `forge decide <orderId> REJECT - "<the failing check, quoting its citation and URL>"`. A terms check that is unclear is a rejection.',
];

function flags(args, names) {
  const out = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : null;
    if (name && names.includes(name)) {
      if (args[i + 1] === undefined) throw new CliError(`--${name} needs a value`);
      (out[name] ??= []).push(args[++i]);
    } else out.rest.push(args[i]);
  }
  return out;
}

const TEXT_DEFAULT = 4_000;
const FIND_CONTEXT = 300;
const FIND_MAX = 8;

// research_fetch returns the whole page text; print a bounded slice plus passages around each --find.
function pageView(res, finds = [], max = TEXT_DEFAULT) {
  const { text = '', ...rest } = res;
  const flat = text.replace(/\s+/g, ' ');
  const low = flat.toLowerCase();
  const found = finds.map((f) => {
    const needle = f.toLowerCase();
    const at = [];
    for (let i = low.indexOf(needle); i >= 0 && at.length < FIND_MAX; i = low.indexOf(needle, i + needle.length)) at.push(i);
    return { find: f, matches: at.length, passages: at.map((i) => flat.slice(Math.max(0, i - FIND_CONTEXT), i + needle.length + FIND_CONTEXT)) };
  });
  return { ...rest, text: flat.slice(0, max), textShown: Math.min(max, flat.length), ...(finds.length ? { found } : {}) };
}

async function procedure(seat, name, args) {
  const body = await call(seat, name, args);
  const v = parseJson(body, null);
  return typeof v === 'string' ? parseJson(v, v) : v;
}

async function researchFetch(kind, orderId, target, view) {
  const res = await procedure('research', 'research_fetch', [orderId, kind, target]);
  if (!res || typeof res !== 'object') throw new CliError(`research_fetch returned ${JSON.stringify(res)}`);
  return view(res);
}

function report(orderId, raw) {
  const f = parseJson(raw, null);
  if (!f || typeof f !== 'object' || Array.isArray(f)) throw new CliError('findings must be a JSON object: {summary, sources, fields, volatility, freshnessWindowMin, confidence}');
  const confidence = Number(f.confidence);
  if (!Number.isFinite(confidence)) throw new CliError('findings.confidence must be a number between 0 and 1');
  return [orderId, String(f.summary ?? ''), JSON.stringify(f.sources ?? []), JSON.stringify(f.fields ?? []),
    String(f.volatility ?? ''), Math.max(0, Math.round(Number(f.freshnessWindowMin ?? 0)) || 0), confidence];
}

function task(raw) {
  if (!raw) throw new CliError('no task: pass the task JSON as an argument or set FORGE_TASK');
  const t = parseJson(raw, null);
  if (!t || typeof t !== 'object') throw new CliError('task is not valid JSON');
  const next = NEXT[t.kind];
  if (!next) throw new CliError(`unknown task kind ${JSON.stringify(t.kind)}`);
  const orderId = String(t.orderId ?? t.input?.orderId ?? '');
  const challengeId = String(t.input?.challengeId ?? '');
  const fill = (s) => [['<orderId>', orderId], ['<challengeId>', challengeId]].reduce((acc, [k, v]) => (v ? acc.replaceAll(k, v) : acc), s);
  const steps = t.kind === 'coo_triage' && t.input?.researchReportId ? AFTER_RESEARCH : next.steps;
  return {
    kind: t.kind, taskId: t.taskId ?? null, orderId: orderId || null, ...(challengeId ? { challengeId } : {}), role: next.role, input: t.input ?? {},
    next: steps.map(fill),
    rule: t.kind === 'research_gate'
      ? 'Act only through forge commands. Research never accepts or rejects an order; a run that ends without forge report fails the task.'
      : 'Act only through forge commands. A run that ends without a decide/verdict/challenge-verdict call fails the task.',
  };
}

async function main(argv) {
  const [cmd, ...a] = argv;
  switch (cmd) {
    case 'task': return task(a.join(' ') || process.env.FORGE_TASK);
    case 'order': return order(id(a[0], 'orderId'));
    case 'catalog': return catalog();
    case 'decide': {
      const [oid, decision, apiName, ...reason] = a;
      if (!decision || apiName === undefined) throw new CliError('usage: forge decide <orderId> <decision> <apiName|-> <reason...>');
      const orderId = id(oid, 'orderId');
      await call('coo', 'coo_decide', [orderId, decision, apiName === '-' ? '' : apiName, reason.join(' ')]);
      return { ok: true, orderId, decision, apiName: apiName === '-' ? '' : apiName, order: (await order(orderId)).order };
    }
    case 'verdict': {
      const [oid, verdict, ...reason] = a;
      if (!verdict) throw new CliError('usage: forge verdict <orderId> <ACCEPT|REJECT> <reason...>');
      const orderId = id(oid, 'orderId');
      await call('auditor', 'audit_verdict', [orderId, verdict, reason.join(' ')]);
      return { ok: true, orderId, verdict, order: (await order(orderId)).order };
    }
    case 'challenge': return challenge(id(a[0], 'challengeId'));
    case 'challenge-verdict': {
      const [cid, verdict, ...reason] = a;
      if (!verdict) throw new CliError('usage: forge challenge-verdict <challengeId> <UPHELD|REJECTED> <reason...>');
      const challengeId = id(cid, 'challengeId');
      await call('auditor', 'challenge_verdict', [challengeId, verdict, reason.join(' ')]);
      return { ok: true, challengeId, verdict, ...(await challenge(challengeId)) };
    }
    case 'create-api': {
      const spec = parseJson(a.join(' '), null);
      if (!spec || typeof spec !== 'object') throw new CliError("usage: forge create-api '<spec JSON>' with name, description, sources, outputSchema, volatility, freshnessWindowMin, pageCap, instructions");
      await call('coo', 'create_api', [JSON.stringify(spec), '', 'task']);
      const [api] = (await catalog()).filter((x) => x.name === spec.name);
      return { ok: true, api, note: 'The Apify Task is created in the background; an order accepted on this API starts once it exists.' };
    }
    case 'robots': {
      const [oid, url] = a;
      if (!url) throw new CliError('usage: forge robots <orderId> <url>');
      return researchFetch('robots', id(oid, 'orderId'), url, (r) => {
        const { text = '', ...rest } = r;
        return { ...rest, robotsTxt: text.slice(0, 8_000) };
      });
    }
    case 'research-fetch': {
      const { rest, find = [], max = [] } = flags(a, ['find', 'max']);
      const [oid, url] = rest;
      if (!url) throw new CliError('usage: forge research-fetch <orderId> <url> [--find <text>]... [--max <chars>]');
      const limit = max.length ? Number(max.at(-1)) : TEXT_DEFAULT;
      if (!Number.isInteger(limit) || limit < 0) throw new CliError('--max must be a whole number of characters');
      return researchFetch('page', id(oid, 'orderId'), url, (r) => pageView(r, find, limit));
    }
    case 'search': {
      const [oid, ...q] = a;
      if (!q.length) throw new CliError('usage: forge search <orderId> <query...>');
      return researchFetch('search', id(oid, 'orderId'), q.join(' '), (r) => {
        const { text, ...rest } = r;
        return { ...rest, results: r.results ?? [] };
      });
    }
    case 'gate-check': {
      const [oid, check, result, citationUrl, ...quote] = a;
      if (!citationUrl || !quote.length) throw new CliError('usage: forge gate-check <orderId> <robots|terms|reachability|volatility> <pass|fail|unclear> <citationUrl> <citationText...>');
      const orderId = id(oid, 'orderId');
      await call('research', 'record_gate_check', [orderId, check, result, citationUrl, quote.join(' ')]);
      return { ok: true, orderId, check, result, gateChecks: (await order(orderId)).gateChecks };
    }
    case 'report': {
      const [oid, ...json] = a;
      if (!json.length) throw new CliError("usage: forge report <orderId> '<findings JSON>'");
      const orderId = id(oid, 'orderId');
      await call('research', 'research_report', report(orderId, json.join(' ')));
      const o = await order(orderId);
      return { ok: true, orderId, order: o.order, report: o.research.reports.at(-1) };
    }
    case undefined: case 'help': case '--help': case '-h':
      return { usage: USAGE };
    default:
      throw new CliError(`unknown command ${cmd}\n${USAGE}`);
  }
}

main(process.argv.slice(2)).then(
  (out) => { process.stdout.write(`${JSON.stringify(out, null, 2)}\n`); },
  (err) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: err instanceof CliError ? err.message : String(err) }, null, 2)}\n`);
    process.exitCode = 1;
  },
);
