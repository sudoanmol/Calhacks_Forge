// Dependency-free SpacetimeDB HTTP client for the droid_runner seat.
export type Row = Record<string, unknown>;
type AlgebraicType = Record<string, unknown>;
type SqlResult = { schema: { elements: { name: { some: string }; algebraic_type: AlgebraicType }[] }; rows: unknown[][] };

// SATS-JSON: an option is [0, value] (some) or [1, []] (none); a timestamp is [micros]; an identity is [hex].
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
  if (product && Array.isArray(v) && product.elements.length === 1) {
    const name = product.elements[0]?.name.some;
    if (name === '__timestamp_micros_since_unix_epoch__') return v[0] as number;
    if (name === '__identity__') return String(v[0]).replace(/^0x/, '');
  }
  return v;
};

export class ReducerError extends Error {
  readonly status: number;
  constructor(reducer: string, status: number, body: string) {
    super(`${reducer}: HTTP ${status} ${body.slice(0, 500)}`);
    this.status = status;
  }
}

export class Stdb {
  readonly identity: string;
  readonly host: string;
  readonly db: string;
  readonly #token: string;

  constructor(host: string, db: string, token: string) {
    this.host = host;
    this.db = db;
    this.#token = token;
    // The seat token is a JWT whose payload names the identity; claim_task leases to it.
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { hex_identity?: string };
    if (!payload.hex_identity) throw new Error('the seat token carries no hex_identity');
    this.identity = payload.hex_identity.replace(/^0x/, '');
  }

  async call(reducer: string, args: unknown[]): Promise<void> {
    const r = await fetch(`${this.host}/v1/database/${this.db}/call/${reducer}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new ReducerError(reducer, r.status, await r.text());
  }

  async sql(query: string): Promise<Row[]> {
    const r = await fetch(`${this.host}/v1/database/${this.db}/sql`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.#token}` }, body: query,
    });
    if (!r.ok) throw new Error(`sql ${r.status}: ${(await r.text()).slice(0, 300)} (query: ${query})`);
    const [res] = (await r.json()) as SqlResult[];
    if (!res) throw new Error(`sql returned no result set (query: ${query})`);
    const cols = res.schema.elements;
    return res.rows.map((row) => Object.fromEntries(row.map((v, i) => [cols[i]!.name.some, decode(cols[i]!.algebraic_type, v)])));
  }
}

export const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;
