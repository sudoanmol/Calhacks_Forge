// Gate 0 measurement: runs extraction on real public pages with each candidate LLM, then an
// independent Bright Data re-fetch, and writes the measured rates to docs/proof/.
// Usage: pnpm --filter @forge/forge-extract measure [targets.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithLadder, anchored, unlockerRequest } from '../src/lib/index.js';
import { extractFromPage, summarize } from '../src/extract.js';
import { makeFetchers } from '../src/fetchers.js';

const here = dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(readFileSync(process.argv[2] ?? join(here, 'targets.json'), 'utf8'));
const env = process.env;

const need = (k) => { if (!env[k]) throw new Error(`missing ${k} in .env`); return env[k]; };
const { unlocker, browser } = makeFetchers({
  apiKey: need('BRIGHTDATA_API_KEY'), zone: need('BRIGHTDATA_UNLOCKER_ZONE'), browserWss: env.BRIGHTDATA_BROWSER_WSS,
});

const candidates = [
  env.ASI1_API_KEY && { provider: 'asi1', baseUrl: 'https://api.asi1.ai/v1', model: env.ASI1_MODEL ?? 'asi1', apiKey: env.ASI1_API_KEY },
  env.ANTHROPIC_API_KEY && { provider: 'anthropic', model: need('ANTHROPIC_MODEL'), apiKey: env.ANTHROPIC_API_KEY },
].filter(Boolean);
if (!candidates.length) throw new Error('set ASI1_API_KEY and/or ANTHROPIC_API_KEY');

const results = [];
for (const target of targets) {
  const page = await fetchWithLadder(target.url, { unlocker, browser, markers: target.markers ?? [] });
  console.log(`${target.name}: fetch ${page.status} via ${page.method ?? '-'} (${page.attempts.length} attempts)`);
  if (page.status !== 'ok') {
    results.push({ target: target.name, url: target.url, fetch: page, perLLM: [] });
    continue;
  }

  // Independent re-fetch: a fresh Unlocker request, not the page the extractor read.
  const fresh = await fetchWithLadder(target.url, {
    unlocker: (u, c) => unlockerRequest({ url: u, country: c, apiKey: env.BRIGHTDATA_API_KEY, zone: env.BRIGHTDATA_UNLOCKER_ZONE, timeoutMs: 45_000 }),
    browser, markers: target.markers ?? [],
  });

  const perLLM = [];
  for (const llm of candidates) {
    const t0 = Date.now();
    let r;
    try {
      r = await extractFromPage({ url: target.url, page, outputSchema: target.outputSchema, instructions: target.instructions, llm, observedAt: new Date().toISOString() });
    } catch (err) {
      console.log(`  ${llm.provider}/${llm.model}: LLM error ${err.message}`);
      perLLM.push({ provider: llm.provider, model: llm.model, error: err.message, total: 0, extracted: 0, verified: 0, verifiedRate: 0 });
      continue;
    }
    const verified = r.items.filter((i) => i.status === 'extracted' && fresh.status === 'ok' && anchored(fresh.text, i.excerpt, i.value)).length;
    const s = summarize(r.items);
    perLLM.push({ provider: llm.provider, model: llm.model, ms: Date.now() - t0, usage: r.usage, error: r.error, truncated: r.truncated,
      ...s, verified, verifiedRate: s.total ? verified / s.total : 0, sample: r.items.slice(0, 5),
      notVerified: r.items.filter((i) => i.status !== 'extracted' || !(fresh.status === 'ok' && anchored(fresh.text, i.excerpt, i.value))) });
    console.log(`  ${llm.provider}/${llm.model}: ${s.extracted}/${s.total} anchored, ${verified}/${s.total} verified on re-fetch${r.error ? ` (${r.error})` : ''}`);
  }
  results.push({ target: target.name, url: target.url, fetch: { method: page.method, country: page.country, attempts: page.attempts, chars: page.text.length }, refetch: fresh.status, perLLM });
}

const totals = Object.fromEntries(candidates.map((c) => {
  const rows = results.flatMap((r) => r.perLLM.filter((p) => p.provider === c.provider));
  const total = rows.reduce((a, p) => a + p.total, 0);
  const verified = rows.reduce((a, p) => a + p.verified, 0);
  return [`${c.provider}/${c.model}`, { total, verified, verifiedRate: total ? verified / total : 0 }];
}));
console.log('totals', totals);

const out = join(here, '../../../docs/proof');
mkdirSync(out, { recursive: true });
const file = join(out, `gate0-extract-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ measuredAt: new Date().toISOString(), totals, results }, null, 2));
console.log(`wrote ${file}`);
