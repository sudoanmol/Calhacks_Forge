import { anchorStatus, sha256 } from './lib/index.js';

// Plumbing shared by the Actor and the test harness: runs extract() on one page and turns its
// output into dataset items with the same shape forge-extract (Tier 0) pushes.
export const processPage = async ({ url, page, extract, fields, observedAt }) => {
  const snapshotHash = sha256(page.text);
  let raw;
  try {
    raw = await extract({ url, text: page.text, html: page.html ?? '' });
    if (!Array.isArray(raw)) throw new Error(`extract returned a ${typeof raw}, not an array`);
  } catch (err) {
    return { items: [], snapshotHash, error: `extract failed: ${err?.message ?? err}` };
  }

  const rowOfEntity = new Map();
  const items = [];
  for (const v of raw) {
    if (!v || (fields.size && !fields.has(v.metric))) continue;
    const entity = String(v.entity ?? '');
    let row = v.row;
    if (!Number.isInteger(row)) {
      if (!rowOfEntity.has(entity)) rowOfEntity.set(entity, rowOfEntity.size);
      row = rowOfEntity.get(entity);
    }
    items.push({
      row,
      entity,
      metric: String(v.metric),
      value: v.value == null ? null : String(v.value),
      excerpt: v.excerpt == null ? null : String(v.excerpt),
      sourceUrl: url,
      snapshotHash,
      observedAt,
      method: page.method,
      country: page.country,
      status: anchorStatus(page.text, v.excerpt, v.value),
    });
  }
  return { items, snapshotHash, error: null };
};

export const summarize = (items) => {
  const total = items.length;
  const extracted = items.filter((i) => i.status === 'extracted').length;
  const rows = new Set(items.map((i) => i.row)).size;
  return { total, rows, extracted, unverifiable: total - extracted, anchorRate: total ? extracted / total : 0 };
};

export const fieldsOf = (api) => new Set(Object.keys(api?.outputSchema?.properties ?? {}));
