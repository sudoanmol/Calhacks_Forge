// Minimal SpacetimeDB HTTP API client for tests and scripts (no dependencies).
import { execFileSync } from 'node:child_process';

export const HOST = process.env.SPACETIME_HOST ?? 'http://127.0.0.1:3000';
export const DB = process.env.SPACETIME_DB ?? 'forge-test';

export const founderToken = () => {
  if (process.env.FOUNDER_TOKEN) return process.env.FOUNDER_TOKEN;
  const out = execFileSync(`${process.env.HOME}/.local/bin/spacetime`, ['login', 'show', '--token']).toString();
  const m = out.match(/is ([\w-]+\.[\w-]+\.[\w-]+)/);
  if (!m) throw new Error('could not read founder token from `spacetime login show --token`');
  return m[1];
};

export const newIdentity = async () => {
  const r = await fetch(`${HOST}/v1/identity`, { method: 'POST' });
  if (!r.ok) throw new Error(`identity: ${r.status}`);
  return r.json(); // { identity, token }
};

export const identityArg = (hex) => ({ __identity__: hex.startsWith('0x') ? hex : `0x${hex}` });

export const call = async (token, name, args = []) => {
  const r = await fetch(`${HOST}/v1/database/${DB}/call/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { status: r.status, ok: r.ok, body: await r.text() };
};

// Decodes SATS-JSON rows into plain objects keyed by column name.
export const sql = async (token, query) => {
  const r = await fetch(`${HOST}/v1/database/${DB}/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: query,
  });
  if (!r.ok) throw new Error(`sql ${r.status}: ${await r.text()}`);
  const [res] = await r.json();
  const names = res.schema.elements.map((e) => e.name.some);
  return res.rows.map((row) => Object.fromEntries(row.map((v, i) => [names[i], v])));
};

export const route = (path, init) => fetch(`${HOST}/v1/database/${DB}/route${path}`, init);
