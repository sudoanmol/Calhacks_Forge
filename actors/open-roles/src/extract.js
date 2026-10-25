// Deterministic extractor for this API. This is the only file a compile changes.
//
// extract(page) receives one fetched page:
//   page.url   the source URL
//   page.text  the saved page text (htmlToText of the HTML); every excerpt must be copied from it
//   page.html  the raw HTML (or JSON) body, for finding structure
// and returns one item per value:
//   { entity, metric, value, excerpt, row? }
//   entity   what the row is about (e.g. the product title)
//   metric   a field name from api.json outputSchema.properties
//   value    copied character for character from inside `excerpt`
//   excerpt  a short span (under 300 characters) copied character for character from page.text
//   row      optional integer row index; when left out, rows are grouped by entity
// Leave a field out when the page does not show it. Never compute, guess or reformat a value.
import { parseJsonSpans, field } from './jsonspan.js';

const MAX_EXCERPT = 299;

// Greenhouse /departments body: { departments: [{ name, jobs: [{ title, id, location: { name } }] }] }.
// Values are the raw JSON string contents as they appear in page.text (escapes kept), so every
// value and excerpt is a verbatim slice of the page.
export const extract = (page) => {
  const src = String(page.text ?? '');
  const root = parseJsonSpans(src);
  const depts = field(root, 'departments')?.val;
  if (!depts || depts.type !== 'arr') return [];

  const excerptOf = (entry, str) => {
    const wide = src.slice(entry.start, str.end);
    if (wide.length <= MAX_EXCERPT) return wide;
    const narrow = src.slice(str.start, str.end);
    return narrow.length <= MAX_EXCERPT ? narrow : null;
  };

  const strField = (obj, name) => {
    const e = field(obj, name);
    if (!e || e.val.type !== 'str' || !e.val.raw.trim()) return null;
    const excerpt = excerptOf(e, e.val);
    return excerpt ? { value: e.val.raw, excerpt } : null;
  };

  const out = [];
  let row = 0;
  for (const dept of depts.items) {
    if (dept.type !== 'obj') continue;
    const team = strField(dept, 'name');
    const jobs = field(dept, 'jobs')?.val;
    if (!jobs || jobs.type !== 'arr') continue;
    for (const job of jobs.items) {
      if (job.type !== 'obj') continue;
      const title = strField(job, 'title');
      const idEntry = field(job, 'id');
      const locEntry = field(job, 'location');
      let location = null;
      if (locEntry && locEntry.val.type === 'obj') {
        const nameEntry = field(locEntry.val, 'name');
        if (nameEntry && nameEntry.val.type === 'str' && nameEntry.val.raw.trim()) {
          const excerpt = excerptOf(locEntry, nameEntry.val);
          if (excerpt) location = { value: nameEntry.val.raw, excerpt };
        }
      }
      if (!title && !location) continue;
      const id = idEntry && idEntry.val.type !== 'obj' && idEntry.val.type !== 'arr' ? idEntry.val.raw : null;
      const entity = `${title?.value ?? 'job'}${id ? ` (job ${id})` : ` (row ${row})`}`;
      if (title) out.push({ entity, row, metric: 'title', ...title });
      if (team) out.push({ entity, row, metric: 'team', ...team });
      if (location) out.push({ entity, row, metric: 'location', ...location });
      row++;
    }
  }
  return out;
};
