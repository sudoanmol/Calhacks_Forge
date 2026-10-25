# Devpost submission text

All money in this project is **TEST MODE**.

## Project name

FORGE

## Tagline

A one-person company of AI agents that sells verified APIs over public web data and gets cheaper every time it sells one.

## Inspiration

Agents can already read the web. The hard parts are deciding what they are allowed to collect, proving that what they return is true, and making repeat work cheaper. We wanted a company where each of those is a job held by an agent, every decision is recorded, and one human only approves the consequential actions.

## What it does

A customer asks for an API in ASI:One chat, for example "Open roles at Lattice from its Greenhouse board: job title, team and location." The Front Desk agent parses the request and runs instant gate checks: no personal data, no login-only domains, within the page cap. It quotes and takes payment (Stripe test checkout or testnet FET, TEST MODE).

The COO, a CREAO agent, matches the request to an existing API or sends it to Research. Research checks robots.txt, quotes the terms-of-service clause with its URL, confirms the page is reachable, and measures volatility with two fetches at least 120 seconds apart. The COO then accepts, counteroffers or rejects with the cited reason.

An accepted request runs as an Apify Task of `forge-extract`, the Tier 0 generic extractor. Every value must be anchored to a verbatim quote on a saved page, or it is marked `unverifiable`. Bright Data re-fetches each source independently. The Auditor, another CREAO agent, accepts or rejects the delivery with a written reason. The customer gets the table, a status per value and a dataset link in chat.

The customer can challenge any value. FORGE re-checks it against the saved page and a fresh fetch in about a second, and the Auditor rules on it.

When an API proves demand or has quality problems, a reducer opens a compile ticket. The CFO decides whether to invest from the engineering budget. Factory Droid compiles a deterministic Tier 1 Actor with the same schema, inside a locked session. Tests must pass on fixtures, the schema contract and live pages. The Auditor reviews, and the founder approves the ship from the dashboard. Every later buyer of that API gets the cheaper version.

The founder watches all of it on a live dashboard on a laptop and a phone: a forge floor with one station per employee, an org chart of handoffs, the catalog, and the recorded compile.

## How we built it

- **SpacetimeDB** is the only database. A TypeScript module on Maincloud holds APIs, orders, tasks, budgets, a double-entry ledger and an append-only event log. Reducers enforce every rule by the caller's role. Procedures are the only code that calls the outside world, and they never call out with a transaction open. HTTP routes receive CREAO and Apify callbacks with one-time tokens.
- **CREAO** runs four saved agents: COO, Research, CFO and Auditor. They act only through `forge-cli`, a zero-dependency Node CLI whose commands map to each seat's reducers. Only a scheduled `dispatch` procedure starts runs.
- **Factory Droid SDK** drives compiles from `workers/droid-runner`. The session keeps only file tools plus our own `run_command` tool, which applies an allow/deny policy. Droid can edit only the extractor files of the Actor it is compiling and run its tests. Anything else is denied or becomes a founder approval card.
- **Fetch.ai uAgents** run the Front Desk (Chat Protocol and Payment Protocol as seller) and an independent buyer agent that discovers FORGE on Agentverse and pays with testnet FET.
- **Apify** hosts `forge-extract` (Tier 0), one Task per Tier 0 API, and compiled Tier 1 Actors with versions.
- **Bright Data** Web Unlocker and SERP API fetch and verify every page through a fallback ladder: Unlocker, then the Browser API for JavaScript shells, then one retry from another country, then `unverifiable`.
- **Claude Haiku** (`claude-haiku-5-5`) is the Tier 0 extraction model. It verified 296 of 302 values (98.0%) across the three seed sites on an independent re-fetch (`docs/proof/gate0-extract-2026-10-24T16-44-36-467Z.json`).
- **Dashboard:** Vite, React, SVG and Framer Motion, rendered only from SpacetimeDB subscriptions.

## Challenges we ran into

- **Bright Data compliance blocks.** Greenhouse HTML job boards are blocked without KYC. Bright Data reports this as HTTP 200 with an empty body and the reason in a header. We made the ladder stop on a compliance block and moved `open-roles` to Greenhouse's public JSON API.
- **Locking down Droid.** Sessions inherit the host's tools, and at Low autonomy the CLI auto-runs shell commands it rates low-risk. We disabled every tool except file tools, routed shell commands through our own policy-checked tool, and forced direct tool execution, which SDK 0.10 does not forward on its own.
- **ASI:One does not show later agent messages.** A follow-up sent 69 seconds after a quote was delivered to Agentverse but never appeared in chat. Customers send `status` instead.
- **A real failed compile.** The first Droid attempt failed its live test because the test compared Discord's 46 rows with a Lattice fixture's 7. The Auditor rejected it, we fixed the shared test to compare matching URLs only, and the same Droid session passed on attempt 2.
- **An honest rejection.** A researched Wikipedia API delivered one of the two requested fields. The Auditor rejected it and the API was retired. We kept the record instead of hiding it.

