// Apify builds each Actor from its own directory, so workspace imports don't survive `apify push`.
// actors/template/src/lib is the source of truth; this copies it into every other Actor.
import { cpSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'actors/template/src/lib');
const check = process.argv.includes('--check');
let drift = false;

for (const name of readdirSync(join(root, 'actors'))) {
  if (name === 'template') continue;
  const dest = join(root, 'actors', name, 'src/lib');
  if (!existsSync(join(root, 'actors', name, 'package.json'))) continue;
  if (check) {
    for (const f of readdirSync(src)) {
      const a = join(src, f), b = join(dest, f);
      if (!existsSync(b) || readFileSync(a, 'utf8') !== readFileSync(b, 'utf8')) {
        console.error(`drift: actors/${name}/src/lib/${f}`);
        drift = true;
      }
    }
  } else {
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
    console.log(`synced actors/${name}/src/lib`);
  }
}
if (drift) process.exit(1);
