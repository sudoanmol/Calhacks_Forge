// The seeded Tier 0 catalog (AGENTS.md §3, picked at Gate 1). Each entry is both the Apify Task
// input for forge-extract and the spec registered with create_api, so the two cannot drift.

// A param an API declares (module/src/params.ts): sources use it as {name}; orders set it with set_order_params.
export type ParamSpec = { type: 'string'; description: string; default: string };

export type SeededApi = {
  name: string;
  description: string;
  inputs: Record<string, ParamSpec>;
  sources: string[];
  instructions: string;
  outputSchema: { type: 'object'; properties: Record<string, { type: string; description?: string }> };
  volatility: 'stable' | 'volatile';
  freshnessWindowMin?: number;
  pageCap: number;
  render?: 'unlocker' | 'browser';
  markers?: string[];
  // A request a real customer could type; the canary sends it as the order text.
  sampleRequest: string;
};

export const CATALOG: SeededApi[] = [
  {
    name: 'yc-directory',
    description:
      "YC company directory: name, one-liner, website, batch and status from a YC company's public page on ycombinator.com. Param company = the company's slug in ycombinator.com/companies/<slug> (default airbnb).",
    inputs: {
      company: { type: 'string', description: 'YC company slug, the last part of ycombinator.com/companies/<slug>, e.g. airbnb, stripe or doordash', default: 'airbnb' },
    },
    sources: ['https://www.ycombinator.com/companies/{company}'],
    instructions: "The company's name, one-liner, website, batch and status.",
    outputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, one_liner: { type: 'string' }, website: { type: 'string' }, batch: { type: 'string' }, status: { type: 'string' } },
    },
    volatility: 'stable',
    pageCap: 1,
    sampleRequest: 'YC directory entry for Airbnb: name, one-liner, website, batch and status',
  },
  {
    name: 'open-roles',
    description:
      "Open roles at any company with a public Greenhouse job board (boards-api.greenhouse.io): each posting's title, team (the department it is listed under) and location. Param board = the company's Greenhouse board token (default discord). Aggregate counts by team and location are derived from these rows. Job postings only, no personal data. Boards over about 60K characters of text are truncated by the extractor.",
    inputs: {
      board: { type: 'string', description: 'Greenhouse board token, e.g. discord or lattice (the slug in boards.greenhouse.io/<token>)', default: 'discord' },
    },
    // The departments endpoint nests each job under its department, so the team is on the page
    // next to the title. Discord's board (~43K chars) fits the extractor's 60K page budget whole;
    // larger boards such as Stripe (~450K) would be truncated.
    sources: ['https://boards-api.greenhouse.io/v1/boards/{board}/departments'],
    instructions:
      'One row per open job posting listed under a department. title = the job title; team = the "name" of the department the job is listed under; location = the job\'s location name. Skip departments whose jobs list is empty.',
    outputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Job title' },
        team: { type: 'string', description: 'Department the job is listed under' },
        location: { type: 'string', description: 'Job location name' },
      },
    },
    volatility: 'stable',
    pageCap: 1,
    markers: ['departments'],
    sampleRequest: 'Open roles at Discord by team and location',
  },
  {
    name: 'gpu-listings',
    description:
      'Graphics card listings from the public Newegg search results page for a search query: the first 20 listings, with product name, price and stock status per listing. Param query = the search words joined by hyphens (default rtx-5080, e.g. rtx-4090 or radeon-rx-9070). Volatile: prices and stock change often, so values are verified within a 15-minute window.',
    inputs: {
      query: { type: 'string', description: 'Newegg search words, lowercase and joined by hyphens, e.g. rtx-5080, rtx-4090 or radeon-rx-9070', default: 'rtx-5080' },
    },
    // Newegg reads hyphens as spaces: d=rtx-4090 returns the same listings as d=rtx+4090 (measured Oct 24).
    sources: ['https://www.newegg.com/p/pl?d={query}'],
    // Gate 0's one-line instruction let the model stop after ~9 of the ~35 listings on the page.
    // Asking for all of them overran forge-extract's 16000 output tokens on d=rtx-4090 (measured Oct 24),
    // which loses the whole page, so the API serves a fixed top 20.
    // Some runs labelled rows "Listing 1".."Listing 38"; the entity is the row's key in the dashboard,
    // in challenges and in the volatile re-check, so it has to be the product's own title.
    instructions:
      'The first 20 product listings in the search results, in page order: one row per listing, and do not stop before 20 unless the page has fewer. entity = the product title exactly as written on the listing (never a placeholder such as "Listing 1"). name = the product title; price = the listed price as shown (for sold-out items, the "Sold Price" value); stock = the stock label shown on the listing such as SOLD OUT, OUT OF STOCK or COMING SOON, left out when the listing shows none. Keep each excerpt to the shortest verbatim text that contains the value. Ignore filters, related searches and article text.',
    outputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, price: { type: 'string' }, stock: { type: 'string' } },
    },
    volatility: 'volatile',
    freshnessWindowMin: 15,
    pageCap: 1,
    // Newegg serves a near-empty shell to some blocked requests; the marker makes the ladder treat that as a shell.
    // It has to hold for any query, so it is the listing button rather than a model number.
    markers: ['add to cart'],
    sampleRequest: 'RTX 5080 GPU listings on Newegg: price, stock, link',
  },
];

// Sources with every param at its default: what the saved Task input holds. Runs override it.
export const defaultSources = (a: SeededApi) =>
  a.sources.map((s) => s.replace(/\{([a-z][a-z0-9_]*)\}/g, (m, k: string) => a.inputs[k]?.default ?? m));

export const taskInput = (a: SeededApi) => ({
  sources: defaultSources(a),
  outputSchema: a.outputSchema,
  instructions: a.instructions,
  pageCap: a.pageCap,
  ...(a.render ? { render: a.render } : {}),
  ...(a.markers?.length ? { markers: a.markers } : {}),
});

export const apiSpec = (a: SeededApi) => ({
  name: a.name,
  description: a.description,
  inputs: a.inputs,
  sources: a.sources,
  outputSchema: a.outputSchema,
  volatility: a.volatility,
  ...(a.freshnessWindowMin !== undefined ? { freshnessWindowMin: a.freshnessWindowMin } : {}),
  pageCap: a.pageCap,
});