## Accomplishments that we're proud of

- A real compile end to end: ticket #6 for `open-roles` went from a demand trigger through the CFO, a failed Droid attempt, an Auditor rejection, a resumed session, founder approval and ship as Apify Actor `RdQhIe6Jj6mE2qT4L` v1.0 (`docs/compile-proof.md`).
- Measured savings on one matching pair of runs: Lattice cost per call fell from $0.005772 TEST MODE at Tier 0 to $0.004237 TEST MODE at Tier 1, 26.6% less, with zero LLM tokens (`docs/compile-proof.md`).
- An independent buyer agent found FORGE on Agentverse and bought `open-roles` with 1 testnet FET before and after the compile, receiving 21 verified values each time (`fetch-agents/buyer/logs/20261024T222758Z.json`, `fetch-agents/buyer/logs/20261025T005417Z.json`).
- A customer challenge rechecked in 1000 ms against the saved page and a fresh fetch, then ruled on by the Auditor with a reason (challenge #14, `docs/proof/asi-challenge-202.json`).
- A physical phone and a laptop showing the same founder budget change without a refresh (`docs/progress.md`).

## What we learned

- Proof has to be built into extraction. A verbatim quote on a saved page turns "the model said so" into something a second fetch can check.
- Agents need narrow interfaces. A CLI that maps one-to-one to reducers made every agent decision typed, role-checked and recorded.
- Rules belong in the database. Budget caps, approvals and leases enforced in reducers held no matter which agent or worker called them.
- Honest failures make the demo stronger. The rejected Wikipedia API and the failed first compile show the checks work.

## What's next

`docs/after-hackathon.md` has no entries yet. TODO(founder): add the post-hackathon ideas there, then summarize them here.

## Built with

TypeScript, Node.js, Python, pnpm, uv, SpacetimeDB (Maincloud), CREAO, Factory Droid SDK (`@factory/droid-sdk`), Fetch.ai uAgents, Agentverse, ASI:One, ASI-1, Apify (Actors, Tasks, datasets, key-value stores), Bright Data (Web Unlocker, SERP API, Browser API), Anthropic Claude Haiku, Stripe (test mode), Fetch testnet FET, React, Vite, SVG, Framer Motion, Playwright.

## Tracks

| Track | Fit |
|---|---|
| Factory Droid SDK | Droid does real work in the running product: it compiled the shipped `open-roles` Tier 1 Actor in a locked session, failed once, and was repaired in the same session |
| Fetch.ai | The whole customer journey runs in ASI:One through the Front Desk uAgent, and a separate buyer uAgent discovers FORGE on Agentverse and pays through the Payment Protocol |
| CREAO: Best One-Person Company | Four CREAO agents (COO, Research, CFO, Auditor) run the company's admission, investment and QA decisions; the founder only approves. One CREAO track only, per the organizers |
| SpacetimeDB | The only database: rules in reducers, outbound calls in procedures, callbacks in HTTP routes, and a live dashboard on two devices |
| Apify | `forge-extract` is the Tier 0 engine, each API is a Task, and compiled APIs are versioned Actors reused by later buyers |
| Apify Best Actor | `forge-extract`: verified extraction where every value carries a verbatim quote, a saved page and a status |
| Bright Data | Web Unlocker and SERP API fetch and independently verify every value through a logged fallback ladder, with honest `unverifiable` results |
| Microsoft Built for the Real World | Public-data APIs with an admission gate, per-value proof and a challenge path that a customer can check |
| Best Solo Hack | Built by one founder with AI agents as staff |
| Coinbase x402 | Not entered: x402 was cut (and eligibility is unconfirmed) |

## Verify before submitting

- [ ] Demo video link (required by Devpost).
- [ ] Separate 3 to 5 minute Fetch.ai video link.
- [ ] Redesign steps 3 to 6 (`docs/dashboard-redesign-spec.md` §11) are built and match the README's "How to see it" section: Org chart tab, Needs-you approval cards in the right rail, Droid strip, Engineering tab layout, phone layout. Remove or reword any part that did not ship.
- [ ] CREAO share links for a COO, a Research and an Auditor run (no `run` row has a share URL yet). The CFO share link expires November 23, 2026.
- [ ] Agentverse listing URL and badges for the Front Desk, and the ASI:One submission agent.
- [ ] `forge-extract` Actor link and Apify Store listing; confirm it began in Apify AI Chat for the Best Actor entry.
- [ ] Student eligibility (AGENTS.md §14 says it is not confirmed).
- [ ] Screenshots referenced in the docs live only on the founder's machine (`docs/proof/**/*.png` is ignored). Upload the ones you want to Devpost.
- [ ] `docs/after-hackathon.md` entries for "What's next".
- [ ] The public GitHub repository is pushed and public.
- [ ] Any number added after this draft has a source file.
