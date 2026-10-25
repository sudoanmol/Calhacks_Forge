// Pure logic behind the Research seat's gate checks: robots.txt rules, the two-fetch comparison and
// quote matching. The live flow is in research.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTexts, hostOf, looksLikeHtml, precheckSources, quotedOn, reachabilityProblem, robotsUrlFor, robotsVerdict, splitUrl, textHash } from '../src/research.ts';

// ycombinator.com/robots.txt as fetched through Bright Data on Oct 24.
const YC = `User-Agent: *
Disallow: /verify/*
Disallow: /library?categories=*&*
Allow: /library?categories=*
Disallow: /library?*
Disallow: /companies?*
Allow: /

User-Agent: facebookexternalhit
Allow: /verify/*
`;

test('robots: longest match wins, allow wins ties, query strings count', () => {
  assert.deepEqual(robotsVerdict(YC, 'https://www.ycombinator.com/companies/airbnb'), { allowed: true, rule: 'Allow: /', group: '*', path: '/companies/airbnb' });
  const q = robotsVerdict(YC, 'https://www.ycombinator.com/companies?batch=W26');
  assert.equal(q.allowed, false);
  assert.equal(q.rule, 'Disallow: /companies?*');
  assert.equal(robotsVerdict(YC, 'https://www.ycombinator.com/library?categories=ai').allowed, true);
  assert.equal(robotsVerdict(YC, 'https://www.ycombinator.com/library?categories=ai&x=1').allowed, false);
  assert.equal(robotsVerdict(YC, 'https://www.ycombinator.com/verify/abc').allowed, false);
  assert.equal(robotsVerdict(YC, 'https://www.ycombinator.com/verify/abc', 'facebookexternalhit').allowed, true);
});

test('robots: $ anchors, empty disallow, no * group, comments', () => {
  const txt = '# comment\nUser-agent: *\nDisallow: /*.pdf$\nDisallow:\n\nUser-agent: other\nDisallow: /';
  assert.equal(robotsVerdict(txt, 'https://x.com/a/b.pdf').allowed, false);
  assert.equal(robotsVerdict(txt, 'https://x.com/a/b.pdf?x=1').allowed, true);
  assert.equal(robotsVerdict(txt, 'https://x.com/').rule, null);
  assert.equal(robotsVerdict('User-agent: googlebot\nDisallow: /', 'https://x.com/a').allowed, true);
  // Consecutive user-agent lines share one group.
  assert.equal(robotsVerdict('User-agent: a\nUser-agent: *\nDisallow: /p', 'https://x.com/p/1').allowed, false);
  // en.wikipedia.org/robots.txt starts with a byte order mark.
  assert.equal(robotsVerdict('\uFEFFUser-agent: *\nDisallow: /w/', 'https://en.wikipedia.org/w/index.php').allowed, false);
  // example.com answers /robots.txt with its HTML page.
  assert.ok(looksLikeHtml('<!doctype html><html><head>'));
  assert.ok(!looksLikeHtml('User-agent: *\nDisallow: /'));
});

test('url helpers work without the URL global', () => {
  assert.equal(robotsUrlFor('https://www.newegg.com/p/pl?d=rtx-5080'), 'https://www.newegg.com/robots.txt');
  assert.throws(() => robotsUrlFor('ftp://x.com/a'), /http\(s\)/);
  assert.deepEqual(splitUrl('HTTP://Example.com'), { scheme: 'http', host: 'example.com', path: '/' });
  assert.equal(splitUrl('not a url'), null);
  assert.equal(hostOf('https://www.ycombinator.com/companies/{company}'), 'ycombinator.com');
});

test('admission extracts explicit sources and recognizes access barriers without rejecting navigation links', () => {
  assert.deepEqual(precheckSources('{"sources":["https://example.com/data",12]}', 'Read https://example.com/data and https://example.org/list.'), ['https://example.com/data', 'https://example.org/list']);
  assert.deepEqual(precheckSources('not json', 'public product prices'), []);
  assert.equal(reachabilityProblem('Product listings\nSign in\n$25'), null);
  assert.equal(reachabilityProblem('Sign in to continue'), 'Sign in to continue');
  assert.equal(reachabilityProblem('This article is for subscribers'), 'This article is for subscribers');
});

test('compareTexts: identical pages are stable, a changed price is volatile, layout churn is not', () => {
  const a = 'GPU A\n$1,199.99\nIn stock\nFooter';
  assert.deepEqual([compareTexts(a, a).sameText, compareTexts(a, a).suggested], [true, 'stable']);
  const price = compareTexts(a, 'GPU A\n$1,149.99\nIn stock\nFooter');
  assert.equal(price.suggested, 'volatile');
  assert.equal(price.changedLines, 2);
  assert.equal(price.numbersChanged, 2);
  assert.deepEqual(price.samples, { removed: ['$1,199.99'], added: ['$1,149.99'] });
  const reorder = compareTexts(a, 'Footer\nGPU A\n$1,199.99\nIn stock');
  assert.deepEqual([reorder.sameText, reorder.suggested], [true, 'stable']);
  const words = compareTexts(a, 'GPU A\n$1,199.99\nIn stock\nNew footer text');
  assert.deepEqual([words.changedLines, words.numbersChanged, words.suggested], [2, 0, 'stable']);
});

test('quotedOn ignores whitespace and case but not words; textHash tells texts apart', () => {
  assert.ok(quotedOn('You may not  use any robot,\nspider or scraper.', 'you may not use any ROBOT, spider'));
  assert.ok(!quotedOn('You may not use any robot.', 'You may use any robot.'));
  assert.ok(!quotedOn('abc', '   '));
  assert.match(textHash('a'), /^fnv1a64:[0-9a-f]{16}$/);
  assert.notEqual(textHash('a'), textHash('b'));
  assert.equal(textHash('héllo'), textHash('héllo'));
});


test('only transient research failures retry, never compliance blocks', async () => {
  const { retryableFetch } = await import('../src/research.ts');
  for (const httpStatus of [0, 429, 500, 503]) assert.equal(retryableFetch({ ok: false, httpStatus, reason: 'transport failed' }), true);
  for (const httpStatus of [200, 403, 404]) assert.equal(retryableFetch({ ok: false, httpStatus, reason: 'denied' }), false);
  assert.equal(retryableFetch({ ok: false, httpStatus: 500, reason: 'compliance policy' }), false);
  assert.equal(retryableFetch({ ok: true, httpStatus: 200, reason: '' }), false);
});
