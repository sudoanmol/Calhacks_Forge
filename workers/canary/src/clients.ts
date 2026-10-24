// Dependency-free clients for the SpacetimeDB HTTP API and the Apify REST API.
import { execFileSync } from 'node:child_process';

export const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (expected in the repo .env)`);
  return v;
};

export const founderToken = (): string => {
  if (process.env.FOUNDER_TOKEN) return process.env.FOUNDER_TOKEN;
  const out = execFileSync(`${process.env.HOME}/.local/bin/spacetime`, ['login', 'show', '--token']).toString();
  const m = out.match(/is ([\w-]+\.[\w-]+\.[\w-]+)/);
  if (!m?.[1]) throw new Error('could not read the founder token from `spacetime login show --token`');
  return m[1];
};

type AlgebraicType = Record<string, unknown>;
type SqlResult = { schema: { elements: { name: { some: string }; algebraic_type: AlgebraicType }[] }; rows: unknown[][] };
export type Row = Record<string, unknown>;

// SATS-JSON: an option is [0, value] (some) or [1, []] (none); a timestamp is [micros].
const decode = (type: AlgebraicType, v: unknown): unknown => {
  const sum = type.Sum as { variants: { name: { some: string }; algebraic_type: AlgebraicType }[] } | undefined;
  if (sum && Array.isArray(v)) {
    const names = sum.variants.map((x) => x.name.some);
    if (names.length === 2 && names.includes('some') && names.includes('none')) {
      const variant = sum.variants[v[0] as number];
      return variant?.name.some === 'some' ? decode(variant.algebraic_type, v[1]) : undefined;
    }
    return v;
  }
  const product = type.Product as { elements: { name: { some: string } }[] } | undefined;
  if (product && Array.isArray(v) && product.elements.length === 1
    && product.elements[0]?.name.some === '__timestamp_micros_since_unix_epoch__') {
    return v[0] as number;
  }
  return v;
};

export class Stdb {
  readonly host = requireEnv('SPACETIME_HOST');
  readonly db = requireEnv('SPACETIME_DB');

  async call(token: string, reducer: string, args: unknown[]): Promise<void> {
    const r = await fetch(`${this.host}/v1/database/${this.db}/call/${reducer}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`${reducer}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  }

  async sql(token: string, query: string): Promise<Row[]> {
    const r = await fetch(`${this.host}/v1/database/${this.db}/sql`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: query,
    });
    if (!r.ok) throw new Error(`sql ${r.status}: ${(await r.text()).slice(0, 300)} (query: ${query})`);
    const [res] = (await r.json()) as SqlResult[];
    if (!res) throw new Error(`sql returned no result set (query: ${query})`);
    const cols = res.schema.elements;
    return res.rows.map((row) => Object.fromEntries(row.map((v, i) => {
      const col = cols[i]!;
      return [col.name.some, decode(col.algebraic_type, v)];
    })));
  }
}

export const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

export class Apify {
  readonly token = requireEnv('APIFY_TOKEN');
  readonly username = requireEnv('APIFY_USERNAME');

  async req<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`https://api.apify.com/v2${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${body.slice(0, 300)}`);
    return (body ? JSON.parse(body) : null) as T;
  }

  async record<T = unknown>(storeId: string, key: string): Promise<T | null> {
    const r = await fetch(`https://api.apify.com/v2/key-value-stores/${storeId}/records/${key}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    return r.ok ? ((await r.json()) as T) : null;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
