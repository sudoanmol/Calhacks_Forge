// Loads the API spec, contract and fixtures of this Actor directory for the three version tests.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm } from '../src/lib/index.js';

export const actorDir = fileURLToPath(new URL('..', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export const api = readJson(join(actorDir, 'api.json'));
export const contractPath = join(actorDir, 'contract.json');
export const contract = existsSync(contractPath) ? readJson(contractPath) : null;

// fixtures/<name>/{meta.json, page.txt, page.html?, expected.json}
export const loadFixtures = () => {
  const dir = join(actorDir, 'fixtures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const f = join(dir, d.name);
    return {
      name: d.name,
      meta: readJson(join(f, 'meta.json')),
      text: readFileSync(join(f, 'page.txt'), 'utf8'),
      html: existsSync(join(f, 'page.html')) ? readFileSync(join(f, 'page.html'), 'utf8') : '',
      expected: readJson(join(f, 'expected.json')),
    };
  });
};

export const key = (v) => `${v.metric}\u0000${norm(v.value)}`;

// Every expected value must appear among the produced ones (as a multiset on metric + value).
export const missingExpected = (expected, produced) => {
  const have = new Map();
  for (const p of produced) have.set(key(p), (have.get(key(p)) ?? 0) + 1);
  const missing = [];
  for (const e of expected) {
    const n = have.get(key(e)) ?? 0;
    if (n > 0) have.set(key(e), n - 1);
    else missing.push(e);
  }
  return missing;
};

export const rowCount = (values) => new Set(values.map((v) => v.row)).size;
