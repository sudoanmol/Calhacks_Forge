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
env: FORGE_DB_URL, FORGE_SEAT_TOKEN_<SEAT> (decide uses COO, verdict uses AUDITOR) or FORGE_SEAT_TOKEN`;

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
  return {
    order: {
      id: o.id, ref: o.ref, status: o.status, requestText: o.requestText, intent: parseJson(o.intent, o.intent),
      params: parseJson(o.params, {}), priceCents: o.priceCents, api: apis[0]?.name ?? null, apiVersionId: o.apiVersionId, datasetUrl: o.datasetUrl,
      decisionReason: o.decisionReason, createdAt: o.createdAt, updatedAt: o.updatedAt,
    },
    gateChecks: gates.filter((g) => g.orderId === orderId)
      .map(({ check, result, citationUrl, citationText, at }) => ({ check, result, citationUrl, citationText, at })),
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
  research_gate: {
    role: 'research',
    steps: ['Gate 2: the research commands are not built yet. Run `forge order <orderId>` and report what you would check.'],
  },
};

function task(raw) {
  if (!raw) throw new CliError('no task: pass the task JSON as an argument or set FORGE_TASK');
  const t = parseJson(raw, null);
  if (!t || typeof t !== 'object') throw new CliError('task is not valid JSON');
  const next = NEXT[t.kind];
  if (!next) throw new CliError(`unknown task kind ${JSON.stringify(t.kind)}`);
  const orderId = String(t.orderId ?? t.input?.orderId ?? '');
  return {
    kind: t.kind, taskId: t.taskId ?? null, orderId: orderId || null, role: next.role, input: t.input ?? {},
    next: next.steps.map((s) => (orderId ? s.replaceAll('<orderId>', orderId) : s)),
    rule: 'Act only through forge commands. A run that ends without a decide/verdict call fails the task.',
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
