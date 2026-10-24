// Plumbing test with a stub extractor: item shape, row grouping, field filter and the anchor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processPage, summarize } from '../src/run.js';
import { htmlToText } from '../src/lib/index.js';

const html = '<ul><li>RTX 5080 Alpha <b>$999.99</b> In stock</li><li>RTX 5080 Beta <b>$1,099.00</b> SOLD OUT</li></ul>';
const page = { text: htmlToText(html), html, method: 'unlocker', country: 'us' };
const fields = new Set(['name', 'price', 'stock']);
const run = (extract) => processPage({ url: 'https://shop.test', page, extract, fields, observedAt: 't' });

test('items carry the Tier 0 dataset shape and anchor status', async () => {
  const r = await run(() => [
    { entity: 'RTX 5080 Alpha', metric: 'name', value: 'RTX 5080 Alpha', excerpt: 'RTX 5080 Alpha $999.99' },
    { entity: 'RTX 5080 Alpha', metric: 'price', value: '$999.99', excerpt: 'RTX 5080 Alpha $999.99' },
    { entity: 'RTX 5080 Beta', metric: 'price', value: '$1,199.00', excerpt: 'RTX 5080 Beta $1,099.00' },
    { entity: 'RTX 5080 Beta', metric: 'seller_email', value: 'x', excerpt: 'x' },
  ]);
  assert.equal(r.error, null);
  assert.deepEqual(r.items.map((i) => [i.row, i.metric, i.status]), [[0, 'name', 'extracted'], [0, 'price', 'extracted'], [1, 'price', 'unverifiable']]);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['country', 'entity', 'excerpt', 'method', 'metric', 'observedAt', 'row', 'snapshotHash', 'sourceUrl', 'status', 'value']);
  assert.match(r.snapshotHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(summarize(r.items), { total: 3, rows: 2, extracted: 2, unverifiable: 1, anchorRate: 2 / 3 });
});

test('an explicit row index wins over entity grouping', async () => {
  const r = await run(() => [
    { entity: 'same', row: 3, metric: 'price', value: '$999.99', excerpt: '$999.99' },
    { entity: 'same', row: 4, metric: 'price', value: '$1,099.00', excerpt: '$1,099.00' },
  ]);
  assert.deepEqual(r.items.map((i) => i.row), [3, 4]);
});

test('a throwing or malformed extractor yields no items and an error', async () => {
  assert.match((await run(() => { throw new Error('boom'); })).error, /extract failed: boom/);
  assert.match((await run(() => 'nope')).error, /not an array/);
});
