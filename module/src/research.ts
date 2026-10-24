// Pure helpers for the Research seat's layer-3 gate (AGENTS.md §3): robots.txt rules and the
// two-fetch volatility measurement. No imports, so the unit tests load it directly.

export type RobotsVerdict = {
  allowed: boolean;
  rule: string | null; // the deciding line, e.g. "Disallow: /companies?*", or null when no rule matches
  group: string; // the user-agent group that applied
  path: string;
};

type Rule = { allow: boolean; pattern: string; line: string };

const patternRe = (pattern: string) => {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
};

// RFC 9309: the most specific (longest) matching rule wins; on a tie, allow wins. Groups that name
// the agent apply instead of "*"; FORGE fetches through Bright Data without a crawler token, so the
// agent is "*" unless a caller passes another.
export const robotsVerdict = (robotsText: string, url: string, agent = '*'): RobotsVerdict => {
  const path = splitUrl(url)?.path ?? '/';
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of String(robotsText).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur || (key !== 'allow' && key !== 'disallow')) continue;
    // An empty Disallow allows everything; it is not a rule.
    if (!value) continue;
    cur.rules.push({ allow: key === 'allow', pattern: value, line: `${key === 'allow' ? 'Allow' : 'Disallow'}: ${value}` });
  }
  const want = agent.toLowerCase();
  let picked = groups.filter((g) => want !== '*' && g.agents.includes(want));
  let group = want;
  if (!picked.length) { picked = groups.filter((g) => g.agents.includes('*')); group = '*'; }
  let best: Rule | null = null;
  for (const r of picked.flatMap((g) => g.rules)) {
    if (!patternRe(r.pattern).test(path)) continue;
    const len = r.pattern.replace(/\$$/, '').length;
    const bestLen = best ? best.pattern.replace(/\$$/, '').length : -1;
    if (len > bestLen || (len === bestLen && r.allow && !best!.allow)) best = r;
  }
  return { allowed: best ? best.allow : true, rule: best?.line ?? null, group, path };
};

// The module runtime has no URL global, so URLs are split by hand.
export const splitUrl = (url: string): { scheme: string; host: string; path: string } | null => {
  const m = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i.exec(String(url).trim());
  if (!m) return null;
  return { scheme: m[1]!.toLowerCase(), host: m[2]!.toLowerCase(), path: `${m[3] || '/'}${m[4] ?? ''}` };
};

export const hostOf = (url: string) => splitUrl(url)?.host.replace(/^www\./, '') ?? '';

// Some sites answer /robots.txt with an HTML page (a soft 404); that is not a robots file.
export const looksLikeHtml = (body: string) => /^\s*(\uFEFF)?\s*<(!doctype|html|head|body)\b/i.test(body);

export const robotsUrlFor = (url: string): string => {
  const u = splitUrl(url);
  if (!u) throw new Error(`not an http(s) URL: ${url}`);
  return `${u.scheme}://${u.host}/robots.txt`;
};

export type TextComparison = {
  sameText: boolean;
  linesA: number;
  linesB: number;
  changedLines: number;
  changedRatio: number;
  numbersChanged: number;
  samples: { removed: string[]; added: string[] }; // changed number-bearing lines, a few each
  suggested: 'stable' | 'volatile';
};

const lines = (s: string) => String(s).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const NUMBER = /[$€£]?\d[\d,.]*/g;
const SAMPLE = 5;
const SAMPLE_CHARS = 160;

const multiset = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());

// Items of xs not matched one-for-one in ys.
const minus = (xs: string[], ys: string[]) => {
  const left = multiset(ys);
  return xs.filter((x) => { const n = left.get(x) ?? 0; if (n > 0) { left.set(x, n - 1); return false; } return true; });
};

// Two fetches of the same page, compared line by line. A changed number on a changed line (a price,
// a count, a stock level) is what makes a page volatile; layout-only churn is not.
export const compareTexts = (a: string, b: string): TextComparison => {
  const A = lines(a);
  const B = lines(b);
  const removed = minus(A, B);
  const added = minus(B, A);
  const numbers = (ls: string[]) => ls.flatMap((l) => l.match(NUMBER) ?? []);
  const numbersChanged = minus(numbers(removed), numbers(added)).length + minus(numbers(added), numbers(removed)).length;
  const changedLines = removed.length + added.length;
  const withNumber = (ls: string[]) => ls.filter((l) => /\d/.test(l)).slice(0, SAMPLE).map((l) => l.slice(0, SAMPLE_CHARS));
  return {
    sameText: changedLines === 0,
    linesA: A.length,
    linesB: B.length,
    changedLines,
    changedRatio: A.length + B.length ? Number((changedLines / (A.length + B.length)).toFixed(4)) : 0,
    numbersChanged,
    samples: { removed: withNumber(removed), added: withNumber(added) },
    suggested: numbersChanged > 0 ? 'volatile' : 'stable',
  };
};

// FNV-1a 64-bit: the module runtime has no crypto; this only tells two fetches apart.
export const textHash = (s: string): string => {
  let h = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return `fnv1a64:${h.toString(16).padStart(16, '0')}`;
};

export const normText = (s: string) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

// A cited quote must be on the page the Research seat fetched, verbatim up to whitespace and case.
export const quotedOn = (pageText: string, quote: string) => {
  const q = normText(quote);
  return q.length > 0 && normText(pageText).includes(q);
};
