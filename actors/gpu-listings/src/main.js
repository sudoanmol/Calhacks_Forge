import { readFileSync } from 'node:fs';
import { Actor, log } from 'apify';
import { fetchWithLadder } from './lib/index.js';
import { makeFetchers } from './fetchers.js';
import { processPage, summarize, fieldsOf } from './run.js';
import { extract } from './extract.js';

const api = JSON.parse(readFileSync(new URL('../api.json', import.meta.url), 'utf8'));

await Actor.init();

// The module sends only { sources, pageCap } to an Actor engine; everything else is the API's own spec.
const input = (await Actor.getInput()) ?? {};
const sources = input.sources?.length ? input.sources : api.sources;
const pageCap = input.pageCap ?? api.pageCap ?? 1;
const markers = api.markers ?? [];
if (!sources?.length) throw new Error('no sources: input.sources and api.json sources are both empty');

const env = process.env;
const { unlocker, browser } = makeFetchers({
  apiKey: env.BRIGHTDATA_API_KEY,
  zone: env.BRIGHTDATA_UNLOCKER_ZONE,
  browserWss: api.render === 'browser' || env.BRIGHTDATA_BROWSER_WSS ? env.BRIGHTDATA_BROWSER_WSS : undefined,
});
const fields = fieldsOf(api);

const all = [];
const pages = [];

for (const url of sources.slice(0, pageCap)) {
  const observedAt = new Date().toISOString();
  const page = await fetchWithLadder(url, { unlocker, browser, markers });
  if (page.status !== 'ok') {
    log.warning(`unverifiable page ${url}: ${page.reason}`);
    pages.push({ url, status: 'unverifiable', reason: page.reason, attempts: page.attempts });
    await Actor.pushData({ sourceUrl: url, observedAt, status: 'unverifiable', reason: page.reason, attempts: page.attempts });
    continue;
  }

  const r = await processPage({ url, page, extract, fields, observedAt });
  const snapshotKey = `page-${r.snapshotHash.slice(0, 32)}`;
  await Actor.setValue(snapshotKey, page.text, { contentType: 'text/plain; charset=utf-8' });
  await Actor.setValue(`${snapshotKey}-html`, page.html, { contentType: 'text/html; charset=utf-8' });

  pages.push({ url, status: 'ok', snapshotKey, method: page.method, country: page.country, attempts: page.attempts, error: r.error, ...summarize(r.items) });
  const items = r.items.map((i) => ({ ...i, snapshotKey, attempts: page.attempts }));
  all.push(...items);
  if (items.length) await Actor.pushData(items);
}

// Same RUN_SUMMARY shape as forge-extract so ingest books costs unchanged; a Tier 1 run spends no LLM tokens.
await Actor.setValue('RUN_SUMMARY', {
  engine: 'tier1', api: api.name, llm: null, usage: { inputTokens: 0, outputTokens: 0, pages: pages.filter((p) => p.status === 'ok').length },
  pages, ...summarize(all),
});
log.info(`done: ${JSON.stringify(summarize(all))}`);
await Actor.exit();
