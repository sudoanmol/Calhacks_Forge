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
