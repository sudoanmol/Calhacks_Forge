// Bright Data smoke test: fetch each target through the fallback ladder and record every rung.
// Usage: pnpm --filter @forge/forge-extract fetch-smoke [targets.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithLadder, sha256 } from '../src/lib/index.js';
import { makeFetchers } from '../src/fetchers.js';

const here = dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(readFileSync(process.argv[2] ?? join(here, 'targets.json'), 'utf8'));
const { unlocker, browser } = makeFetchers({
  apiKey: process.env.BRIGHTDATA_API_KEY, zone: process.env.BRIGHTDATA_UNLOCKER_ZONE, browserWss: process.env.BRIGHTDATA_BROWSER_WSS,
});

const results = await Promise.all(targets.map(async (t) => {
  const r = await fetchWithLadder(t.url, { unlocker, browser, markers: t.markers ?? [] });
  return {
    name: t.name, url: t.url, status: r.status, method: r.method ?? null, country: r.country ?? null,
    chars: r.text?.length ?? 0, hash: r.text ? sha256(r.text).slice(0, 16) : null, reason: r.reason ?? null,
    attempts: r.attempts, head: r.text?.slice(0, 300) ?? null,
  };
}));

for (const r of results) {
  console.log(`${r.status.padEnd(12)} ${r.name}: ${r.method ?? '-'} ${r.chars} chars; ladder: ${r.attempts.map((a) => `${a.method}/${a.country ?? '-'} ${a.status} ${a.ms}ms${a.ok ? '' : ` (${a.reason})`}`).join(' → ')}`);
}
const out = join(here, '../../../docs/proof');
mkdirSync(out, { recursive: true });
const file = join(out, `gate0-fetch-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2));
console.log(`wrote ${file}`);
