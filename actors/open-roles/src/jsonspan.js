// Tolerant JSON parser that keeps the raw source of every string, so values can be copied
// verbatim (escapes included) from the page text. A truncated document yields whatever was
// complete before the cut instead of throwing.
//
// Nodes:
//   { type: 'obj', entries: [{ key: strNode, val: node, start }] }
//   { type: 'arr', items: [node] }
//   { type: 'str', raw, start, end }   raw = characters between the quotes; start/end span the quotes
//   { type: 'lit', raw }               numbers, true, false, null

const WS = /\s/;

export const parseJsonSpans = (src) => {
  let i = 0;
  const n = src.length;

  const skipWs = () => {
    while (i < n && WS.test(src[i])) i++;
  };

  const parseString = () => {
    const start = i;
    i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') i += 2;
      else if (c === '"') {
        i++;
        return { type: 'str', raw: src.slice(start + 1, i - 1), start, end: i };
      } else i++;
    }
    return null;
  };

  const parseValue = () => {
    skipWs();
    if (i >= n) return null;
    const c = src[i];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    const m = /^[-+0-9.eEa-zA-Z]+/.exec(src.slice(i, i + 64));
    if (!m) {
      i++;
      return null;
    }
    i += m[0].length;
    return { type: 'lit', raw: m[0] };
  };

  const parseObject = () => {
    const node = { type: 'obj', entries: [] };
    i++;
    while (i < n) {
      skipWs();
      if (src[i] === '}') {
        i++;
        return node;
      }
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] !== '"') {
        i++;
        continue;
      }
      const start = i;
      const key = parseString();
      if (!key) return node;
      skipWs();
      if (src[i] !== ':') continue;
      i++;
      const val = parseValue();
      if (val == null) return node;
      node.entries.push({ key, val, start });
    }
    return node;
  };

  const parseArray = () => {
    const node = { type: 'arr', items: [] };
    i++;
    while (i < n) {
      skipWs();
      if (src[i] === ']') {
        i++;
        return node;
      }
      if (src[i] === ',') {
        i++;
        continue;
      }
      const before = i;
      const val = parseValue();
      if (val == null) {
        if (i >= n) return node;
        if (i === before) i++;
        continue;
      }
      node.items.push(val);
    }
    return node;
  };

  skipWs();
  while (i < n && src[i] !== '{' && src[i] !== '[') i++;
  return parseValue();
};

export const field = (obj, name) => {
  if (!obj || obj.type !== 'obj') return undefined;
  return obj.entries.find((e) => e.key.raw === name);
};
