// Order params for templated API sources. Pure, so it is unit tested outside the module.
//
// Contract: api.inputs is a JSON object that declares each param, e.g.
//   { "board": { "type": "string", "description": "Greenhouse board token", "default": "discord" } }
// and api.sources may reference a declared param as {name} in the URL path or query, e.g.
//   "https://boards-api.greenhouse.io/v1/boards/{board}/departments".
// orders.params is a JSON object of string values for declared params, e.g. {"board":"stripe"}.
// A param left out uses its default. Templates may not touch the host, and a param value is
// limited to PARAM_VALUE, so a customer can never point an API at another site.

export const PARAM_VALUE = /^[a-z0-9-]{1,60}$/;
const PARAM_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const TEMPLATE = /\{([^{}]*)\}/g;

export type ParamSpec = { type?: string; description?: string; default?: string };

const hostOf = (url: string) => /^https?:\/\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase() ?? '';

const asObject = (json: string, what: string): Record<string, unknown> => {
  let v: unknown;
  try { v = JSON.parse(json || '{}'); } catch { throw new Error(`${what} is not valid JSON`); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} must be a JSON object`);
  return v as Record<string, unknown>;
};

const asSources = (json: string): string[] => {
  let v: unknown;
  try { v = JSON.parse(json); } catch { throw new Error('sources is not valid JSON'); }
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new Error('sources must be a JSON array of strings');
  return v as string[];
};

export const declaredParams = (inputsJson: string): Record<string, ParamSpec> => {
  const out: Record<string, ParamSpec> = {};
  for (const [name, spec] of Object.entries(asObject(inputsJson, 'inputs'))) {
    if (!PARAM_NAME.test(name)) throw new Error(`param name ${JSON.stringify(name)} must match ${PARAM_NAME}`);
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error(`param ${name} must be an object`);
    const s = spec as ParamSpec;
    if (s.type !== undefined && s.type !== 'string') throw new Error(`param ${name}: only type "string" is supported`);
    if (s.default !== undefined && (typeof s.default !== 'string' || !PARAM_VALUE.test(s.default))) {
      throw new Error(`param ${name}: default must match ${PARAM_VALUE}`);
    }
    out[name] = s;
  }
  return out;
};

// Checks an api row's inputs and sources together: every {name} is declared and none is in the host.
export const validateApiInputs = (inputsJson: string, sourcesJson: string): void => {
  const params = declaredParams(inputsJson);
  for (const src of asSources(sourcesJson)) {
    for (const [, name] of src.matchAll(TEMPLATE)) {
      if (!(name in params)) throw new Error(`source ${src} uses undeclared param {${name}}`);
    }
    const host = /^https?:\/\/([^/?#]*)/i.exec(src)?.[1] ?? '';
    if (host.includes('{')) throw new Error(`source ${src} has a param in its host`);
  }
};

// Syntax check used when the Front Desk sets params, before the API is known.
export const parseParams = (paramsJson: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(asObject(paramsJson, 'params'))) {
    if (!PARAM_NAME.test(k)) throw new Error(`param name ${JSON.stringify(k)} must match ${PARAM_NAME}`);
    if (typeof v !== 'string' || !PARAM_VALUE.test(v)) throw new Error(`param ${k} must be a string matching ${PARAM_VALUE}`);
    out[k] = v;
  }
  return out;
};

export type Resolved = { sources: string[]; params: Record<string, string>; templated: boolean };

export const resolveSources = (inputsJson: string, sourcesJson: string, paramsJson: string): Resolved => {
  validateApiInputs(inputsJson, sourcesJson);
  const declared = declaredParams(inputsJson);
  const given = parseParams(paramsJson);
  for (const k of Object.keys(given)) if (!(k in declared)) throw new Error(`unknown param ${k}; this API takes ${Object.keys(declared).join(', ') || 'no params'}`);
  const used: Record<string, string> = {};
  let templated = false;
  const sources = asSources(sourcesJson).map((src) => {
    const out = src.replace(TEMPLATE, (_m, name: string) => {
      templated = true;
      const v = given[name] ?? declared[name]?.default;
      if (v === undefined) throw new Error(`param ${name} is required (no default)`);
      used[name] = v;
      return v;
    });
    if (hostOf(out) !== hostOf(src)) throw new Error(`param substitution changed the host of ${src}`);
    return out;
  });
  return { sources, params: used, templated };
};
