import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchored, anchorStatus, htmlToText, fetchWithLadder } from '../src/lib/index.js';

const page = htmlToText(`<html><head><style>.x{}</style><script>var price="$9"</script></head>
<body><h1>RTX 5090 Founders</h1><p>Price:&nbsp;<b>$1,999.99</b></p><p>In   stock</p></body></html>`);

test('htmlToText drops scripts and styles and decodes entities', () => {
  assert.ok(!page.includes('var price'));
  assert.ok(page.includes('Price: $1,999.99'));
});

test('anchored value passes', () => {
  assert.equal(anchorStatus(page, 'Price: $1,999.99', '$1,999.99'), 'extracted');
  assert.ok(anchored(page, 'in stock', 'In Stock'));
});

test('hallucinated value fails the anchor', () => {
  assert.equal(anchorStatus(page, 'Price: $1,999.99', '$1,799.99'), 'unverifiable');
});

test('excerpt not on page fails the anchor', () => {
  assert.equal(anchorStatus(page, 'Price: $1,799.99', '$1,799.99'), 'unverifiable');
});

test('empty excerpt or value fails', () => {
  assert.equal(anchorStatus(page, '', ''), 'unverifiable');
  assert.equal(anchorStatus(page, 'Price', null), 'unverifiable');
});

const big = `<html><body>${'<p>real content here</p>'.repeat(60)}<p>Price $5</p></body></html>`;
const shell = '<html><body><div id="root"></div></body></html>';

test('ladder: unlocker succeeds first try', async () => {
  const r = await fetchWithLadder('https://x.test', { unlocker: async () => ({ status: 200, body: big }) });
  assert.equal(r.status, 'ok');
  assert.equal(r.method, 'unlocker');
  assert.equal(r.attempts.length, 1);
});

test('ladder: JS shell moves to browser', async () => {
  const r = await fetchWithLadder('https://x.test', {
    unlocker: async () => ({ status: 200, body: shell }),
    browser: async () => ({ status: 200, body: big }),
  });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.attempts.map((a) => a.method), ['unlocker', 'browser']);
});

test('ladder: blocked retries from another country', async () => {
  const r = await fetchWithLadder('https://x.test', {
    unlocker: async (_u, c) => (c === 'us' ? { status: 403, body: '' } : { status: 200, body: big }),
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.country, 'gb');
  assert.deepEqual(r.attempts.map((a) => [a.method, a.country, a.ok]), [['unlocker', 'us', false], ['unlocker', 'gb', true]]);
});

test('ladder: everything fails → unverifiable with reason', async () => {
  const r = await fetchWithLadder('https://x.test', {
    unlocker: async () => ({ status: 200, body: shell }),
    browser: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; },
  });
  assert.equal(r.status, 'unverifiable');
  assert.equal(r.reason, 'timeout');
  assert.deepEqual(r.attempts.map((a) => [a.method, a.country]), [['unlocker', 'us'], ['browser', 'us'], ['browser', 'gb']]);
});

test('ladder: missing marker counts as a shell', async () => {
  const r = await fetchWithLadder('https://x.test', {
    unlocker: async () => ({ status: 200, body: big }),
    markers: ['add to cart'],
  });
  assert.equal(r.status, 'unverifiable');
  assert.match(r.reason, /browser rung not configured/);
});
