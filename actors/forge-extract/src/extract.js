import { anchorStatus, sha256 } from './lib/index.js';
import { callLLM, parseJsonObject } from './llm.js';

export const MAX_PAGE_CHARS = 60_000;

const ROWS_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entity: { type: 'string' },
          values: {
            type: 'array',
            items: {
              type: 'object',
              properties: { field: { type: 'string' }, value: { type: 'string' }, excerpt: { type: 'string' } },
              required: ['field', 'value', 'excerpt'],
            },
          },
        },
        required: ['entity', 'values'],
      },
    },
  },
  required: ['rows'],
};

const SYSTEM = `You extract structured data from the text of one public web page.
Rules:
- Return rows as {"rows":[{"entity":"<what this row is about>","values":[{"field":"<schema field>","value":"<value>","excerpt":"<quote>"}]}]}
- "excerpt" is copied character for character from the page text: one short span (under 300 characters) that contains the value.
- "value" is copied character for character from inside the excerpt. Do not reformat, convert units, round or normalize it.
- If a field is not on the page, leave it out. Never guess, infer or fill in a value.
- Only use fields named in the schema.`;

export const buildPrompt = ({ url, outputSchema, pageText, instructions }) =>
  [
    `Source URL: ${url}`,
    `Output schema (JSON Schema for one row):\n${JSON.stringify(outputSchema)}`,
    instructions ? `Request: ${instructions}` : null,
    `Page text:\n"""\n${pageText}\n"""`,
  ].filter(Boolean).join('\n\n');

// Turns one fetched page into one item per extracted value, each with its quote-anchor status.
export const extractFromPage = async ({ url, page, outputSchema, instructions, llm, observedAt }) => {
  const truncated = page.text.length > MAX_PAGE_CHARS;
  const pageText = truncated ? page.text.slice(0, MAX_PAGE_CHARS) : page.text;
  const snapshotHash = sha256(page.text);
  const fields = new Set(Object.keys(outputSchema?.properties ?? {}));

  const { text, json, usage, stopReason } = await callLLM({
    ...llm, system: SYSTEM, jsonSchema: ROWS_SCHEMA, user: buildPrompt({ url, outputSchema, pageText, instructions }),
  });
  let rows;
  try {
    rows = (json ?? parseJsonObject(text)).rows ?? [];
  } catch (err) {
    return { items: [], usage, stopReason, snapshotHash, truncated, error: `unparseable LLM output (stop: ${stopReason}): ${err.message}` };
  }

  const items = [];
  rows.forEach((row, rowIdx) => {
    for (const v of row?.values ?? []) {
      if (fields.size && !fields.has(v?.field)) continue;
      items.push({
        row: rowIdx,
        entity: String(row.entity ?? ''),
        metric: String(v.field),
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
  });
  return { items, usage, stopReason, snapshotHash, truncated, error: stopReason === 'max_tokens' || stopReason === 'length' ? 'LLM output hit the token limit; rows may be missing' : null };
};

export const summarize = (items) => {
  const total = items.length;
  const extracted = items.filter((i) => i.status === 'extracted').length;
  return { total, extracted, unverifiable: total - extracted, anchorRate: total ? extracted / total : 0 };
};
