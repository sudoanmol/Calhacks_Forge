// Ported from /actors/template/src/lib so verification rebuilds exactly the text the Actor saw.
// Keep the two copies identical in behavior.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });

export const htmlToText = (html: string) =>
  decodeEntities(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td|\/th)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

export const norm = (s: string) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

export const anchored = (pageText: string, excerpt: string, value: string) => {
  const e = norm(excerpt);
  const v = norm(value);
  if (!e || !v) return false;
  return norm(pageText).includes(e) && e.includes(v);
};

// Volatile re-check (AGENTS.md §3 Addition 1): when the saved excerpt is gone from the fresh page,
// find the value that now sits in the same place. Deterministic, no LLM:
//   1. context: the text just before and/or after the old value in the excerpt, located on the fresh page;
//   2. entity: for numeric values, the first value of the same shape within ENTITY_WINDOW chars after the row's entity.
// Returns the fresh value only when every match agrees on one candidate; otherwise null.
const CONTEXT_CHARS = 40;
const MIN_CONTEXT = 4;
const ENTITY_WINDOW = 300;

const collapse = (s: string) => String(s).replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "$1,199.99" -> /\$\d[\d.,]*/ : digits may change, the surrounding symbols may not.
const shapeOf = (value: string) =>
  new RegExp(value.split(/(\d[\d.,]*)/).map((part, i) => (i % 2 ? '\\d[\\d.,]*' : escapeRe(part))).join(''));

const indexesOf = (hay: string, needle: string) => {
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
};

export const reanchor = (pageText: string, excerpt: string, value: string, entity = ''): string | null => {
  const orig = collapse(pageText);
  const low = orig.toLowerCase();
  // Case-preserving output needs index parity between the two strings.
  const pick = (a: number, b: number) => (low.length === orig.length ? orig : low).slice(a, b).trim();
  const e = norm(excerpt);
  const v = norm(value);
  if (!v) return null;
  const maxLen = Math.max(40, v.length * 3);
  const vTokens = v.split(' ').length;
  const numeric = /\d/.test(v);
  const found = new Set<string>();
  const accept = (c: string) => {
    if (c && c.length <= maxLen && (!numeric || /\d/.test(c))) found.add(c);
  };

  const at = e.indexOf(v);
  const before = at >= 0 ? e.slice(0, at).slice(-CONTEXT_CHARS) : '';
  const after = at >= 0 ? e.slice(at + v.length).slice(0, CONTEXT_CHARS) : '';
  const hasBefore = before.trim().length >= MIN_CONTEXT;
  const hasAfter = after.trim().length >= MIN_CONTEXT;
  if (hasBefore && hasAfter) {
    for (const i of indexesOf(low, before)) {
      const s = i + before.length;
      const j = low.indexOf(after, s);
      if (j > s && j - s <= maxLen) accept(pick(s, j));
    }
  } else if (hasBefore) {
    for (const i of indexesOf(low, before)) {
      const s = i + before.length;
      const rest = low.slice(s).trimStart();
      const lead = low.length - s - rest.length;
      const tokens = rest.split(' ').slice(0, vTokens).join(' ');
      accept(pick(s + lead, s + lead + tokens.length));
    }
  } else if (hasAfter) {
    for (const j of indexesOf(low, after)) {
      const head = low.slice(0, j).trimEnd();
      const tokens = head.split(' ').slice(-vTokens).join(' ');
      accept(pick(head.length - tokens.length, head.length));
    }
  }

  const ent = norm(entity);
  if (!found.size && numeric && ent.length >= MIN_CONTEXT) {
    const shape = shapeOf(v);
    for (const i of indexesOf(low, ent)) {
      const s = i + ent.length;
      const m = shape.exec(low.slice(s, s + ENTITY_WINDOW));
      if (m) accept(pick(s + m.index, s + m.index + m[0].length));
    }
  }
  return found.size === 1 ? [...found][0]! : null;
};

// Customer challenge (AGENTS.md §3 Addition 2): the challenged value checked against one page,
// either the saved page the extractor read or a fresh fetch.
//   match:       the excerpt is verbatim on the page and holds the value (or the value sits in the same place)
//   changed:     the excerpt is gone and a different value now sits in its place (found deterministically)
//   missing:     the excerpt is gone and no single replacement value was found
//   unavailable: the page could not be loaded
export type PageCheck = { result: 'match' | 'changed' | 'missing' | 'unavailable'; value: string; quote: string; context: string };

const CONTEXT_CHARS_AROUND = 600;
const QUOTE_CHARS_AROUND = 80;

