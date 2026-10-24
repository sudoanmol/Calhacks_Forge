import { unlockerRequest } from './lib/index.js';

export const makeFetchers = ({ apiKey, zone, browserWss, timeoutMs = 45_000 }) => {
  const unlocker = (url, country) => unlockerRequest({ url, country, apiKey, zone, timeoutMs });
  const browser = browserWss
    ? async (url, country) => {
        const { chromium } = await import('playwright-core');
        // Bright Data Browser API selects the exit country through the username suffix.
        const wss = country ? browserWss.replace(/(brd-customer-[^:@]+)/, `$1-country-${country}`) : browserWss;
        const b = await chromium.connectOverCDP(wss, { timeout: timeoutMs });
        try {
          const ctx = b.contexts()[0] ?? (await b.newContext());
          const p = await ctx.newPage();
          const res = await p.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
          return { status: res?.status() ?? 0, body: await p.content() };
        } finally {
          await b.close();
        }
      }
    : undefined;
  return { unlocker, browser };
};
