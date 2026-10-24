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
import { htmlToText, norm } from './lib/index.js';

const MAX_EXCERPT = 299;

const clean = (fragment) => htmlToText(fragment).replace(/\s+/g, ' ').trim();

// Inner HTML of the first element whose class list contains `cls` (no same-tag nesting assumed).
const inner = (html, tag, cls) => {
  const re = new RegExp(`<${tag}\\b[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
};

// Newegg search results: each listing is a .goods-container; the cell ends at its .item-stock div.
const listingCells = (html) => {
  const parts = html.split(/<div\b[^>]*class="goods-container"[^>]*>/i).slice(1);
  return parts.map((p) => {
    const end = p.search(/<div\b[^>]*class="item-stock"[^>]*>[\s\S]*?<\/div>/i);
    if (end < 0) return p;
    const stockEnd = p.slice(end).search(/<\/div>/i) + end + '</div>'.length;
    return p.slice(0, stockEnd);
  });
};

const parseCell = (cell) => {
  const titleHtml = inner(cell, 'a', 'goods-title');
  if (titleHtml == null) return null;
  let name = clean(titleHtml);
  if (!name) return null;
  // A bundled-gift promo ("Free <item> ...") right under the title is part of what the listing
  // offers, so it stays with the name; deal notices ("Limited time offer", "Get ... w/ purchase") do not.
  const promoHtml = inner(cell, 'p', 'goods-promo');
  const promo = promoHtml == null ? '' : clean(promoHtml);
  if (/^Free\s/.test(promo)) name = `${name} ${promo}`;

  let price = null;
  let priceBlock = null;
  const current = inner(cell, 'div', 'goods-price-current');
  if (current != null) {
    const symbol = inner(current, 'span', 'goods-price-symbol');
    const amount = inner(current, 'span', 'goods-price-value');
    if (amount != null) {
      const p = clean(`${symbol ?? ''} ${amount}`);
      if (/\d/.test(p)) {
        price = p;
        priceBlock = clean(current);
      }
    }
  }
  if (!price) {
    const note = inner(cell, 'div', 'goods-price-note');
    if (note != null) {
      const noteText = clean(note);
      const m = noteText.match(/\$\s?[\d,]+(?:\s?\.\d+)?/);
      if (m) {
        price = m[0];
        priceBlock = noteText;
      }
    }
  }

  let stock = null;
  for (const cls of ['goods-price-soldout', 'goods-price-comingsoon']) {
    const s = inner(cell, 'div', cls);
    if (s != null && clean(s)) {
      stock = clean(s);
      break;
    }
  }
  if (!stock) {
    const s = inner(cell, 'div', 'item-stock');
    if (s != null && clean(s)) stock = clean(s);
  }

  return { name, price, priceBlock, stock };
};

export const extract = (page) => {
  const html = page.html ?? '';
  const pageNorm = norm(page.text ?? '');
  const onPage = (s) => s && s.length <= MAX_EXCERPT && pageNorm.includes(norm(s));
  const pick = (value, candidates) =>
    candidates.find((c) => onPage(c) && norm(c).includes(norm(value))) ?? null;

  const out = [];
  let row = 0;
  for (const cell of listingCells(html)) {
    const l = parseCell(cell);
    if (!l) continue;
    const entity = l.name;
    const tail = l.stock ?? l.priceBlock;
    const items = [];

    const nameEx = pick(l.name, [tail ? `${l.name} ${tail}` : null, l.name]);
    if (nameEx) items.push({ metric: 'name', value: l.name, excerpt: nameEx });

    if (l.price) {
      const priceEx = pick(l.price, [
        `${l.name} ${l.priceBlock}`,
        l.stock ? `${l.stock} ${l.priceBlock}` : null,
        l.priceBlock,
        l.price,
      ]);
      if (priceEx) items.push({ metric: 'price', value: l.price, excerpt: priceEx });
    }

    if (l.stock) {
      const stockEx = pick(l.stock, [`${l.name} ${l.stock}`, l.stock]);
      if (stockEx) items.push({ metric: 'stock', value: l.stock, excerpt: stockEx });
    }

    if (!items.length) continue;
    for (const it of items) out.push({ entity, row, ...it });
    row += 1;
  }
  return out;
};
