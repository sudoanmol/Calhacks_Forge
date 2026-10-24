import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../../..');

// The repo .env is read into an object only. It is never loaded into process.env, so neither
// the droid CLI nor Droid's commands inherit it; each child gets just the keys it needs.
export function readSecrets(repo = REPO): Record<string, string> {
  return Object.fromEntries(
    readFileSync(join(repo, '.env'), 'utf8').split('\n')
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1]!, m[2]!.replace(/^(['"])(.*)\1$/, '$2')]),
  );
}

export const pick = (secrets: Record<string, string>, ...keys: string[]) =>
  Object.fromEntries(keys.filter((k) => secrets[k]).map((k) => [k, secrets[k]!]));

const SECRETISH = /KEY|TOKEN|SECRET|SEED|PASS|WSS|AUTH|COOKIE|CREDENTIAL/i;

// The host environment minus anything that looks like a credential.
export const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRETISH.test(k))) as NodeJS.ProcessEnv;
