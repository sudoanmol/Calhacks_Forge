// Pure logic behind order params and volatile re-checks (no network). The live checks are in
// params.test.mjs and verify.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSources, validateApiInputs, parseParams } from '../src/params.ts';
import { reanchor, verifyValue } from '../src/text.ts';

const INPUTS = JSON.stringify({ board: { type: 'string', description: 'Greenhouse board token', default: 'discord' } });
const SOURCES = JSON.stringify(['https://boards-api.greenhouse.io/v1/boards/{board}/departments']);

test('params fill templates, defaults apply, plain sources pass through', () => {
  assert.deepEqual(resolveSources(INPUTS, SOURCES, '{"board":"lattice"}').sources, ['https://boards-api.greenhouse.io/v1/boards/lattice/departments']);
  const d = resolveSources(INPUTS, SOURCES, '{}');
  assert.deepEqual(d.sources, ['https://boards-api.greenhouse.io/v1/boards/discord/departments']);
  assert.deepEqual(d.params, { board: 'discord' });
  assert.equal(d.templated, true);
  const plain = resolveSources('{}', '["https://www.ycombinator.com/companies/airbnb"]', '{}');
  assert.equal(plain.templated, false);
});

test('params cannot inject paths, hosts or unknown keys', () => {
  for (const bad of ['{"board":"../../evil"}', '{"board":"evil.com/x"}', '{"board":"Stripe"}', '{"board":""}', '{"board":7}', '[1]', 'nope']) {
    assert.throws(() => resolveSources(INPUTS, SOURCES, bad), undefined, bad);
  }
  assert.throws(() => resolveSources(INPUTS, SOURCES, '{"other":"x"}'), /unknown param other/);
  assert.throws(() => validateApiInputs(JSON.stringify({ host: { default: 'x' } }), '["https://{host}.example.com/a"]'), /host/);
  assert.throws(() => validateApiInputs('{}', SOURCES), /undeclared param \{board\}/);
  assert.throws(() => resolveSources(JSON.stringify({ board: {} }), SOURCES, '{}'), /required/);
  assert.deepEqual(parseParams('{"board":"stripe"}'), { board: 'stripe' });
});

const PAGE = `MSI Ventus 3X GeForce RTX 5080 16GB Sold Price: $1,149.99 Free Shipping
ASUS Prime GeForce RTX 5080 OC Edition OUT OF STOCK $1,299.99 more text`;

test('volatile: a changed price is found through the excerpt context', () => {
  assert.equal(reanchor(PAGE, 'Sold Price: $1,099.99 Free Shipping', '$1,099.99'), '$1,149.99');
  assert.equal(reanchor(PAGE, 'RTX 5080 16GB Sold Price: $1,099.99', '$1,099.99'), '$1,149.99');
});

test('volatile: a bare value is found through the row entity', () => {
  assert.equal(reanchor(PAGE, '$1,199.99', '$1,199.99', 'ASUS Prime GeForce RTX 5080 OC Edition'), '$1,299.99');
  assert.equal(reanchor(PAGE, '$1,199.99', '$1,199.99', 'Gigabyte Windforce'), null);
});

test('verifyValue: verified, stale with fresh value, mismatch, unverifiable', () => {
  const page = { ok: true, text: PAGE };
  assert.deepEqual(verifyValue(page, { excerpt: 'Sold Price: $1,149.99', value: '$1,149.99', entity: '' }, 'volatile'), { status: 'verified', freshValue: '' });
  assert.deepEqual(verifyValue(page, { excerpt: 'Sold Price: $1,099.99 Free', value: '$1,099.99', entity: '' }, 'volatile'), { status: 'stale', freshValue: '$1,149.99' });
  assert.equal(verifyValue(page, { excerpt: 'Sold Price: $1,099.99 Free', value: '$1,099.99', entity: '' }, 'stable').status, 'mismatch');
  assert.equal(verifyValue(page, { excerpt: 'nothing like this', value: 'zzz', entity: '' }, 'volatile').status, 'mismatch');
  assert.equal(verifyValue({ ok: false, text: '' }, { excerpt: 'a', value: 'a', entity: '' }, 'volatile').status, 'unverifiable');
});
