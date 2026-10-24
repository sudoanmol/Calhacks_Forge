// Contract test: versions are additive only. This version's output schema keeps every field of
// the version it replaces (contract.json), and extract() emits no field outside the schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../src/extract.js';
import { api, contract, loadFixtures } from './harness.js';

const schemaFields = Object.keys(api.outputSchema?.properties ?? {});

test('output schema is a superset of the previous version', { skip: contract ? false : 'no contract.json' }, () => {
  const dropped = contract.fields.filter((f) => !schemaFields.includes(f));
  assert.deepEqual(dropped, [], `fields removed from the output schema: ${dropped.join(', ')}`);
  for (const f of contract.fields) {
    const prev = contract.outputSchema?.properties?.[f]?.type;
    const cur = api.outputSchema.properties[f]?.type;
    if (prev) assert.equal(cur, prev, `field ${f} changed type from ${prev} to ${cur}`);
  }
});

test('extract emits only schema fields', { skip: loadFixtures().length ? false : 'no fixtures/' }, async () => {
  for (const fx of loadFixtures()) {
    const out = await extract({ url: fx.meta.url, text: fx.text, html: fx.html });
    const extra = [...new Set(out.map((v) => v.metric))].filter((m) => !schemaFields.includes(m));
    assert.deepEqual(extra, [], `fields outside the schema: ${extra.join(', ')}`);
  }
});
