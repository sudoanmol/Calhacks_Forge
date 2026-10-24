// Live test: fetch the API's live source through Bright Data (same ladder as production), run
// extract(), and check that at least 80% of values pass the quote anchor and that the row count
// is within 50% of the audited fixture. Skipped without Bright Data credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithLadder } from '../src/lib/index.js';
import { makeFetchers } from '../src/fetchers.js';
import { extract } from '../src/extract.js';
import { processPage, summarize, fieldsOf } from '../src/run.js';
import { api, loadFixtures, rowCount } from './harness.js';

const env = process.env;
const skip = !env.BRIGHTDATA_API_KEY || !env.BRIGHTDATA_UNLOCKER_ZONE ? 'BRIGHTDATA_API_KEY / BRIGHTDATA_UNLOCKER_ZONE not set'
  : !api.sources?.length ? 'api.json has no sources' : false;

test('live source: >= 80% anchored, row count within 50% of the fixture', { skip, timeout: 180_000 }, async (t) => {
  const { unlocker, browser } = makeFetchers({
    apiKey: env.BRIGHTDATA_API_KEY, zone: env.BRIGHTDATA_UNLOCKER_ZONE,
    browserWss: api.render === 'browser' || env.BRIGHTDATA_BROWSER_WSS ? env.BRIGHTDATA_BROWSER_WSS : undefined,
  });
  const url = api.sources[0];
  const t0 = Date.now();
  const page = await fetchWithLadder(url, { unlocker, browser, markers: api.markers ?? [] });
  const fetchMs = Date.now() - t0;
  assert.equal(page.status, 'ok', `live page did not load: ${page.reason} ${JSON.stringify(page.attempts)}`);

  const t1 = Date.now();
  const r = await processPage({ url, page, extract, fields: fieldsOf(api), observedAt: new Date().toISOString() });
  const extractMs = Date.now() - t1;
  assert.equal(r.error, null, r.error ?? '');
  const s = summarize(r.items);
  const fixtureRows = loadFixtures().reduce((n, fx) => n + rowCount(fx.expected), 0);
  t.diagnostic(`LIVE ${JSON.stringify({ url, method: page.method, country: page.country, fetchMs, extractMs, ...s, fixtureRows, llmTokens: 0 })}`);

  assert.ok(s.total > 0, 'extract produced no values on the live page');
  assert.ok(s.anchorRate >= 0.8, `only ${s.extracted}/${s.total} live values pass the quote anchor`);
  if (fixtureRows) {
    assert.ok(Math.abs(s.rows - fixtureRows) <= fixtureRows * 0.5, `live rows ${s.rows} vs fixture rows ${fixtureRows}`);
  }
});
