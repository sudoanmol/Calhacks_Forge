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
export const extract = (page) => {
  throw new Error('extract(page) is not implemented');
};
