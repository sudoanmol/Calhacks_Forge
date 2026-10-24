export const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

// A value is a fact only if its excerpt appears verbatim in the saved page text
// and the value appears verbatim in the excerpt (AGENTS.md §3 Addition 1).
export const anchored = (pageText, excerpt, value) => {
  if (excerpt == null || value == null) return false;
  const e = norm(excerpt);
  const v = norm(value);
  if (!e || !v) return false;
  return norm(pageText).includes(e) && e.includes(v);
};

export const anchorStatus = (pageText, excerpt, value) =>
  anchored(pageText, excerpt, value) ? 'extracted' : 'unverifiable';
