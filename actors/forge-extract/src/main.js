import { Actor, log } from 'apify';
import { fetchWithLadder } from './lib/index.js';
import { extractFromPage, summarize } from './extract.js';
import { makeFetchers } from './fetchers.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { sources = [], outputSchema, instructions, pageCap = 10, render = 'unlocker', markers = [] } = input;
if (!sources.length || !outputSchema) throw new Error('input needs sources[] and outputSchema');

const env = process.env;
const { unlocker, browser } = makeFetchers({
  apiKey: env.BRIGHTDATA_API_KEY,
  zone: env.BRIGHTDATA_UNLOCKER_ZONE,
  browserWss: render === 'browser' || env.BRIGHTDATA_BROWSER_WSS ? env.BRIGHTDATA_BROWSER_WSS : undefined,
});
const llm = {
  provider: env.EXTRACT_PROVIDER,
  model: env.EXTRACT_MODEL,
  baseUrl: env.EXTRACT_BASE_URL || undefined,
  apiKey: env.EXTRACT_API_KEY,
};

const usage = { inputTokens: 0, outputTokens: 0, pages: 0 };
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

  const r = await extractFromPage({ url, page, outputSchema, instructions, llm, observedAt });
  const snapshotKey = `page-${r.snapshotHash.slice(0, 32)}`;
  await Actor.setValue(snapshotKey, page.text, { contentType: 'text/plain; charset=utf-8' });
  await Actor.setValue(`${snapshotKey}-html`, page.html, { contentType: 'text/html; charset=utf-8' });

  usage.inputTokens += r.usage.inputTokens;
  usage.outputTokens += r.usage.outputTokens;
  usage.pages += 1;
  pages.push({ url, status: 'ok', snapshotKey, method: page.method, country: page.country, attempts: page.attempts, truncated: r.truncated, error: r.error, ...summarize(r.items) });

  const items = r.items.map((i) => ({ ...i, snapshotKey, attempts: page.attempts }));
  all.push(...items);
  if (items.length) await Actor.pushData(items);
}

await Actor.setValue('RUN_SUMMARY', { llm: { provider: llm.provider, model: llm.model }, usage, pages, ...summarize(all) });
log.info(`done: ${JSON.stringify(summarize(all))}`);
await Actor.exit();
