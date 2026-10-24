import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromPage, summarize } from '../src/extract.js';
import { parseJsonObject } from '../src/llm.js';
import { htmlToText } from '../src/lib/index.js';

const html = `<html><body><h2>GeForce RTX 5080</h2><p>Price: $1,199.99</p><p>Availability: In stock</p>
<h2>GeForce RTX 5070</h2><p>Price: $649.00</p><p>Availability: Sold out</p></body></html>`;
const page = { text: htmlToText(html), html, method: 'unlocker', country: 'us' };
const outputSchema = { type: 'object', properties: { name: { type: 'string' }, price: { type: 'string' }, stock: { type: 'string' } } };

const fakeLLM = (reply) => async (url, init) => ({
  ok: true,
  json: async () => ({ content: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }], usage: { input_tokens: 10, output_tokens: 5 } }),
});

const run = (reply) =>
  extractFromPage({
    url: 'https://shop.test/gpus', page, outputSchema, observedAt: '2026-10-24T00:00:00Z',
    llm: { provider: 'anthropic', apiKey: 'k', model: 'm', fetchImpl: fakeLLM(reply) },
  });

test('anchored values are extracted, hallucinated ones unverifiable', async () => {
  const r = await run({ rows: [
    { entity: 'GeForce RTX 5080', values: [
      { field: 'price', value: '$1,199.99', excerpt: 'Price: $1,199.99' },
      { field: 'stock', value: 'In stock', excerpt: 'Availability: In stock' },
    ] },
    { entity: 'GeForce RTX 5070', values: [
      { field: 'price', value: '$599.00', excerpt: 'Price: $599.00' },
      { field: 'stock', value: 'In stock', excerpt: 'Availability: Sold out' },
    ] },
  ] });
  assert.deepEqual(r.items.map((i) => i.status), ['extracted', 'extracted', 'unverifiable', 'unverifiable']);
  assert.equal(r.items[0].row, 0);
  assert.equal(r.items[2].row, 1);
  assert.match(r.snapshotHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(summarize(r.items), { total: 4, extracted: 2, unverifiable: 2, anchorRate: 0.5 });
});

test('fields outside the schema are dropped', async () => {
  const r = await run({ rows: [{ entity: 'x', values: [{ field: 'seller_email', value: 'a@b.c', excerpt: 'a@b.c' }] }] });
  assert.equal(r.items.length, 0);
});

test('unparseable LLM output yields no items and an error', async () => {
  const r = await run('sorry, I cannot');
  assert.equal(r.items.length, 0);
  assert.match(r.error, /unparseable/);
});

test('parseJsonObject strips code fences', () => {
  assert.deepEqual(parseJsonObject('```json\n{"rows":[]}\n```'), { rows: [] });
});