// A slice of the whitespace-collapsed page around the first occurrence of needle. Being a substring of
// that page, it always passes the quote anchor against it.
const around = (pageText: string, needle: string, chars: number): string => {
  const orig = collapse(pageText);
  const low = orig.toLowerCase();
  const src = low.length === orig.length ? orig : low;
  const n = norm(needle);
  if (!n) return '';
  const i = low.indexOf(n);
  if (i < 0) return '';
  return src.slice(Math.max(0, i - chars), i + n.length + chars).trim();
};

export const checkPage = (
  page: { ok: boolean; text: string },
  rec: { excerpt: string; value: string; entity: string },
): PageCheck => {
  if (!page.ok) return { result: 'unavailable', value: '', quote: '', context: '' };
  const context = around(page.text, rec.excerpt, CONTEXT_CHARS_AROUND) || around(page.text, rec.entity, CONTEXT_CHARS_AROUND);
  if (anchored(page.text, rec.excerpt, rec.value)) return { result: 'match', value: rec.value, quote: rec.excerpt, context };
  const v = reanchor(page.text, rec.excerpt, rec.value, rec.entity);
  if (v === null) return { result: 'missing', value: '', quote: '', context };
  const quote = around(page.text, v, QUOTE_CHARS_AROUND);
  return { result: norm(v) === norm(rec.value) ? 'match' : 'changed', value: v, quote, context: context || around(page.text, v, CONTEXT_CHARS_AROUND) };
};

export type ChallengeCheck = { saved: PageCheck; fresh: PageCheck; correctedValue: string; correctedExcerpt: string };

// A correction is offered only when the saved page itself holds a different value in the excerpt's
// place, quoted verbatim from that page. Otherwise an upheld challenge withdraws the value.
export const compareChallenge = (
  saved: { ok: boolean; text: string },
  fresh: { ok: boolean; text: string },
  rec: { excerpt: string; value: string; entity: string },
): ChallengeCheck => {
  const s = checkPage(saved, rec);
  const f = checkPage(fresh, rec);
  const correctable = s.result === 'changed' && Boolean(s.quote) && anchored(saved.text, s.quote, s.value);
  return { saved: s, fresh: f, correctedValue: correctable ? s.value : '', correctedExcerpt: correctable ? s.quote : '' };
};

export type Verification = { status: 'verified' | 'stale' | 'mismatch' | 'unverifiable'; freshValue: string };

// The per-value rule shared by verify_values and verify_probe.
export const verifyValue = (
  page: { ok: boolean; text: string } | undefined,
  rec: { excerpt: string; value: string; entity: string },
  volatility: string,
): Verification => {
  if (!page?.ok) return { status: 'unverifiable', freshValue: '' };
  if (anchored(page.text, rec.excerpt, rec.value)) return { status: 'verified', freshValue: '' };
  if (volatility !== 'volatile') return { status: 'mismatch', freshValue: '' };
  const fresh = reanchor(page.text, rec.excerpt, rec.value, rec.entity);
  if (fresh === null) return { status: 'mismatch', freshValue: '' };
  if (norm(fresh) === norm(rec.value)) return { status: 'verified', freshValue: '' };
  return { status: 'stale', freshValue: fresh };
};
const BLOCK_MARKERS = [/captcha/i, /access denied/i, /are you a robot/i, /verify you are human/i, /cf-chl-/i];
const MIN_TEXT_CHARS = 500;

export type Rung = { ok: boolean; kind: 'ok' | 'blocked' | 'compliance' | 'error' | 'shell' | 'timeout'; reason: string; text: string };

export const classify = (status: number, body: string, brdError: string): Rung => {
  if (brdError) {
    const compliance = /compliance policy|requires special permission|kyc/i.test(brdError);
    return { ok: false, kind: compliance ? 'compliance' : 'blocked', reason: `bright data ${compliance ? 'compliance block' : 'error'}: ${brdError.slice(0, 160)}`, text: '' };
  }
  if (status === 403 || status === 429) return { ok: false, kind: 'blocked', reason: `http ${status}`, text: '' };
  if (status >= 400 || status === 0) return { ok: false, kind: 'error', reason: `http ${status}`, text: '' };
  const text = htmlToText(body);
  if (text.length < MIN_TEXT_CHARS && BLOCK_MARKERS.some((re) => re.test(body))) return { ok: false, kind: 'blocked', reason: 'block page', text: '' };
  if (text.length < MIN_TEXT_CHARS) return { ok: false, kind: 'shell', reason: `text too short (${text.length} chars)`, text: '' };
  return { ok: true, kind: 'ok', reason: '', text };
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// The module runtime has no btoa/Buffer; Apify takes webhooks as base64 JSON in the query string.
export const base64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
};
