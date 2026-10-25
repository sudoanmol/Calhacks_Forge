# FORGE

A one-person company staffed by AI agents that sells APIs over public web data. Built at Cal Hacks 13.0, October 24 to 25, 2026.

Ask FORGE for any public-data API in ASI:One. It decides whether the request is allowed, builds the API, proves every value against the source, and gets cheaper every time the API is sold.

All money in this project is **TEST MODE**. No real money moves. Payments are Stripe test checkout or testnet FET. One demo switch records a payment as **SIMULATED PAYMENT** instead, and it is labeled that way in chat, on the dashboard and in the ledger.

## Judge tour (60 seconds)

1. [Find the Front Desk on Agentverse](https://agentverse.ai/agents/details/agent1qwxszhvaegkq6lsu8n0aks5sqz0l4h63janfx0xgrgcnvxgkl6n6uafetjq/profile) and ask for open roles in ASI:One.
2. Inspect the [four CREAO seats and public CFO decision](docs/creao/deployment.md), then the [real customer delivery and challenge](docs/proof/asi-challenge-202.json).
3. Read the [compile trace, founder approval and measured savings](docs/compile-proof.md). The founder fixed the shared test; Droid resumed with the same extractor.
4. Open the [recorded buyer purchase](fetch-agents/buyer/logs/20261025T005417Z.json) and [Apify Actor](https://console.apify.com/actors/RdQhIe6Jj6mE2qT4L).
5. Follow the [demo and recovery runbook](docs/demo.md). Public dashboard hosting, share links for the other CREAO seats, shared ASI:One chat and videos remain in the [release handoff](docs/unified-final-audit-tasks.md).

Refunds credit FORGE's TEST MODE ledger. Stripe test payments and testnet FET transfers are not reversed. Header revenue includes in-flight payments minus ledger refunds; any simulated share is explicitly labeled.

## What FORGE sells

FORGE sells **APIs**: named, re-runnable endpoints such as `open-roles`, `yc-directory` and `gpu-listings`. Each API has a description, input parameters, sources, an output JSON Schema, a volatility (`stable` or `volatile`), a freshness window and a page cap.

- **Tier 0 (generic).** An Apify Task of the `forge-extract` Actor with the API's saved input. An LLM reads each saved page and returns each value with a verbatim excerpt. It can be created in minutes and costs more per call.
- **Tier 1 (compiled).** A dedicated Apify Actor that Factory Droid generated from `actors/template`. Deterministic extraction, no LLM, same name and output schema as the Tier 0 version it replaces.
- **Quote anchor.** In both tiers, the excerpt must appear verbatim in the saved page text and the value must appear verbatim in the excerpt. Otherwise the value is `unverifiable` and is never delivered as a fact. Bright Data then re-fetches each source independently and marks each value `verified`, `stale`, `mismatch` or `unverifiable`.

Every request passes the **admission gate** before any money is spent:

- **Personal data.** A deterministic field detector rejects names, emails, phones and profiles at the Front Desk. Counts are fine; lists of people are not.
- **Blocked domains.** Login-only domains in `config.blocked_domains` are rejected at the Front Desk with the reason.
- **Page cap.** A scope above `config.page_cap` gets a counteroffer for the top N pages.
- **robots.txt and terms.** Research checks robots.txt in code and quotes the terms-of-service clause with its URL. An unclear clause means reject.
- **Reachable and measured.** The data must be on a page reachable by URL or search, without a form flow. Volatility is measured with two fetches at least 120 seconds apart, not guessed.

## How to see it

There are two surfaces.

Review, status, catalog carousel and challenge form cards are implemented and tested through the protocol models. Phone rendering remains a founder release check.

1. **ASI:One chat.** This is the whole customer journey: request, gate decision, quote, payment, `status`, delivery and challenge. The customer talks to the Front Desk agent (`forge-front-desk`). There is no customer website. ASI:One does not show messages an agent sends later on its own (tested October 24, see AGENTS.md §14), so the customer sends `status` to read progress and the delivered table.
2. **Founder dashboard (`/web`).** It renders only from SpacetimeDB subscriptions and runs on a laptop and a phone at once.
   - **Header:** revenue, verified %, cost per call, APIs for sale, and `agent decisions N : founder approvals M`, all counted from stored rows. Money is labeled TEST MODE.
   - **Order headline:** for example `#205 · open-roles for lattice · Delivered · 21/21 verified · $1.00 TEST MODE SIMULATED PAYMENT` (from `docs/progress.md`, step 2).
   - **Office:** the selected order on the forge floor, one station per role. A station drawer shows the employee's decision, the reason verbatim, the evidence and the CREAO run link.
   - **Org chart:** founder, Front Desk, COO, Research, Auditor, CFO, Droid, the Apify Warehouse, and the Treasurer and Rules footer. Each edge is labeled with a count of handoffs taken from stored events.
   - **Catalog:** the live APIs as cards with tier, version, verified rate, buyers, measured cost per call and volatility.
   - **Engineering:** the recorded `open-roles` compile (ticket #6) as a timeline labeled RECORDED: trigger, CFO decision, budget, each Droid attempt with badged tool calls and tests, Auditor verdicts, founder approval and ship.
   - **Controls (gear):** the founder levers. The budget cap, `compile_min_buyers`, `creao_max_concurrency` and `refund_limit` are primary; the rest are under Advanced. Each lever is a founder-only reducer that changes behavior.
   - **Right rail:** Needs you (approval cards), a feed with one sentence per event and a raw JSON expander, and a Droid strip.

The dashboard is a forge floor drawn in React, SVG and Framer Motion. The design reasoning is in [docs/dashboard-redesign-spec.md](docs/dashboard-redesign-spec.md) §1 to §5.

## Proof

Each row below is a recorded real run. Curated `audit-*.png` screenshots show local SIMULATED QA; other screenshots stay on the founder's machine (`.gitignore`); the JSON records are committed.

| What | Record | What it shows |
|---|---|---|
| Order #202, ASI:One, Stripe test checkout | [docs/proof/asi-challenge-202.json](docs/proof/asi-challenge-202.json) | Paid through real Stripe test checkout, delivered 21 verified values from the Tier 1 Actor in ASI:One |
| Challenge #14 on order #202 | [docs/proof/asi-challenge-202.json](docs/proof/asi-challenge-202.json) | The customer challenged row 0 `team`. `recheck` read the saved page and a fresh Bright Data fetch in 1000 ms total (saved 161 ms, fresh 838 ms). Both quotes matched. The Auditor rejected the challenge with a reason citing the saved department structure |
| Order #199, new request through Research | [docs/proof/research-live-199.json](docs/proof/research-live-199.json) | A Wikipedia source passed the gate (two fetches 122 s apart, cited robots and terms). The COO created an Apify Task. The Auditor rejected the result because one of the two requested fields was missing. The API was retired. This is an honest failure, not a delivery |
| Order #205, SIMULATED PAYMENT | [docs/proof/demo-payment-205.json](docs/proof/demo-payment-205.json) | Payment skipped by `FORGE_DEMO_PAY=true` and labeled SIMULATED PAYMENT. Intent, COO, Apify run, Bright Data verification and Auditor were real: 21 verified values, ledger balanced |
| Compile ticket #6, `open-roles` | [docs/compile-proof.md](docs/compile-proof.md) | CFO invested 500 cents (TEST MODE). Droid attempt 1 failed the live test, the Auditor sent it back, the resumed Droid session passed attempt 2, the founder approved ship approval #10, and Actor `RdQhIe6Jj6mE2qT4L` v1.0 shipped as API version 20 |
| Droid traces for ticket #6 | `workers/droid-runner/logs/open-roles-2026-10-25T00-41-33-360Z.{jsonl,diff}` and `open-roles-2026-10-25T00-45-16-606Z.{jsonl,diff}` | Both attempts: every streamed message, tool call and diff |
| Tier 1 canary | [workers/canary/results/2026-10-25T00-51-06-238Z.json](workers/canary/results/2026-10-25T00-51-06-238Z.json) | Tier 1 runs on Lattice and Discord after the ship |
| Buyer agent, before the compile | [fetch-agents/buyer/logs/20261024T222758Z.json](fetch-agents/buyer/logs/20261024T222758Z.json) | Order #131: found FORGE on Agentverse, paid 1 testnet FET through the Payment Protocol, received 21 verified values in 100.4 s |
| Buyer agent, after the compile | [fetch-agents/buyer/logs/20261025T005417Z.json](fetch-agents/buyer/logs/20261025T005417Z.json) | Order #196: paid 1 testnet FET, received 21 verified values from Tier 1 version 20 in 103.9 s, with no new build |
| Buyer agent, first attempt | [fetch-agents/buyer/logs/20261024T221151Z.json](fetch-agents/buyer/logs/20261024T221151Z.json) | Order #104: the Front Desk offered only Stripe, the buyer pays only in FET, so it rejected the payment and the order stayed unpaid. FET was added to the Front Desk after this run |
| CREAO agents and the CFO run | [docs/creao/deployment.md](docs/creao/deployment.md) | Four saved agents and the public CFO share link |
| Two devices | [docs/progress.md](docs/progress.md) | A physical phone showed a budget cap change from $20.00 to $21.00 TEST MODE without a refresh |

## Sponsors

### CREAO

**What it does here.** Four saved CREAO agents are the company's judgment: the COO (accept, counteroffer, request research, reject), Research (the layer-3 admission gate with citations), the CFO (compile, defer or reprice on unit economics) and the Auditor (accepts or rejects each deliverable, challenge and compile). They act only through `skills/forge-cli`, a zero-dependency CLI whose commands map to the reducers for each seat. Agents never start other agents; only the `dispatch` procedure starts runs. Each CREAO dispatch starts a new thread; Droid resumes its own engineering session.

**What breaks without it.** Nobody admits, prices, invests or audits. Orders stop at `paid`.

**Where to see it.**

| Seat | Agent ID | Version |
|---|---|---|
| COO | [`81c6c2cc-98d6-4ea5-8fcf-942f8772bf20`](https://agent.creao.ai/apps/81c6c2cc-98d6-4ea5-8fcf-942f8772bf20) | 1.1.0 |
| Research | [`bad9531d-a359-4af3-9913-fc9310fe4218`](https://agent.creao.ai/apps/bad9531d-a359-4af3-9913-fc9310fe4218) | 1.1.0 |
| CFO | [`63d131de-1b0c-4801-a58f-1698c894a672`](https://agent.creao.ai/apps/63d131de-1b0c-4801-a58f-1698c894a672) | 1.0.0 |
| Auditor | [`6865c094-e20c-48c7-a969-d5e75c67dd06`](https://agent.creao.ai/apps/6865c094-e20c-48c7-a969-d5e75c67dd06) | 1.1.0 |

Source: [docs/creao/deployment.md](docs/creao/deployment.md). Prompts: [docs/creao/](docs/creao/). CLI: [skills/forge-cli/SKILL.md](skills/forge-cli/SKILL.md).

- **CFO compile decision:** [public CFO run](https://agent.creao.ai/share/2361cbf6417714be089c498e9e96c580) on compile ticket #6. The CFO called `cfo_propose(COMPILE, 500, rationale)`. Expires November 23, 2026. The memo compares costs against two retired `cmp-test` fixtures, which were simulated compile-test outputs; see the note in `docs/creao/deployment.md`.
- **Research and a reject:** order #199. Research cited `https://en.wikipedia.org/robots.txt` and the Wikimedia Terms of Use; the Auditor rejected the result for a missing field ([record](docs/proof/research-live-199.json)).
- **Auditor reject, then accept:** ticket #6, attempt 1 rejected, attempt 2 accepted ([docs/compile-proof.md](docs/compile-proof.md)).
- **Challenge ruling:** challenge #14, rejected by the Auditor with a reason ([record](docs/proof/asi-challenge-202.json)).
Historical decisions to link, matched by the two source audits. Re-check run → task → order before making a share public.

| Seat | Decision | Order/ticket | Run | Public proof |
|---|---|---|---|---|
| COO | ACCEPT | order #202 | #81 | Founder share pending; [order record](docs/proof/asi-challenge-202.json) |
| Research | Cited gate report | order #199 | #77 | Founder share pending; [research record](docs/proof/research-live-199.json) |
| CFO | COMPILE, 500 cents TEST MODE | ticket #6 | Recorded in deployment notes | [Public CFO run](https://agent.creao.ai/share/2361cbf6417714be089c498e9e96c580) |
| Auditor | REJECT, missing field | order #199 | #80 | Founder share pending; [rejection record](docs/proof/research-live-199.json) |

- TODO(founder): share links for a COO run, a Research run and an Auditor run. The `run` table holds 39 CREAO runs and none has a share URL yet (read-only SQL on `forge`, October 25).
- TODO(founder): a share link for a cited REJECT on a request that fails the terms check, if one exists.

### Factory Droid SDK

**What it does here.** Droid is the runtime engineer. When a compile trigger fires, `workers/droid-runner` claims the task, copies `actors/template` to `actors/<api>` in a worktree with no secrets, writes fixtures from the API's saved Tier 0 pages and audited values, and runs a locked Droid session that implements only `extract(page)`. Tests run (fixtures, contract, live). The Auditor accepts or rejects; a rejection resumes the same Droid session with the reason. Only after the founder approves the ship does the worker, never Droid, run `apify push` and record the version.

**What breaks without it.** No Tier 1 Actors, no warranty fixes, and cost per call never falls.

**Where to see it.** The Engineering tab (RECORDED timeline of ticket #6), [docs/compile-proof.md](docs/compile-proof.md), the Droid logs and diffs in `workers/droid-runner/logs/open-roles-2026-10-25T00-4*`, and the controls in [workers/droid-runner/src/lockdown.ts](workers/droid-runner/src/lockdown.ts) and [workers/droid-runner/src/policy.ts](workers/droid-runner/src/policy.ts).

The ticket #6 trace: open-roles reached 2 distinct buyers (`compile_min_buyers` 2) → CFO proposed 500 cents TEST MODE → budget reserved → Droid session `34acdbcb-c5b1-495c-b52d-7d01458a6db7` → attempt 1 failed the live test (Discord's 46 rows compared with a Lattice fixture's 7 rows) → Auditor rejected → the founder corrected the shared test in commit `c6ac400` to compare row counts only for matching URLs → same session resumed → attempt 2 passed fixtures 1/1, contract 2/2, live 2/2 → Auditor accepted → founder approved ship approval #10 → ship task 4189 deployed Actor `RdQhIe6Jj6mE2qT4L` v1.0 → API version 20. Droid changed only `src/extract.js` and `src/jsonspan.js` (approval #10 detail).

**Control table** (compile sessions, `decideCompile` in `policy.ts`):

| Trigger | Allowed tools | Denied tools | Needs approval | Where it's visible |
|---|---|---|---|---|
| A `compile` ticket from `check_compile_triggers`: verified rate below `compile_min_verified_rate` over `compile_window_runs`, an upheld challenge caused by an extractor error, or `compile_min_buyers` distinct buyers. The CFO must propose COMPILE and `reserve_budget` must fit the cap | Read, LS, Glob, Grep, TodoWrite. Create, Edit and ApplyPatch only on files under the Actor's `src/` that are not template plumbing. `run_command` only for `pnpm test`, `pnpm run test:fixtures`, `pnpm run test:contract` and `node --test …` | Every other host tool (MCP, web, Task, Script, Execute) is disabled at session creation. Writes outside the Actor, outside `src/`, or to `src/lib/`, `src/main.js`, `src/run.js`, `src/fetchers.js`. Commands with shell operators, absolute or parent paths, `test:live`, `curl`, `wget`, `ssh`, `scp`, `nc`, `apify push/login/secrets`, `git push/reset/rebase/remote`, `sudo`, `.env`, `npm`, `yarn` | Any other plain command becomes an `approval(droid_action)` card for the founder. The ship itself is an `approval(api_ship)` | Engineering tab badges each tool call auto-allowed, denied, founder-approved or needs-approval. Every streamed message is logged through `log_droid_event` |

Other controls: autonomy Low, `toolExecutionMode: 'direct_only'` forced at session init (patched in `lockdown.ts`, because SDK 0.10 does not forward it), and resumed sessions must keep the original worktree path.

Denied actions on record: approvals #4 and #8 are `droid_action` requests for `ls src` ("not on the compile allowlist") that the founder rejected. Both came from `cmp-test` compile-test APIs (tickets 3 and 5), not from ticket #6. The ticket #6 Auditor reason records 0 denied actions (read-only SQL on `approval`).

### SpacetimeDB

**What it does here.** The only database. One TypeScript module on Maincloud (database `forge`) holds APIs, orders, tasks, budgets, the ledger and an append-only event log. Reducers enforce every rule using `ctx.sender` roles from the `staff` table. Procedures are the only code that calls the outside world. The dashboard is a live subscription on two devices.

**What breaks without it.** No shared state, no rules, no live dashboard and no recorded compile timeline.

**Where to see it.** Two devices updating together ([docs/progress.md](docs/progress.md)); the budget cap lowered from 2000 to 40 cents TEST MODE made ticket 6 ineligible and released its reservation, and restoring it requeued the ticket (recorded in live reducer events, [docs/progress.md](docs/progress.md)); the double-claim test in `module/test/api.test.mjs` ("two workers race, exactly one wins").

Exported from [module/src/index.ts](module/src/index.ts):

- **Reducers:** `audit_verdict`, `backfill_canary_orders`, `cancel_task`, `cfo_propose`, `challenge_verdict`, `claim_task`, `close_compile`, `compile_failed`, `compile_verdict`, `complete_task`, `coo_decide`, `create_api`, `create_order`, `decide_approval`, `enqueue_task`, `ensure_defaults`, `lease_sweep` (scheduled), `log_droid_event`, `open_challenge`, `record_api_version`, `record_gate_check`, `record_payment`, `refund_order`, `set_run_share_url`, `reject_at_desk`, `renew_lease`, `request_droid_action`, `research_report`, `retire_api`, `set_budget_cap`, `set_config`, `set_order_params`, `set_staff`, `submit_compile`, `update_api`.
- **Procedures:** `admission_precheck` (scheduled), `apify_poll`, `create_apify_task` (scheduled), `creao_poll`, `creao_start`, `dispatch` (scheduled), `http_smoke`, `recheck` (scheduled), `research_fetch`, `settle_run_cost` (scheduled), `start_api_run` (scheduled), `verify_probe`, `verify_values` (scheduled).
- **HTTP routes:** `POST /ping`, `POST /creao-callback`, `POST /apify-callback`. Callbacks need a one-time token, never trust the body, and re-fetch the run with FORGE's key.
- **Lifecycle:** `init`.

### Fetch.ai

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

**What it does here.** The Front Desk is a uAgent with the Chat Protocol and the Payment Protocol (seller). It parses intent with ASI-1, runs the layer-2 gate checks, quotes, takes payment (Stripe test checkout or testnet FET), answers `status` and opens challenges. The buyer agent is a separate uAgent with its own seed and testnet wallet. It searches Agentverse, finds the Front Desk, asks for a named API, pays through the Payment Protocol as the buyer and reads the delivered dataset. It holds no FORGE keys and gets no shortcuts.

**What breaks without it.** No customers and no agent-to-agent sales.

**Where to see it.**

| Agent | Name | Address |
|---|---|---|
| Front Desk | `forge-front-desk` | `agent1qwxszhvaegkq6lsu8n0aks5sqz0l4h63janfx0xgrgcnvxgkl6n6uafetjq` |
| Buyer | `forge-buyer` | `agent1q2jj8g77x9dgyp0va9vxtzjeeajth02rv3pqhm9taf3gg6qd7uwcw4h4tr0` |

Addresses from `fetch-agents/buyer/discovery.py` and the buyer logs. The buyer picked `forge-front-desk` at rank 6 for the query "FORGE public data APIs" because it is active, speaks AgentChatProtocol, sells through AgentPaymentProtocol and mentions "forge" (buyer logs).

Buyer purchase log:

| Log | Order | Payment | Result |
|---|---|---|---|
| `20261024T221151Z.json` | #104 `gpu-listings` | Rejected: only Stripe was offered | Unpaid quote, 16.3 s |
| `20261024T222758Z.json` | #131 `open-roles` (Tier 0) | 1 testnet FET, `stable-testnet` (chain `dorado-1`), tx `92CB62A56D1BC9B23CC87DAEED20C69D9FC3677AE4B825A540455405CABF2E10` | 21 values, 21 verified, 100.4 s |
| `20261025T005417Z.json` | #196 `open-roles` (Tier 1 v1.0) | 1 testnet FET, tx `BE762C0EA997E60AA814515211E959A6057B266D9864C6C174E84745A5FBB9C7` | 21 values, 21 verified, 103.9 s |

- [Front Desk profile](https://agentverse.ai/agents/details/agent1qwxszhvaegkq6lsu8n0aks5sqz0l4h63janfx0xgrgcnvxgkl6n6uafetjq/profile). Badges and agent README are committed. Founder verification of its rendered profile and ASI:One submission registration remains open.
- TODO(founder): the separate 3 to 5 minute Fetch video link.

### Apify

**What it does here.** The product shelf (the Warehouse). `forge-extract` ("FORGE Verified Extract") is the Tier 0 engine: it fetches each page through Bright Data, saves the page text to the key-value store with its hash, asks Claude Haiku (`claude-haiku-5-5`) for `{field, value, excerpt}`, runs the quote anchor and pushes one dataset item per value. Each Tier 0 API is an Apify Task of `forge-extract`. Each Tier 1 API is its own Actor with versions.

**What breaks without it.** Nothing to sell or reuse.

**Where to see it.**

| API | Tier | Engine | Apify ID |
|---|---|---|---|
| `yc-directory` | 0 | Task, v0.1 | `OQN55sQeSFrmf3FW0` |
| `gpu-listings` | 0 | Task, v0.1 | `Q7CSHONOKeWjvo3kz` |
| `open-roles` | 0, superseded by v1.0 | Task, v0.1 | `kwMQrSsk3Of8CDvhk` |
| `open-roles` | 1 | Actor `forge-open-roles`, v1.0 (API version 20) | `RdQhIe6Jj6mE2qT4L` |

Source: read-only SQL on `api_version`, October 25. A second buyer reused `open-roles` with no new build (order #196). Order #199 shows the COO creating a new Task (`8Bo2SrE6aUQv1xbTs`) for a researched request.

- TODO(founder): the `forge-extract` Actor link and Store listing (pay-per-event pricing is a founder task, AGENTS.md §7).
- Target track: Apify Best Use.

### Bright Data

**What it does here.** Every page FORGE reads or verifies comes through Bright Data.

| Product | Used for |
|---|---|
| Web Unlocker (`forge_unlocker`) | Actor retrieval, the gate's reachability and volatility fetches, independent verification in `verify_values`, and challenge `recheck` |
| SERP API (`forge_serp`) | Research discovery (`forge search`) |
| Browser API | Implemented as the second rung of the ladder in `actors/*/src/fetchers.js`; no live run has used it (see below) |

The fallback ladder (`actors/forge-extract/src/lib/ladder.js`): Web Unlocker from `us` → Browser API if the page is a JS shell → one retry from `gb` on a block or timeout → `unverifiable` with the reason. A compliance block in the `x-brd-error` header ends the ladder at once. Every attempt is logged with method, country, status and time.

**What breaks without it.** No live data, no verification and no challenge recheck.

**Where to see it.**

- The `evidence` table: 130 attempts, 118 Web Unlocker and 12 SERP, 0 Browser API (read-only SQL, October 25). It includes a SERP attempt from `us` with status 0 followed by a retry from `gb` with status 200.
- An honest `unverifiable`: `https://boards.greenhouse.io/stripe` returned HTTP 200 with 0 characters of text through the Web Unlocker, the Browser API rung was not configured, so the page was marked `unverifiable` ([docs/proof/gate0-fetch-2026-10-24T16-27-57-662Z.json](docs/proof/gate0-fetch-2026-10-24T16-27-57-662Z.json)). Bright Data blocks Greenhouse HTML boards under its compliance policy without KYC; the public JSON API `boards-api.greenhouse.io` is allowed, so `open-roles` uses it (AGENTS.md §7 and §14, measured October 24).
- Challenge #14: saved page and fresh Bright Data fetch compared in 1000 ms ([record](docs/proof/asi-challenge-202.json)).
- Value statuses over all 1274 `value_record` rows: 1258 verified, 13 unverifiable, 2 mismatch, 1 stale (read-only SQL, October 25; includes test traffic).

## Measured numbers

Every number here has a source. Money is TEST MODE.

| Number | Source |
|---|---|
| `forge-extract` with Claude Haiku: 296 of 302 values verified on an independent Bright Data re-fetch (98.0%); open-roles 184/190, yc-directory 5/5, gpu-listings 107/107 | [docs/proof/gate0-extract-2026-10-24T16-44-36-467Z.json](docs/proof/gate0-extract-2026-10-24T16-44-36-467Z.json) |
| A later run: 299 of 305 (98.0%); gpu-listings 110/110 | [docs/proof/gate0-extract-2026-10-24T17-48-08-959Z.json](docs/proof/gate0-extract-2026-10-24T17-48-08-959Z.json) |
| `open-roles` cost per call on Lattice: $0.005772 TEST MODE at Tier 0 (order 174), $0.004237 TEST MODE at Tier 1 (order 193), 26.6% less. One pair of measured runs, not a general guarantee | [docs/compile-proof.md](docs/compile-proof.md) |
| Tier 1 LLM cost: 0 micro-USD on both Tier 1 runs (Tier 0 Lattice: 1801 micro-USD) | [docs/compile-proof.md](docs/compile-proof.md) |
| Tier 1 `open-roles` on Discord: 138/138 values verified, $0.004861 TEST MODE per call (order 192) | [docs/compile-proof.md](docs/compile-proof.md) |
| Both Tier 1 canaries reached auditing in 17 s | [docs/compile-proof.md](docs/compile-proof.md) |
| Challenge #14 recheck: 1000 ms total | [docs/proof/asi-challenge-202.json](docs/proof/asi-challenge-202.json) |
| Order #199 volatility check: two fetches 122 s apart | [docs/progress.md](docs/progress.md) |
| Buyer agent deliveries: 21/21 verified in 100.4 s (Tier 0) and 103.9 s (Tier 1) | buyer logs above |
| Database: 18 APIs created, 3 for sale; 205 orders, 9 from real ASI:One users or the buyer agent | read-only SQL on `forge`; real-order filter in [docs/progress.md](docs/progress.md) |
| Recorded dashboard header before the refund follow-up, real-order scope: revenue $5.00 TEST MODE, verified 100% (85/85) | [docs/progress.md](docs/progress.md), step 1 |

## Run it

Requirements: Node 22 or later with pnpm 11, Python 3.12 with uv, the `spacetime` CLI, and the `droid` CLI on the host that runs `droid-runner`.

Copy `.env.example` to `.env` and fill in test keys made for this project. Never commit `.env`. Keys by name: `SPACETIME_HOST`, `SPACETIME_DB`, `SPACETIME_TOKEN_FRONT_DESK`, `SPACETIME_TOKEN_DROID_RUNNER`, `SPACETIME_TOKEN_CANARY`, `BRIGHTDATA_API_KEY`, `BRIGHTDATA_UNLOCKER_ZONE`, `BRIGHTDATA_SERP_ZONE`, `BRIGHTDATA_BROWSER_WSS`, `APIFY_TOKEN`, `APIFY_USERNAME`, `CREAO_API_KEY`, `CREAO_APP_ID_COO`, `CREAO_APP_ID_RESEARCH`, `CREAO_APP_ID_CFO`, `CREAO_APP_ID_AUDITOR`, `FACTORY_API_KEY`, `ASI1_API_KEY`, `ASI1_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `FRONT_DESK_SEED`, `BUYER_AGENT_SEED`, `AGENTVERSE_API_KEY`, `FORGE_DEMO_PAY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`.

```sh
pnpm install
pnpm run build        # every workspace package
pnpm run typecheck
pnpm test             # actor lib sync check, then every package's tests

# SpacetimeDB module
pnpm -C module run build
pnpm -C module run publish:local   # local test database forge-test (wipes its data)
pnpm -C module run test:api        # tests against a running server
pnpm -C web run generate           # regenerate client bindings

# Founder dashboard
pnpm -C web dev

# Workers
pnpm -C workers/canary run seed
pnpm -C workers/canary run canary
pnpm -C workers/droid-runner run runner

# Fetch agents (from fetch-agents/)
cd fetch-agents
uv sync
uv run pytest
uv run --env-file ../.env python -m front_desk.agent
uv run --env-file ../.env python -m buyer.agent "I'd like to buy open-roles for the Lattice Greenhouse board: job title, team and location"
```

Module env values are declared in the schema and supplied at publish time (`KEY=… spacetime publish`). A reset with `--delete-data=always` wipes them. `FORGE_DEMO_PAY=true` turns on the labeled SIMULATED PAYMENT shortcut; `.env.example` leaves it off ([docs/demo.md](docs/demo.md)).

## Failure recovery

The dispatch schedule checks old CREAO runs for missed webhooks. An undecided task gets one additional run; a second undecided run fails it and refunds eligible paid orders. Runs time out after 15 minutes. Start failures retry at least 30 seconds apart and stop after five minutes. Customer-order tasks take priority over compile reviews. Founder rescue refuses work still in flight. A delivered order needs a rejected challenge refund before a refund can be requested again.

These changes are branch code verified locally. Maincloud publishing and a complete ASI:One smoke test remain founder release steps.

## Not built

These were cut (AGENTS.md §12) or are not finished:

- Coinbase x402 pay-per-call.
- The CFO's scheduled daily report.
- The `coverage`, `format` and `enhancement` ticket labels.
- Browser API runs. The rung is in the ladder code, but no live fetch has used it (0 Browser API rows in `evidence`).
- Company-wide Time Machine. The per-order replay bar is built and labeled REPLAY; Engineering shows ticket #6 with RECORDED timestamps.
- A Books tab. Revenue and cost per call are in the header and the catalog.
- A dataset QR code.
- Proactive status messages in ASI:One. ASI:One did not display a follow-up the agent sent 69 s after the quote (AGENTS.md §14), so customers send `status`.

## Repo layout

| Path | What |
|---|---|
| `module/` | SpacetimeDB module (TypeScript): tables, reducers, procedures, routes |
| `web/` | Founder dashboard (Vite, React, generated SpacetimeDB bindings) |
| `workers/droid-runner/` | Claims compile tasks and drives a locked Droid session |
| `workers/canary/` | Scripted end-to-end order on each seeded API |
| `fetch-agents/front_desk/` | Front Desk uAgent (Python, uv) |
| `fetch-agents/buyer/` | Independent buyer uAgent |
| `actors/forge-extract/` | Tier 0 generic Actor |
| `actors/template/` | Tier 1 template; only `extract(page)` is empty |
| `actors/open-roles/` | Compiled Tier 1 Actor, shipped as v1.0 |
| `actors/gpu-listings/` | Output of an earlier Droid compile run; not shipped, `gpu-listings` is sold as Tier 0 |
| `skills/forge-cli/` | Zero-dependency CLI and SKILL.md for the CREAO agents |
| `docs/` | Build contract inputs, CREAO prompts, proof records, compile proof, demo walkthrough |

The build contract is [AGENTS.md](AGENTS.md).
