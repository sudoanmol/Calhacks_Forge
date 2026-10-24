// The seeded Tier 0 catalog (AGENTS.md §3, picked at Gate 1). Each entry is both the Apify Task
// input for forge-extract and the spec registered with create_api, so the two cannot drift.

export type SeededApi = {
  name: string;
  description: string;
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
    description: 'YC company directory: name, one-liner, website, batch and status from public YC company pages.',
    sources: ['https://www.ycombinator.com/companies/airbnb'],
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
      "Open roles at Discord from its public Greenhouse job-board API (boards-api.greenhouse.io): each posting's title, team (the department it is listed under) and location. Aggregate counts by team and location are derived from these rows. Job postings only, no personal data.",
    // The departments endpoint nests each job under its department, so the team is on the page
    // next to the title. Discord's board (~43K chars) fits the extractor's 60K page budget whole;
    // larger boards such as Stripe (~450K) would be truncated.
    sources: ['https://boards-api.greenhouse.io/v1/boards/discord/departments'],
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
      'RTX 5080 graphics card listings from the public Newegg search results page: product name, price and stock status per listing. Volatile: prices and stock change often, so values are verified within a 15-minute window.',
    sources: ['https://www.newegg.com/p/pl?d=rtx+5080'],
    // Gate 0's one-line instruction let the model stop after ~9 of the ~35 listings on the page.
    instructions:
      'Every product listing in the search results, in page order: one row per listing, and do not stop early (a results page usually has 30 to 40). name = the product title; price = the listed price as shown (for sold-out items, the "Sold Price" value); stock = the stock label shown on the listing such as SOLD OUT, OUT OF STOCK or COMING SOON, left out when the listing shows none. Ignore filters, related searches and article text.',
    outputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, price: { type: 'string' }, stock: { type: 'string' } },
    },
    volatility: 'volatile',
    freshnessWindowMin: 15,
    pageCap: 1,
    // Newegg serves a near-empty shell to some blocked requests; the marker makes the ladder treat that as a shell.
    markers: ['5080'],
    sampleRequest: 'RTX 5080 GPU listings on Newegg: price, stock, link',
  },
];

export const taskInput = (a: SeededApi) => ({
  sources: a.sources,
  outputSchema: a.outputSchema,
  instructions: a.instructions,
  pageCap: a.pageCap,
  ...(a.render ? { render: a.render } : {}),
  ...(a.markers?.length ? { markers: a.markers } : {}),
});

export const apiSpec = (a: SeededApi) => ({
  name: a.name,
  description: a.description,
  inputs: {},
  sources: a.sources,
  outputSchema: a.outputSchema,
  volatility: a.volatility,
  ...(a.freshnessWindowMin !== undefined ? { freshnessWindowMin: a.freshnessWindowMin } : {}),
  pageCap: a.pageCap,
});
