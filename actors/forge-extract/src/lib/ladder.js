import { htmlToText } from './text.js';

const BLOCK_MARKERS = [/captcha/i, /access denied/i, /are you a robot/i, /verify you are human/i, /cf-chl-/i];
const DEFAULTS = { countries: ['us', 'gb'], timeoutMs: 45_000, minTextChars: 500, markers: [] };

export const classify = ({ status, body }, opts) => {
  if (status === 403 || status === 429) return { ok: false, kind: 'blocked', reason: `http ${status}` };
  if (status >= 400) return { ok: false, kind: 'error', reason: `http ${status}` };
  const raw = body ?? '';
  const text = htmlToText(raw);
  if (text.length < opts.minTextChars && BLOCK_MARKERS.some((re) => re.test(raw))) {
    return { ok: false, kind: 'blocked', reason: 'block page' };
  }
  if (text.length < opts.minTextChars) return { ok: false, kind: 'shell', reason: `text too short (${text.length} chars)` };
  const missing = opts.markers.filter((m) => !text.toLowerCase().includes(m.toLowerCase()));
  if (missing.length) return { ok: false, kind: 'shell', reason: `markers missing: ${missing.join(', ')}` };
  return { ok: true, kind: 'ok', text };
};

export const unlockerRequest = async ({ url, country, apiKey, zone, timeoutMs, fetchImpl = fetch }) => {
  const res = await fetchImpl('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone, url, format: 'raw', country }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, body: await res.text() };
};

const timed = async (fn) => {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { ...r, ms: Date.now() - t0 };
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { status: 0, body: '', ms: Date.now() - t0, thrown: timeout ? 'timeout' : String(err?.message ?? err) };
  }
};

// Fallback ladder (AGENTS.md §7): Unlocker → Browser API on a JS shell → one retry from
// another country on block/timeout → unverifiable. Every rung is returned in `attempts`.
// `unlocker(url, country)` and `browser(url, country)` resolve to { status, body }.
export const fetchWithLadder = async (url, { unlocker, browser, ...rest }) => {
  const opts = { ...DEFAULTS, ...rest };
  const attempts = [];

  const tryRung = async (method, country) => {
    const impl = method === 'unlocker' ? unlocker : browser;
    const r = await timed(() => impl(url, country));
    const c = r.thrown
      ? { ok: false, kind: r.thrown === 'timeout' ? 'timeout' : 'error', reason: r.thrown }
      : classify(r, opts);
    attempts.push({ method, country, status: r.status, ms: r.ms, ok: c.ok, reason: c.ok ? null : c.reason });
    return { ...c, html: r.body, method, country };
  };

  const withCountryRetry = async (method) => {
    const first = await tryRung(method, opts.countries[0]);
    if (first.ok || !['blocked', 'timeout'].includes(first.kind) || opts.countries.length < 2) return first;
    return tryRung(method, opts.countries[1]);
  };

  let res = await withCountryRetry('unlocker');
  if (!res.ok && res.kind === 'shell') {
    if (browser) res = await withCountryRetry('browser');
    else attempts.push({ method: 'browser', country: null, status: 0, ms: 0, ok: false, reason: 'browser rung not configured' });
  }

  if (res.ok) return { status: 'ok', url, text: res.text, html: res.html, method: res.method, country: res.country, attempts };
  return { status: 'unverifiable', url, reason: attempts.at(-1)?.reason ?? res.reason, attempts };
};
