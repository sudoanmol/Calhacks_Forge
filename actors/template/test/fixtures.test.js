// Fixtures test: on each saved Tier 0 page, extract() reproduces every audited value, and every
// value it produces passes the quote anchor against that saved page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../src/extract.js';
import { processPage, fieldsOf } from '../src/run.js';
import { api, loadFixtures, missingExpected } from './harness.js';

const fixtures = loadFixtures();
const fields = fieldsOf(api);

if (!fixtures.length) test('fixtures', { skip: 'no fixtures/ (run scripts/make-fixtures.mjs <api>)' }, () => {});

for (const fx of fixtures) {
  test(`fixture ${fx.name}: reproduces the audited values, all anchored`, async () => {
    const page = { text: fx.text, html: fx.html, method: 'fixture', country: null };
    const r = await processPage({ url: fx.meta.url, page, extract, fields, observedAt: fx.meta.observedAt ?? new Date(0).toISOString() });
    assert.equal(r.error, null, r.error ?? '');

    const unanchored = r.items.filter((i) => i.status !== 'extracted');
    assert.equal(unanchored.length, 0,
      `${unanchored.length}/${r.items.length} produced values fail the quote anchor, e.g.\n${JSON.stringify(unanchored.slice(0, 5), ['row', 'metric', 'value', 'excerpt'], 1)}`);

    const missing = missingExpected(fx.expected, r.items);
    assert.equal(missing.length, 0,
      `${missing.length}/${fx.expected.length} audited values were not produced, e.g.\n${JSON.stringify(missing.slice(0, 8), null, 1)}`);
  });
}
