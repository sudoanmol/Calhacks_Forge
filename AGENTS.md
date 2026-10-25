# AGENTS.md (v2, two-tier general APIs): FORGE build contract

> **Draft alternative to `AGENTS.md` (v1, fixed company-intel domain).** If v2 is adopted, it replaces `AGENTS.md` and v1 is deleted. Reasoning: `docs/generalized-plan.html` and `docs/sponsor-impact.html`.

Every coding agent working in this repo reads this file before writing code. If it conflicts with anything else, this file wins.

- Product base: `docs/reference/FORGE_guide.pdf` (product, roles, story). This file overrides the PDF where they conflict.
- Implementation reference: `docs/reference/Lights_On_v7_build_plan.pdf` (earlier plan with the same sponsors, the challenge flow and the risk controls). Use it only for patterns; everything it scopes out stays out.
- **verify** means the item has not been checked against official docs. Read the docs (Context7 or the links in §15) before you build on it, then remove the marker.

---

## 1. TL;DR

**Pitch.** "Ask FORGE for any public-data API in ASI:One. It decides whether it's allowed, builds it, proves every value against the source, and gets cheaper every time it's sold."

FORGE is a one-person company staffed by AI agents. It sells **APIs over public web data**: named, re-runnable endpoints such as `gpu-listings`, `yc-directory` or `open-roles`. Every request passes an **admission gate** (public, no personal data, terms allow it, verifiable, within the page cap). Admitted requests are served immediately by a **generic extractor** (Tier 0). APIs with proven demand, or with quality problems, are **compiled by Factory Droid** into dedicated deterministic Actors (Tier 1), which are cheaper and more stable. Bright Data fetches and independently verifies every value; each value is anchored to a verbatim quote on a saved page. CREAO employees decide accept / counteroffer / reject / compile. SpacetimeDB is the company's live state. Agents earn bonuses only on accepted work. Customers can challenge any value and watch the company recheck it in seconds.

**The loop.**

```
ASI:One customer ─▶ Front Desk (Fetch) ─▶ deterministic pre-checks ─▶ SpacetimeDB order ─▶ COO (CREAO)
   ├─ API exists     ─▶ run it (Tier 0 Task or Tier 1 Actor) ─▶ Bright Data verify ─▶ Auditor ─▶ delivered in chat
   ├─ new, admitted  ─▶ Research gate ─▶ new Tier 0 API (Apify Task) ─▶ run ─▶ verify ─▶ Auditor ─▶ delivered
   └─ fails gate     ─▶ cited REJECT or COUNTEROFFER in chat
compile trigger ─▶ CFO invests ─▶ Droid compiles (template + Tier 0 fixtures) ─▶ Auditor ─▶ founder approves ship
   ─▶ Tier 1 version, same schema ─▶ every buyer of that API gets it, at lower cost per call
customer: "row 4 is wrong" ─▶ challenge ─▶ recheck vs saved page ─▶ Auditor ─▶ refund + clawback, or fresh value
```

**Sponsors.**

| Sponsor | Job in FORGE | What breaks without it | What their judges see |
|---|---|---|---|
| CREAO | COO, Research, CFO, Auditor: admission, commercial, investment and QA judgment | Nobody admits, prices, invests or audits | Four saved agents, real run share links, a cited rejection, a counteroffer, a CFO compile decision on unit economics, a reject followed by an accept |
| Factory Droid SDK | The runtime engineer that compiles APIs and fixes extractor errors | No Tier 1, no warranty fixes, cost per call never falls | The Engineering tab: reducer-triggered ticket → plan → each tool call badged allowed/denied/approved → diff → tests against real saved pages → failed attempt then repair. One live denied action. |
| SpacetimeDB | The only database: APIs, orders, tasks, budgets, ledger, events | No shared state, no rules, no live dashboard, no replay | Two devices updating together, a budget change blocking a compile, a guarded double claim, the API marketplace live, Time Machine |
| Fetch.ai | Front Desk: the whole customer journey in ASI:One. Buyer agent: an independent uAgent that discovers and buys a named API. | No customers, no agent-to-agent sales | Agentverse listing, any request → gate decision → pay → status → delivery → challenge inside ASI:One; the buyer agent finding FORGE on Agentverse and paying through the Payment Protocol |
| Apify | The product shelf: `forge-extract` (Tier 0 engine), APIs as Tasks, compiled Actors with versions | Nothing to sell or reuse | Actor and Task runs, datasets, saved pages, version history, a second buyer reusing an API, Best Actor entry |
| Bright Data | SERP discovery, Web Unlocker retrieval and independent verification, Browser API for JS pages, chained by the fallback ladder | No live data, no verification, no challenge recheck | The ladder in the request logs (Unlocker → Browser API → other country → `unverifiable`) with status, timing and the reason for each step |
| Coinbase (if eligible) | x402 pay-per-call access to a named API | Only the x402 feature | One x402 challenge/response purchase |

---

## 2. Rules

1. Never fake a demo moment. No mocked research, no hardcoded values, no staged failures.
2. Replays are labeled **REPLAY**. Anything simulated is labeled **SIMULATED**.
3. All money is test mode and labeled **TEST MODE** everywhere it appears (chat, dashboard, README).
4. Public data only. No logins, no paywalls, no personal data (counts, never names). Every request passes the admission gate (§3) before any spend.
5. Keys stay server-side. Use test keys made for this project only. Never commit secrets. Actor worktrees contain no secrets.
6. Untrusted input (web pages, agent output, webhook bodies, chat text) never authorizes anything. Only reducers authorize, using `ctx.sender` roles and stored state.
7. Founder approvals happen only through reducer calls from the dashboard under the founder identity.
8. Never make an HTTP call while a transaction is open. Only procedures and workers call the outside world.
9. Never invent a replacement value. A value without a verbatim quote on the saved page is `unverifiable`.
10. API versions are additive only. Never rename or remove an output field. Compiling keeps the API's schema.
11. Only measured numbers go in the README.
12. New ideas go in `/docs/after-hackathon.md`, not in code.
13. After Gate 1 the schema is frozen: changes are additive only.
14. Use pnpm for JS (never npm) and uv for Python (Python 3.12; uagents needs ≥3.10).
15. Commit after each major feature, once its tests pass. Small, focused commits in Conventional Commits style (`feat(module): …`). Never commit a failing build or failing tests.
16. Every feature ships with tests that verify it:
    - **Backend** (module reducers/procedures/routes, workers, Actors, CLI, agents): test directly against the real API, e.g. call reducers and run SQL through the SpacetimeDB HTTP API on the deployed database, run the Actor and read its dataset, hit the route with curl. Unit tests cover the pure logic; they don't replace the live API check.
    - **Frontend** (`/web`): verify in a real browser with the `agent-browser` skill: load the page, interact, check what renders, and take a screenshot. Type checks alone don't count.

**Not building:** anything behind a login or paywall, personal data, data that only appears after a multi-step form (flight or booking searches), crawls past the page cap, the Lights On ProofPage HTML and its `/p` route, Rush Hour, presence cursors, an animated money ticker (the header stats strip replaces it), a live human-decision ticker (the `agent decisions : founder approvals` pair in §8 is a count over stored events, not a ticker), pause switch, Slack, Gmail, Moss, fact-checker for hire, Droid trust levels, scheduled monitoring/subscriptions.

---

## 3. Product spec

### What FORGE sells: an API

An **API** is a named, re-runnable spec:

```
name, description, inputs (params), sources (URLs, URL patterns or a search query), outputSchema (JSON Schema),
volatility (stable | volatile), freshnessWindowMin, pageCap, tier (0 | 1), engine (Apify Task id or Actor id + version)
```

- **Tier 0 (generic):** an Apify **Task** of the `forge-extract` Actor with the API's saved input. Created in minutes, no engineering. Higher cost per call (LLM tokens per page).
- **Tier 1 (compiled):** a dedicated Actor that Droid generated from `/actors/template`. Deterministic extraction (selectors or the site's JSON), no LLM, lower cost per call. Same name and output schema as the Tier 0 version it replaces.
- **Seeded catalog:** 2–3 Tier 0 APIs created and canaried before the demo, e.g. `gpu-listings` (public retailer listing pages, volatile), `yc-directory` (public directory, stable), `open-roles` (public Greenhouse/Lever/Ashby job-board APIs, counts by team and location, stable). **Picked at Gate 1: all three.**
- **Honest seeding:** the first real compile is whichever seeded API first meets a compile trigger (likely `gpu-listings`). Never stage failures.

### Admission gate (cheapest checks first)

| Layer | Check | Who | Cost |
|---|---|---|---|
| 1 | Intent parse into {sources, fields, scope} | Front Desk (ASI-1) | already paid |
| 2 | Requested fields contain personal data (names, emails, phones, profiles) | Front Desk, deterministic field detector | none |
| 2 | Source domain on the login-only list (`config.blocked_domains`) | Front Desk, deterministic | none |
| 2 | Scope exceeds `config.page_cap` | Front Desk, deterministic → counteroffer top N | none |
| 3 | robots.txt allows the paths | Research via CLI (code, one fetch) | 1 fetch |
| 3 | Terms of service allow automated collection: **quote the clause and URL** | Research (judgment) | 1 run |
| 3 | Data visible on a page reachable by URL or search, without a form flow | Research via Bright Data | fetches |
| 3 | Volatility: two fetches a few minutes apart, compared | Research (measured, not guessed) | 2 fetches |

Layer 2 failures are rejected instantly with the reason; no CREAO run is spent. Layer 3 results are stored as `gate_check` rows. An unclear terms clause means REJECT. The COO decides on the findings.

| Example | Outcome |
|---|---|
| "RTX GPU listings from Newegg, Micro Center, B&H: price, stock, link" | Tier 0 (volatile, 15-minute window), compile candidate |
| "YC W26 companies with website and one-liner" | Tier 0 (stable) |
| "Cheapest flights SFO→JFK on these dates" | REJECT, cited: fares only exist after a search form, are per-session and can't be re-fetched to verify; many airline and OTA terms forbid it |
| "Emails of engineers at Stripe" | Instant REJECT (personal data), no CREAO run |
| "Every product on Amazon in category X" | COUNTEROFFER: top N listing pages |

### Surfaces (only two)

1. **ASI:One chat** (Fetch Front Desk). This is the entire customer journey. There is no customer website.
2. **Founder dashboard** (`/web`). Live across laptop and phone through SpacetimeDB subscriptions.

Results are delivered in chat as data: a short table or summary in the message, plus a link to the Apify dataset or JSON export.

### Roles

| Role | Runs on | Decides |
|---|---|---|
| Front Desk | Fetch uAgent + ASI-1 | Parses intent, runs layer-2 checks, quotes, takes payment, classifies post-delivery messages, posts status. No commercial judgment beyond the quote. |
| Buyer agent | Separate Fetch uAgent (its own wallet and customer identity) | A real, independent customer: discovers FORGE on Agentverse, asks for a named API, pays, receives the data. It holds no FORGE keys and no staff role. |
| COO | CREAO saved agent | ACCEPT (existing API or new Tier 0) / COUNTEROFFER / REQUEST_RESEARCH / REJECT (with cited reason) |
| Research | CREAO saved agent + Bright Data SERP/Unlocker | Layer-3 gate findings with citations, sources, measured volatility, confidence. Never a commercial rejection. |
| CFO | CREAO saved agent | Compile / defer / reprice, using repeat buyers, cost per call and build cost. Writes the daily report (scheduled CREAO run). |
| Auditor | CREAO saved agent | Accept/reject each deliverable with a written reason, based on the deterministic check results |
| Treasurer | Reducers (code, not an LLM) | Moves money in the ledger, enforces caps |
| Droid | Factory Droid SDK via `droid-runner` | Compiles Tier 1 Actors and fixes extractor errors inside a worktree |
| Founder | Dashboard (founder identity) | Approvals only (see §5) |

### Addition 1: verified values

Every delivered value is a `value_record`:

```
apiId, organization/entity, metric, value, sourceUrl, excerpt, snapshotKey, snapshotHash, observedAt, verifiedAt,
apiVersion, tier, method, status   // status: extracted | verified | stale | mismatch | unverifiable | corrected
```

1. **Quote anchor (inside the Actor, both tiers):** the excerpt must appear verbatim in the saved page text, and the value must appear verbatim in the excerpt. Otherwise the value is `unverifiable` and is never delivered as a fact.
2. **Independent re-fetch (`verify_values` procedure):** a separate Bright Data Web Unlocker fetch of `sourceUrl`.
   - `stable` API: the excerpt and value must match exactly → `verified`, else `mismatch`.
   - `volatile` API: a match within `freshnessWindowMin` of `observedAt` → `verified`. A changed value with a valid quote anchor → `stale`, with the fresh value attached.
3. Every fetch goes through the **Bright Data fallback ladder** (§7). A value whose page never loads through the ladder is `unverifiable`.
4. The Auditor accepts/rejects with a written reason that cites the check results.
5. Bonuses are paid only for accepted deliverables.

### Addition 2: customer challenge (the fast live demo moment)

The customer writes "row 4 is wrong because…" in chat:

1. The Front Desk calls `open_challenge(orderId, row, reason)`.
2. The `recheck` procedure re-fetches the source within seconds and re-runs the quote anchor against the **saved page**. Both dashboard screens update from the subscription, and the Front Desk posts the fresh quote and the match/mismatch result right away. The Auditor's ruling (step 3) is a CREAO run and lands within minutes; never promise "resolved in seconds."
3. The Auditor resolves it **against what the extractor read**:
   - **Upheld (the extractor misread the saved page):** the value is corrected (a new `value_record` with `status=corrected` supersedes the old one), a test-mode refund is issued, and the responsible bonus is clawed back. A warranty ticket goes to Droid (unpaid). For a Tier 0 API, the warranty ticket is a compile ticket.
   - **Rejected (the saved page said that, and the page changed or the customer is wrong):** the customer gets the saved quote, the fresh value and both timestamps in chat. Nobody is penalized.

### Addition 3: iterating an API

After delivery, the Front Desk classifies each customer message with ASI-1 into exactly one label. If confidence is below `config.classify_min_confidence`, it asks the customer to clarify.

| Label | Example | Handled by | Notes |
|---|---|---|---|
| `challenge` | "row 4 is wrong" | Addition 2 | |
| `enhancement` | "add a seller rating field" | COO → Research → Auditor; Tier 0: a new Task version; Tier 1: CFO → Droid → Auditor → founder approves ship | Additive only |
| `coverage` | "add Best Buy" | COO → Research runs the gate on the new source | Tier 1 needs Droid for a new extractor |
| `format` | "CSV", "only in-stock" | COO | No engineering |
| `question` | | Front Desk answers from order data | |
| `status` | | Front Desk answers from events | |

- Versions are additive only (new fields or sources). The contract test fails the build otherwise.
- Every Tier 1 version passes three tests: (1) the live pages, (2) fixtures (saved Tier 0 pages with their audited values as expected output), (3) the contract test (schema ⊇ the previous version's schema).
- Droid resumes the same session for the same API.
- Every Tier 1 ship and every Tier 0 schema change needs founder approval on the dashboard.
- An improvement reaches every buyer of that API. The Front Desk announces it, e.g. "gpu-listings v1.0 compiled: same fields, 3/3 sources verified, cost per call down from $A to $B (TEST MODE); your feed and N other buyers' feeds now use it."
- The COO can reject requests with a reason.

### Compile triggers (Droid always has real work)

Reducers create a `compile` ticket automatically when any of these hold:

1. An API's verified rate over its last `config.compile_window_runs` runs is below `config.compile_min_verified_rate`.
2. A challenge on a Tier 0 API is upheld because of an extractor error.
3. An API reaches `config.compile_min_buyers` distinct buyers (the CFO reviews; it may defer).

The CFO proposes the investment; `reserve_budget` enforces the cap; the founder approves the ship.

---

## 4. Architecture and repo layout

```
            ASI:One
               │ Chat + Payment Protocol
        /fetch-agents (Python uAgent, mailbox) ── layer-2 gate checks
               │ HTTP API: call reducers, SQL reads
               ▼
 ┌────────────────── SpacetimeDB (Maincloud) /module ──────────────────┐
 │ tables · reducers (rules, Treasurer, compile triggers)               │
 │ procedures (only outbound IO) · schedules · HTTP routes              │
 └───┬──────────────┬───────────────┬──────────────────┬────────────────┘
     │ procedures   │ subscriptions │ reducers         │ routes
     ▼              ▼               ▼                  ▲
 CREAO runs     /web dashboard   /workers/droid-runner  /creao-callback
 Apify Tasks    (laptop+phone)   /workers/canary        /apify-callback
 + Actors                        /skills/forge-cli (used by CREAO agents)
 Bright Data
```

| Path | What | Stack |
|---|---|---|
| `/module` | SpacetimeDB module: tables, reducers, procedures, routes | TypeScript |
| `/web` | Founder dashboard | Vite + React + generated SpacetimeDB bindings (`spacetimedb/react`: `SpacetimeDBProvider`, `useTable`, `useReducer`) |
| `/workers/droid-runner` | Claims compile/enhancement/warranty tasks and drives Droid | Node + TypeScript |
| `/workers/canary` | Scripted end-to-end order on each seeded API | Node + TypeScript |
| `/fetch-agents` | Front Desk uAgent and the buyer agent (two separate agents) | Python, uv |
| `/actors/forge-extract` | The Tier 0 generic Actor (Best Actor entry, built in Apify AI Chat first) | Node |
| `/actors/template` | Tier 1 template: Bright Data fetch, snapshot, quote anchor, output, schemas, test harness; only `extract(page)` is empty | Node |
| `/actors/<api>` | Compiled Tier 1 Actors, one per API | Node |
| `/skills/forge-cli` | Dependency-free CLI + SKILL.md for CREAO agents (also published as a public GitHub repo) | Node built-ins only |
| `/docs` | Reference PDFs, after-hackathon ideas, proof assets | |

---

## 5. Data model, reducers, procedures, routes

All ids are `t.u64().primaryKey().autoInc()`. Money is integer cents. Times are `t.timestamp()`. Public tables are subscribable by the dashboard; private tables are reachable only through reducers and procedures.

| Table | Key fields | Public |
|---|---|---|
| `config` | key, value: every founder lever in §8 (concurrency, refund limit, page cap, blocked domains, confidence threshold, compile thresholds, markup, bonus rates) plus flags and prices | yes |
| `staff` | identity, role (`founder`/`front_desk`/`coo`/`research`/`cfo`/`auditor`/`droid_runner`/`canary`) | yes |
| `customer` | identity, asiSender, createdAt | yes |
| `api` | name, description, inputs, sources, outputSchema (JSON), volatility, freshnessWindowMin, pageCap, tier, currentVersionId, buyerCount, verifiedRate, costPerCallCents | yes |
| `api_version` | apiId, version, tier, engine (`task`/`actor`), apifyId, fields (JSON), droidSessionId, testsPassed, shippedAt | yes |
| `gate_check` | orderId/ticketId, check, result (`pass`/`fail`/`unclear`), citationUrl, citationText, at | yes |
| `order` | customerId, apiId, params (JSON), priceCents, status, apiVersionId, datasetUrl | yes |
| `ticket` | orderId/apiId, label (§3 Addition 3 + `compile`/`warranty`), text, confidence, status | yes |
| `task` | kind, orderId/ticketId, role, status, leaseOwner, leaseUntil, attempt, input/output (JSON) | yes |
| `value_record` | §3 Addition 1 fields, row, supersedesId | yes |
| `evidence` | valueRecordId, url, country, httpStatus, attempt, ms, matched, snapshotHash, fetchedAt (one row per Bright Data attempt) | yes |
| `challenge` | orderId, valueRecordId, reason, status, verdict, auditorReason | yes |
| `approval` | kind (`spend_over_cap`/`api_ship`/`droid_action`/`refund_over_limit`), refId, amountCents, detail, status, decidedAt | yes |
| `budget` | name (`engineering`), capCents, reservedCents, spentCents | yes |
| `bonus` | role, taskId, amountCents, status (`accrued`/`paid`/`clawed_back`) | yes |
| `event` | at, actor, kind, refType, refId, payload (JSON). Append-only. Drives the dashboard and the replay. | yes |
| `run` | provider (`creao`/`apify`/`brightdata`/`droid`), externalId, taskId, threadId, status, shareUrl, costCents, startedAt, endedAt | yes |
| `ledger` | txId, account, amountCents (signed), memo, at. Double-entry. | **private** |
| `callback_token` | token, provider, runRef, usedAt | **private** |
| `*_schedule` | one per scheduled procedure/reducer: `dispatch_schedule`, `lease_sweep_schedule`, `books_check_schedule`, `order_poll_schedule` | private |

**Ledger accounts:** `treasury`, `customer:<orderId>`, `seat:<role>`, `vendor:brightdata`, `vendor:apify`, `vendor:llm`, `budget:engineering`. Each `txId`'s entries sum to zero. `books_check` (scheduled) asserts that the sum across all rows is zero and emits an `event` if it is not. `api.costPerCallCents` is computed from measured vendor entries per run. The dashboard Books view reads a public summary that the Treasurer reducers maintain, never the raw ledger.

### Reducers (rules live here)

Every reducer first checks `staff` for `ctx.sender`'s role and throws `SenderError` on a violation. Every state change also appends an `event`.

| Reducer | Caller | Effect |
|---|---|---|
| `register_customer`, `create_order`, `record_payment` | front_desk | Creates the order. Payment moves it to `paid` and enqueues a `coo_triage` task. |
| `reject_at_desk(reason, check)` | front_desk | Layer-2 rejection: records the `gate_check` and the reason; no task is queued |
| `open_ticket`, `open_challenge` | front_desk | Creates the ticket/challenge and enqueues the next task |
| `claim_task(kind)` | any worker role | Atomically picks the oldest eligible `queued` task for the caller's role and sets `leaseOwner`/`leaseUntil`. A double claim yields one winner. |
| `complete_task(id, output)` | lease owner | Validates the lease, stores the output, advances the flow |
| `record_gate_check` | research | Stores a layer-3 finding with its citation |
| `coo_decide`, `research_report`, `cfo_propose`, `audit_verdict` | matching CREAO seat | Typed decisions (enums plus reason text). Invalid transitions throw. |
| `create_api(spec)` | coo (after ACCEPT of a new request) | Creates `api` + Tier 0 `api_version`; queues `create_apify_task` |
| `reserve_budget(amount)` | Treasurer (internal) | Fails if `reserved + amount > cap`. Over the cap → an `approval` is created and the compile waits. |
| `set_budget_cap`, `set_config` | founder | Lowering the cap re-evaluates pending compiles; any that no longer fit become `ineligible` immediately. Changing a compile threshold re-runs `check_compile_triggers`. Every lever in §8 must change reducer behavior. |
| `decide_approval(id, approve)` | founder | Only path that unblocks gated actions |
| `accrue_bonus`, `pay_bonus`, `claw_back`, `refund` | Treasurer (internal) | Ledger moves. Refunds over `config.refund_limit` need an approval. |
| `log_droid_event`, `record_api_version` | droid_runner | Streams Droid messages as events and records the new version |
| `check_compile_triggers` (internal, after each audit/challenge) | Treasurer/rules | Opens `compile` tickets per §3 |
| `lease_sweep` (scheduled) | schedule | Requeues tasks whose lease has expired and increments `attempt` |

### Procedures (the only code that calls the outside world)

Pattern, always:

```ts
// 1) read inside a tx, 2) close it, 3) fetch, 4) write inside a new tx. withTx may rerun: keep it deterministic.
const job = ctx.withTx(tx => loadJob(tx, args));
const res = ctx.http.fetch(url, init);            // synchronous; no tx open
ctx.withTx(tx => applyResult(tx, job, res));
```

| Procedure | Calls | Notes |
|---|---|---|
| `dispatch` (scheduled) | CREAO `POST /api/v1/runs` | The only thing that starts CREAO runs. Respects `config.creao_max_concurrency`. Sends `idempotencyKey` and `webhookUrl` with a one-time token. Rework passes the existing `threadId`. |
| `create_apify_task` | Apify Tasks API | Saves the Tier 0 API as a Task of `forge-extract` |
| `start_api_run` | Apify Task or Actor run API | Runs the API's current engine with a webhook to `/apify-callback?token=…` |
| `ingest_api_run` | Apify run + dataset | Re-fetches run status with our key, dedupes on run ID, writes `value_record` rows, books run cost |
| `verify_values` | Bright Data Web Unlocker | Independent re-fetch per §3 Addition 1. Logs every attempt to `evidence`. |
| `recheck` | Bright Data Web Unlocker + Apify key-value store | Challenge path: fresh fetch + saved page. Target: seconds. |
| `research_fetch` | Bright Data SERP + Unlocker, robots.txt | Exposed to the Research agent through the CLI |

### HTTP routes

`/creao-callback` and `/apify-callback`, served at `/v1/database/<db>/route/<path>` (beta, unauthenticated, exact path match; `req.uri` includes the query string, verified on a local server).

- Require a one-time `callback_token`; mark it used.
- Never trust the body. Re-fetch the run status with our key and dedupe on run ID.
- CREAO webhooks are unsigned, retried up to 3x, and cannot reach localhost, so test against Maincloud.

---

## 6. Flows

### A. Existing API (Gate 1)

1. Customer asks in ASI:One. Front Desk parses intent with ASI-1, runs layer-2 checks, matches an existing API, calls `create_order`, quotes, takes test payment → `record_payment`.
2. `dispatch` starts the COO run. The COO reads the order and catalog through the CLI and calls `coo_decide(ACCEPT, apiId)`.
3. `start_api_run` → Apify → `/apify-callback` → `ingest_api_run` writes `value_record`s (`extracted` or `unverifiable`).
4. `verify_values` re-fetches each row → `verified` / `stale` / `mismatch` / `unverifiable`.
5. `dispatch` starts the Auditor with the check results. The Auditor calls `audit_verdict` per deliverable with reasons.
6. Treasurer accrues bonuses for accepted work and books vendor costs. Order → `delivered`. `check_compile_triggers` runs.
7. Front Desk (polling order state) posts the table, statuses and dataset link.

### B. New request (Gate 2)

1. Layer-2 checks pass. COO → `REQUEST_RESEARCH`.
2. Research runs layer 3 (robots.txt, cited terms clause, reachability, measured volatility) and calls `record_gate_check` + `research_report`.
3. COO → ACCEPT (`create_api` → `create_apify_task`), COUNTEROFFER, or REJECT with the cited reason.
4. Continues as flow A from step 3.

### C. Compile (Gate 4)

1. A compile trigger opens a `compile` ticket. CFO → `cfo_propose(compile, amount, rationale: buyers, cost per call, verified rate)`.
2. `reserve_budget`. If it is over the cap, an `approval` is created and the founder decides.
3. `droid-runner` claims the task, copies `/actors/template` into a worktree as `/actors/<api>`, writes fixtures from the API's saved Tier 0 pages and audited values, and runs a Droid session (§7).
4. Tests run (live pages, fixtures, contract). The result goes to the Auditor. **Reject → rework in the same Droid session → accept.**
5. `approval(api_ship)`. The founder approves. The worker runs `apify push` and calls `record_api_version(tier=1)`.
6. The next order on that API runs Tier 1. The Front Desk announces the new version and cost per call to every buyer. **The buyer agent** finds `gpu-listings` on Agentverse, pays through the Payment Protocol and receives the data at the lower cost per call, with no new build.

### D. Challenge (Gate 2)

`open_challenge` → `recheck` (seconds; fresh quote posted immediately) → Auditor (minutes) `audit_verdict` judged against the saved page → upheld: corrected record + `refund` + `claw_back` + warranty/compile ticket / rejected: saved quote + fresh value + timestamps in chat.

### E. Iteration tickets (Gate 5)

Front Desk classifies → `open_ticket(label)` → routes per the Addition 3 table. Tier 1 changes go through flow C steps 3–5 with the three tests. On ship, the Front Desk announces it to every buyer of that API.

---

## 7. Per-sponsor build guide

Shapes below were checked against the packages and docs on Oct 24 (`spacetimedb` 2.13, `@factory/droid-sdk` 0.10, `apify` 3.7, `uagents` 0.26.1). Anything still marked **verify** is not confirmed.

### SpacetimeDB (`/module`)

- TypeScript module on Maincloud (`spacetimedb` 2.13). Bindings: `spacetime generate --lang typescript --out-dir web/src/module_bindings -p module`.
- Lifecycle: `export const init = spacetimedb.init(ctx => …)` (seeds config, founder staff row = the publisher's identity), `spacetimedb.clientConnected`, `spacetimedb.clientDisconnected`. Lifecycle hooks must be exported.
- Every named export of the module must be a SpacetimeDB export (reducer, procedure, route, hook). Keep helpers and constants unexported.
- Module env values: declare them in `schema({...}, { env: { KEY: t.string() } })`, read `ctx.env.KEY`, supply them at publish time (`KEY=… spacetime publish`). A reset (`--delete-data=always`) wipes them, so re-set them after a wipe.
- Workers and the Fetch agent use the HTTP API: `POST /v1/identity` → `{identity, token}`; `POST /v1/database/<db>/call/<reducer>` with a **JSON array** of args in parameter order and `Authorization: Bearer <token>`; `POST /v1/database/<db>/sql` with raw SQL text. Each holds its own identity, mapped to a role in `staff`. Verified against a local server (`module/test/api.test.mjs`):
  - An `Identity` argument is passed as `{"__identity__": "0x<hex>"}`.
  - SQL column names come back snake_case (`lease_owner`, `ref_type`).
  - A `SenderError` comes back as HTTP 530 with the message as the body.
- Optional columns are `t.option(t.u64())` (values are `T | undefined`). `u64` values are `bigint`.
- No timestamp arithmetic helper: `new Timestamp(ts.microsSinceUnixEpoch + BigInt(ms) * 1000n)`.

```ts
import { schema, table, t, SenderError, Router, SyncResponse } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';

const task = table({ name: 'task', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  kind: t.string().index('btree'), role: t.string(), status: t.string(),
  leaseOwner: t.option(t.identity()), leaseUntil: t.option(t.timestamp()), attempt: t.u32(),
});
const leaseSweepSchedule = table({ name: 'lease_sweep_schedule' },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() });
const spacetimedb = schema({ task, leaseSweepSchedule /* , ... */ });
export default spacetimedb;

// Scheduled functions bind with `onSchedule` and take the schedule row as their one argument.
export const lease_sweep = spacetimedb.reducer({ onSchedule: leaseSweepSchedule },
  { arg: leaseSweepSchedule.rowType }, (ctx, _args) => { /* ... */ });
// seed in init: ctx.db.leaseSweepSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(15_000_000n) });

// Procedures are synchronous. They have no ctx.db: read and write through ctx.withTx.
export const recheck = spacetimedb.procedure({ valueRecordId: t.u64() }, t.unit(), (ctx, { valueRecordId }) => {
  const rec = ctx.withTx(tx => tx.db.valueRecord.id.find(valueRecordId));
  const res = ctx.http.fetch('https://api.brightdata.com/request', { method: 'POST', /* ... */ }); // throws on network failure
  ctx.withTx(tx => applyRecheck(tx, rec, res));
  return {};
});

// Routes: handlers have no ctx.db and no ctx.sender. req.uri includes the query string.
export const apify_callback = spacetimedb.httpHandler((ctx, req) => {
  ctx.withTx(tx => { /* check the one-time token, then record */ });
  return new SyncResponse('ok', { status: 200 });
});
export const routes = spacetimedb.httpRouter(new Router().post('/apify-callback', apify_callback));
```

### CREAO (`/skills/forge-cli`, agent setup)

- Four saved agents: COO, Research, CFO, Auditor. Each has structured inputs, autonomy **Auto**, and its own seat token (a SpacetimeDB identity token) stored in CREAO Secrets.
- Agents never start other agents. Only the `dispatch` procedure starts runs.
- Agents act only through `forge-cli`. Its commands map 1:1 to the reducers for that seat plus read-only SQL: `forge order <id>`, `forge catalog`, `forge decide …`, `forge research-fetch <url>`, `forge robots <url>`, `forge gate-check …`, `forge create-api …`, `forge report …`, `forge verdict …`. Node built-in `fetch` only, no packages, because packages installed during a run are not saved. (To persist an environment, use Create Agent / Update Environment.)
- The Research prompt requires a quoted terms clause and URL for every terms finding; "unclear" is a valid answer.
- Rework continues the same `threadId`.
- The CFO's daily report is a CREAO scheduled run that writes to the dashboard through `forge report`.
- API: base `https://agent.creao.ai`, `Authorization: Bearer capi_…`. The key is an **account** key (agent.creao.ai → Settings → API keys), so it runs every agent on the account. Agents are created in the browser (chat, then **Create Agent**); their `appId` goes in `.env` as `CREAO_APP_ID_<ROLE>`. Do not use developer.creao.ai: it is the `/v2` platform with a separate USD wallet, and its agents do not appear on agent.creao.ai. Gate 0 verified Sat Oct 24: FORGE Probe (`CREAO_APP_ID_PROBE`) ran through `creao_start`, the webhook landed on Maincloud and the run was re-fetched, 22 s total.
  - `POST /api/v1/runs` `{appId, inputs, webhookUrl, threadId, idempotencyKey (8–128 chars)}`
  - `GET /api/v1/runs/{id}`, `POST /api/v1/runs/{id}/cancel`
  - Result: `{runId, status, threadId, result: {text, chatText, artifacts[]}}`. Runs take minutes and do not stream.

```js
// skills/forge-cli/forge.mjs: zero dependencies
const [cmd, ...args] = process.argv.slice(2);
const db = process.env.FORGE_DB_URL, token = process.env.FORGE_SEAT_TOKEN;
const call = (reducer, body) => fetch(`${db}/call/${reducer}`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(r => { if (!r.ok) throw new Error(`${reducer}: ${r.status}`); return r.text(); });
```

### Factory Droid (`/workers/droid-runner`)

- `@factory/droid-sdk` 0.10 (`/node` subpath). It spawns the `droid` CLI from `PATH`, so the `droid-runner` host needs `droid` installed. Reads `FACTORY_API_KEY`.
- Claims `compile` / `enhancement` / `warranty` tasks through `claim_task`. Creates a worktree with `/actors/template` copied to `/actors/<api>` (no secrets). Writes fixtures from the API's saved Tier 0 pages and audited values.
- The ticket prompt is narrow: "implement `extract(page)` so fixtures, live and contract tests pass; do not change the template plumbing."
- Droid runs locally: the SDK spawns the `droid` CLI on the worker host and tools run in the worktree; only model calls go to Factory.
- Lockdown (`src/lockdown.ts`, verified Gate 0): sessions inherit the host's global tools (MCP, web, Task, Script), so `disabledToolIds` removes everything except Read, LS, Glob, Grep, Create, Edit, ApplyPatch, TodoWrite. Force `toolExecutionMode: 'direct_only'` at session init (the SDK doesn't forward it; patched in `lockdown.ts`), otherwise calls go through one opaque `Script` tool.
- Autonomy **Low**. At Off the CLI hides Create/Edit (read-only); at Low it auto-runs any `Execute` command the model rates low-risk (it ran `curl`). So `Execute` is disabled and shell commands go only through our SDK MCP tool `run_command` (`src/runTool.ts`), which applies `policy.ts`: tests and local fixture runs auto-allowed; network, deploy, secrets denied; anything else needs `approval(droid_action)`. `permissionHandler` applies the same policy to whatever the CLI still asks about.
- Every streamed message (`assistant`, `tool_call`, `tool_result`, `error`, `result`) is logged with `log_droid_event`.
- Follow-ups on the same API use `resumeSession(id)` (`session.id` is stored on `api_version.droidSessionId`). `resumeSession` reuses the original cwd, so keep the worktree path stable per API.
- The worker, never Droid, runs `apify push`, and only after `api_ship` is approved.
- Every tool call is logged with its outcome (`auto-allowed`, `denied`, `founder-approved`) so the Engineering tab can badge it.
- README includes a control table: trigger | allowed tools | denied tools | needs approval | where it's visible.

```ts
import { createLockedSession } from './lockdown.ts';
const { session } = await createLockedSession({
  cwd: worktree,
  onCommand: (d) => logDroidEvent(task.id, { kind: 'tool_decision', ...d }), // badge: auto-allowed / denied / needs-approval
  permissionHandler: policyHandler(worktree),
});
try { for await (const msg of session.stream(compilePrompt(task))) await logDroidEvent(task.id, msg); }
finally { await session.close(); }
```

### Fetch (`/fetch-agents`)

- Front Desk uAgent: Chat Protocol, mailbox, published manifest, Agentverse listing, Innovation Lab category.
- ASI-1 parses intent and classifies tickets. The agent runs layer-2 gate checks, then quotes, counteroffers or rejects.
- Payment Protocol as seller: Stripe test mode (`Funds(currency="USD", amount="1.00", payment_method="stripe")`, `metadata.stripe = {ui_mode: "embedded", publishable_key, client_secret, checkout_session_id, currency, amount_cents}` with every value a string; `CommitPayment.transaction_id` is the checkout session id). Confirm by `stripe.checkout.Session.retrieve(id).payment_status == "paid"`. The secret key never goes in metadata. Test card 4242 4242 4242 4242. Fallback: FET testnet.
- Map each ASI:One sender to its own SpacetimeDB `customer`.
- Poll order state and post progress. Never end the session while an order is open.
- Gate 0 test: do delayed (agent-initiated) messages appear in ASI:One? If not, fall back to on-demand `status`.
- Use interactive cards if supported (**verify**).
- **Buyer agent** (`/fetch-agents/buyer`): a second uAgent with its own seed and test wallet. It searches Agentverse for a data seller, finds the Front Desk, sends a Chat Protocol request for a named API, and handles `RequestPayment` → `CommitPayment` as the buyer (`Protocol(spec=payment_protocol_spec, role="buyer")`; discovery via `POST https://agentverse.ai/v1/search/agents` with an Agentverse API key). It then reads the delivered dataset and logs what it bought. A single script run is enough; it doesn't need to stay online. The Front Desk treats it like any other customer: no shortcuts.

```python
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent, chat_protocol_spec
from uagents_core.contrib.protocols.payment import (
    Funds, RequestPayment, CommitPayment, RejectPayment, CompletePayment, CancelPayment, payment_protocol_spec)

agent = Agent(name="forge-front-desk", seed=SEED, port=8001, mailbox=True, publish_agent_details=True)
chat = Protocol(spec=chat_protocol_spec)
pay = Protocol(spec=payment_protocol_spec, role="seller")

@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id, timestamp=now()))
    ...  # ASI-1 parse → layer-2 checks → reducer call → reply

@agent.on_interval(period=10.0)
async def post_progress(ctx: Context): ...  # SQL poll of open orders → message the customer

agent.include(chat, publish_manifest=True)
agent.include(pay, publish_manifest=True)
```

### Apify (`/actors`)

- **`forge-extract` (Tier 0, Best Actor entry):** build it in Apify AI Chat first, then pull it into `/actors/forge-extract`.
  - Input: `sources` (URLs or a search query), `outputSchema` (JSON Schema), `pageCap`, `render` (Unlocker or Browser API).
  - For each page: fetch through Bright Data, save the page text to the key-value store (`snapshotKey`, `snapshotHash`), ask the extraction LLM for `{field, value, excerpt}` per value, run the quote anchor, and push one dataset item per value.
  - Extraction LLM: **Claude Haiku 5.5** (`claude-haiku-5-5`), picked by the founder on the Gate 0 measurement (299/305 verified across all 3 targets; ASI-1 hit its output limit on gpu-listings). One choice, no fallback. Key stored as an Apify secret env var.
  - Pitch it as "verified extraction": every value has a verbatim quote, a saved page and a status. It never invents a value.
- **Tier 0 APIs** are Apify Tasks of `forge-extract` (Tasks API: `POST /v2/actor-tasks` `{actId, name, input, options}`, `POST /v2/actor-tasks/{id}/runs`, where the body overrides input fields).
- **Tier 1 APIs** are Actors built from `/actors/template` with versions recorded.
- Run: `POST /v2/actors/{username~actor}/runs?webhooks=<base64 JSON array>` with `Authorization: Bearer <token>`. Status: `GET /v2/actor-runs/{id}`; `usageTotalUsd` is the run cost, and it can be preliminary right after the run ends, so re-fetch about 10 s later before booking it. Items: `GET /v2/datasets/{id}/items?clean=1`. Saved pages: `GET /v2/key-value-stores/{id}/records/{key}?attachment=1` (raw bytes, needed for hash checks).
- Actor layout: `.actor/actor.json` (env vars reference secrets as `"@name"`), `.actor/input_schema.json`, `Dockerfile` from `apify/actor-node:24` with corepack pnpm. Deploy with `pnpm exec apify push` (the Apify CLI is a root dev dependency).
- Store listing for `forge-extract` with pay-per-event pricing is a founder task.

```js
// shared by forge-extract and /actors/template: the quote anchor
const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
export const anchored = (pageText, excerpt, value) =>
  norm(pageText).includes(norm(excerpt)) && norm(excerpt).includes(norm(String(value)));
// status = anchored(...) ? 'extracted' : 'unverifiable'
```

### Bright Data

| Product | Used for |
|---|---|
| SERP API | Research discovery and search-based sources: a Google search URL with `&brd_json=1` |
| Web Unlocker | Actor retrieval, the gate's reachability and volatility checks, independent verification/recheck |
| Browser API | JS-rendered pages: Playwright `chromium.connectOverCDP(wssUrl)` |

```
POST https://api.brightdata.com/request
Authorization: Bearer <key>
{ "zone": "<unlocker zone>", "url": "<page>", "format": "raw", "country": "us" }
```

**Fallback ladder** (one function in `/actors/template`, also used by `forge-extract` and `verify_values`):

1. Web Unlocker, `country: us`, bounded timeout.
2. If the response is empty, too short, or a JS shell (expected text markers missing): **Browser API** with a rendered page.
3. If blocked (403/429/CAPTCHA page) or timed out: repeat the failed step once from another country.
4. Still failing: `unverifiable`, with the reason. Never invent a value.

Bright Data reports its own failures as **HTTP 200 with an empty body** and the reason in the `x-brd-error` response header. A compliance block ("target site requires special permission … compliance policy", e.g. `boards.greenhouse.io` and `job-boards.greenhouse.io` without KYC) ends the ladder at once: no Browser API, no country retry. Other `x-brd-error` values are treated as blocked (country retry). Measured Oct 24: `boards-api.greenhouse.io` (the public Greenhouse JSON API) is allowed, so `open-roles` uses it.

Zones are created with `POST https://api.brightdata.com/zone` (needs an Admin/Ops API key): Web Unlocker `{zone: {name, type: "unblocker"}, plan: {type: "unblocker"}}`, SERP `{zone: {name, type: "serp"}, plan: {type: "unblocker", serp: true}}`. Project zones: `forge_unlocker`, `forge_serp`.

Log every rung to `evidence`: method (`unlocker`/`browser`), status, country, ms, and why the ladder moved up.

### Coinbase (only if eligible; first to cut)

x402 pay-per-call access to a named API. Nothing else.

---

## 8. Dashboard spec (`/web`)

Everything renders from subscriptions; nothing animates without a state change. Every animation is driven by an `event` row. This section is the contract. The component-level detail (copy, the event→sentence map, org-chart edge counts, verification protocol, order of work) is in [`docs/dashboard-redesign-spec.md`](docs/dashboard-redesign-spec.md), which is binding for `/web` and must stay consistent with this section. Where either differs from §2, §2 wins.

### What the screen must answer

A judge looks at the dashboard for about 15 seconds. In that time, without reading JSON, it must answer: what did the customer ask for, which employee owns it now, what did each employee decide and why, is the founder needed, and why is engineering happening. The CREAO track's "win if" is an org chart of agents that hand work to each other, so the handoffs are shown and counted, not implied.

Three levels of detail, always:

| Level | Content | Where |
|---|---|---|
| At a glance | request, owner, outcome, founder action needed | header, order headline, forge floor, Needs-you rail |
| One click | decision, reason, evidence, next employee | feed sentence, station drawer, org-chart node card |
| Proof | CREAO run link, quotes, Bright Data attempts, diff, tests, raw event JSON | expanders inside drawers and feed rows |

### Desktop layout

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FORGE · a one-person company   TEST MODE                                                                           Founder  ● LIVE  ⚙ │
│ revenue · verified % · cost / call · APIs for sale · agent decisions N : founder approvals M                                          │
│ Order headline: #id · api for params  [status in words]  k/n verified  $price TEST MODE (· SIMULATED PAYMENT)  elapsed  customer      │
├────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────┤
│ Orders  ● n running · n unpaid quotes   [#205][#202][#199]…  search    │ NEEDS YOU                                                    │
│ ☐ Show test traffic                                                    │ pending approvals as plain-language cards, Approve / Reject  │
│                                                                        │ empty state: "Nothing is waiting on the founder."            │
│ Main panel (70%)                                                       ├──────────────────────────────────────────────────────────────┤
│ tabs: Office (default) · Org chart · Catalog · Engineering             │ FEED   This order | Company                                  │
│                                                                        │ one sentence per event: time, avatar, actor, sentence, link, │
│ Office = the selected order on the forge floor (see below);            │ ▸ raw JSON expander · plumbing folded · failures always shown│
│ station drawers open over it                                           ├──────────────────────────────────────────────────────────────┤
│                                                                        │ DROID  one sentence from the newest compile job       Open → │
└────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────┘
```

- **Header** shows numbers only: revenue, verified %, cost per call, APIs for sale, and the pair `agent decisions N : founder approvals M`, all counted over stored rows in the visible scope (a rework counts twice; the tooltip says so). Money is labeled TEST MODE. On the right: a connection dot, `LIVE`, a Founder or Viewer chip and the gear that opens Controls. Nothing else: no treasury, no budget triple, no open-orders count, no database name, no identity hash, no "connected" text. Events render as feed sentences, never as header tickers.
- **Visible scope.** Default views show real orders only: the customer's `asiSender` starts with `agent1q` (ASI:One users and the buyer agent) and the order is not a canary. `Show test traffic` (off by default) reveals the rest, each row badged `TEST TRAFFIC`. Retired APIs hide behind `Show retired`. Header numbers, feed, org-chart counts and catalog follow the scope. Display filters only; nothing is deleted, and the raw payload stays reachable in the expanders.
- **Right rail** (30%) is live, always, in fixed order: Needs you, the feed, the Droid strip. The feed is scoped to the selected order by default and company-wide on a toggle. Every row is a sentence from a kind→template map with the actor's avatar, a run or dataset link where one exists, and a `▸` expander with the raw payload. Plumbing rows (task bookkeeping, run costs, Droid messages) fold behind one "Show N more" row; failures always show. A kind with no template renders through a fallback and is never dropped.
- **Approvals** (ship, spend over cap, `droid_action`, refund over limit) are cards in the Needs-you rail: a plain-language title, who asked and when, the amount with TEST MODE, one line of consequence, Approve / Reject. The buttons call `decide_approval` under the founder identity; other identities see them disabled with "Founder identity required". Empty state: "Nothing is waiting on the founder."
- **Labels.** Live data carries `LIVE`. A finished compile job carries `RECORDED` with its own timestamps. A client-side replay, if one is ever built, carries `REPLAY`, keeps the original timestamps and calls no reducers or procedures. Simulated payments carry `SIMULATED PAYMENT`. The words "sleeping", "projected" and "guaranteed" appear nowhere.
- **Run links.** A CREAO decision links to its `run` row: `shareUrl` when set, else the thread URL labeled as needing an account login, else the text "no run link recorded". Never a dead button.
- **Replay bar** (scrubber, speeds) is out of scope (§12 item 7). The compile centerpiece is the Engineering tab's recorded timeline of the real `open-roles` compile (ticket #6). §9 still describes a replay bar and a `gpu-listings` compile; read it with this section until the founder updates it.

| Main-panel tab | Shows | Founder actions |
|---|---|---|
| Office | The selected order on the forge floor: one station per role, packets moving per event, one caption per station. The order picker sits above it (newest real orders as chips, search, `Show test traffic`) and the order headline above the tabs. A station drawer leads with the employee's decision card: decision, reason verbatim, evidence, next station, CREAO run link. Evidence tables stay for the Apify, Verify and Delivered stations | none |
| Org chart | The track's "win if" screen. Founder at the top; Front Desk and COO; Research, Auditor and CFO; Droid and the Apify warehouse; Treasurer and Rules as a reducer footer. Each node: avatar, one-line responsibility, `runs on` sponsor chip, live status from `task` rows, decisions count. Each edge: a label and a count from stored events (paid orders handed over, research requested, builds funded, publish approvals requested…). Clicking a node opens a card with its last three decisions; clicking an edge filters the company feed | none |
| Catalog | Live APIs as cards: tier (bronze Tier 0 / gold Tier 1), version and engine, verified rate, buyers, cost per call (measured, TEST MODE), volatility, sources, fields, latest dataset, engineering status. Retired APIs behind `Show retired (N)` | none |
| Engineering | One compile job at a time as a recorded timeline: trigger → CFO decision → budget → each attempt (session created or resumed, prompt, tool calls badged auto-allowed / denied / founder-approved / needs-approval, files changed, each test) → Auditor verdict → founder approval → ship → cost per call before and after, measured only. `RECORDED` for finished jobs, `LIVE` otherwise. Separate steps stay separate: a passed test, an Auditor acceptance, a founder approval and a ship are four events | `Close compile` |
| Controls (gear modal) | The founder levers below. Four primary: budget cap, `compile_min_buyers`, `creao_max_concurrency`, `refund_limit`, each with its current value and one effect sentence. The rest under `Advanced` | Change any lever |

There is no Books tab: revenue and cost per call live in the header and the catalog, and the Treasurer station drawer keeps the cost summary.

### Founder controls

Every lever is a founder-only reducer call and has a real effect in reducer logic. A lever that only moves a number is not allowed. The Controls modal surfaces the first four as primary levers and the rest under `Advanced`.

| Lever | Effect |
|---|---|
| Engineering budget cap (`set_budget_cap`) | Re-evaluates pending compiles. Ones that no longer fit become `ineligible`; a CFO proposal over the cap becomes an approval. |
| Compile triggers: `compile_min_buyers`, `compile_min_verified_rate`, `compile_window_runs` | `check_compile_triggers` re-runs on change. An API that now meets a trigger gets a compile ticket immediately, and Droid wakes. |
| `creao_max_concurrency` | How many CREAO runs `dispatch` starts at once. Lower it and tasks queue at the stations. |
| `refund_limit` | Refunds above it become approval cards |
| `page_cap` | Larger requests get a COUNTEROFFER at the desk |
| `blocked_domains` | Instant gate rejections |
| `classify_min_confidence` | How often the Front Desk asks the customer to clarify |
| `markup_pct` | The COO's quotes; the CFO's payback math on compiles |
| `bonus_rate.<role>` | What the Treasurer accrues on the next accepted deliverable |
| Approvals | Whether a gated action happens at all |

Demo use: in the pitch, only the budget cap. At sponsor tables, also `compile_min_buyers` (it wakes Droid on a business rule).

### Visual style

Playful and game-like, themed on the product's own name: **a forge floor**, drawn in 2.5D isometric or board-game style (not pixel art, not a town). The org-chart hierarchy is kept: founder at the top, COO below, departments under it.

| Role | Station |
|---|---|
| Orders | Glowing work orders arriving on a conveyor |
| COO | The dispatcher's desk |
| Research | A scout who leaves through the Bright Data portal to the web |
| CFO | A vault with a budget gauge that visibly drains |
| Auditor | An inspection gate that stamps ACCEPT / REJECT |
| Droid | The engineer's bench: a compile is forging a tool (sparks, then a new item on the shelf) |
| Apify | The warehouse shelf of APIs (bronze Tier 0, gold Tier 1) |
| Buyer agent | An outside customer arriving at the counter |

Built with React + SVG + Framer Motion; no game engine. The skin is required: it is how the demo explains the company at a glance. It also has to read on a projector, so:

- Per station: the name, one caption line (at most 26 characters; the full text lives in the drawer), a state badge with a glyph (✓ ✕ ! ●) and the stamp. No durations, no second caption, no legend row.
- Sponsor tags on the floor are muted monochrome text. Sponsor colors appear only in drawer headers, the org chart's `runs on` chips and the catalog's tier badges. State colors are the only saturated colors on the floor.
- Every role has an avatar: a 22 px disc with two-letter initials in the role's accent color. The same component renders on the floor, in feed rows, in drawers and in the org chart; it is the thread that connects the four screens.
- The back office (CFO, Droid, Treasurer) sits on its own platform labeled `BACK OFFICE · improves the catalog, not this order`, with a dashed `ships new versions` pipe from Droid to the warehouse that lights on a ship. Idle back-office stations dim.

### Phone layout (second device)

Stacked: the header (four numbers, wrapping), Needs you, the order headline, the Pipeline list in place of the floor, then the feed. No floor and no org chart; the catalog is a vertical list; drawers are bottom sheets. Both devices run the same build against the same subscriptions.
---

## 9. Demo script (3 minutes + 2 minutes Q&A)

**Rule:** anything that finishes in seconds is live. Anything that takes minutes is either started live and left running in the background, or shown as a labeled replay of a real run. Never present a replay as live.

**Before judges arrive:** a seeded order already delivered (e.g. `open-roles`), the founder's phone with ASI:One open in a chat with the Front Desk, the dashboard in LIVE mode, a printed card with suggested requests ("Open roles by team at Stripe", "RTX GPU listings", "or anything public").

| Time | Action | Mode | Evidence |
|---|---|---|---|
| 0:00–0:30 | Hook. **The judge types a request** on the founder's phone. The Front Desk acknowledges and runs the instant gate checks; the order appears on the laptop dashboard. | Live | Order and `gate_check` rows appear instantly. The rest (CREAO, Apify, verification) keeps running in the background. |
| 0:30–0:45 | Point at the COO station: its run has started | Live | Real CREAO run link |
| 0:45–1:20 | On the seeded delivered order, **the judge challenges any row.** `recheck` fetches the source through Bright Data in seconds; the fresh quote and the code's match/mismatch result appear on both screens and in chat. The Auditor's ruling is a CREAO run and lands within minutes. | Live | Bright Data request log (with ladder steps), saved page vs fresh page, "Auditor reviewing" + run link |
| 1:20–2:20 | Switch the main panel to **REPLAY**: the recorded `gpu-listings` compile. Trigger → CFO invests → Droid fails a test → Auditor rejects → repair → accept → founder approves → Tier 1 → cost per call drops → **the buyer agent finds and buys it.** Scrub or play at 4×. The judge's order keeps moving in the live Events panel. | Replay | Recorded-at timestamp, the Engineering tab (plan, badged tool calls incl. one denied, diff, tests), CREAO run links, Apify versions, cost per call, buyer agent payment |
| 2:20–2:40 | Back to LIVE. The founder lowers the engineering budget; a pending compile becomes ineligible on both screens. | Live | Reducer-driven state change |
| 2:40–3:00 | Close. "Your order is still running. Watch it land." | Live | Delivery in chat during Q&A: table, statuses per row, dataset link; the challenge ruling too |

Close: "One human approved the consequential actions. The company decided what to build, proved every value, and got cheaper with every sale."

- **The judge's request won't match the replay.** That's intended: "When a request needs engineering, this is what happens. Here's the real one from Saturday evening."
- **A new API from the judge** shows "Research is checking…" and lands in chat later. A cited rejection is also a good outcome.
- **Never plant a wrong value** for the challenge. The outcome is whatever the recheck shows.
- **If something live fails** (Wi-Fi, CREAO), show the latest canary run as a labeled REPLAY and say so.

### Sponsor table slices (about 30 seconds each, when sponsors judge separately)

| Sponsor | Show |
|---|---|
| SpacetimeDB | Judge challenges a row → both screens update; budget cut → compile ineligible; double-claim test → one winner |
| Factory | Lower `compile_min_buyers` → ticket opens → "Droid is awake"; the Engineering tab replay with the denied action |
| CREAO | Run links for all four agents; a cited rejection; the CFO's compile decision |
| Bright Data | The ladder in the logs (Unlocker → Browser API → other country → `unverifiable`); a live recheck |
| Apify | `forge-extract`, Tasks per API, the compiled Actor's versions, datasets, a re-run by the buyer agent |
| Fetch | Agentverse listing; an order in ASI:One; the buyer agent's purchase log |

---

## 10. Testing and canary

- **Module:** double-claim test (two identities, one winner), budget cap test, books-sum test, sender-role test per reducer, compile-trigger test.
- **Gate:** personal-data detector and blocked-domain checks have unit tests with real request examples.
- **Actors:** quote-anchor unit test (a hallucinated value must fail); for Tier 1: fixtures, contract test, live-page test (all three required for every version).
- **Routes:** a replayed callback with a used token is rejected; a duplicate run ID is a no-op.
- **Canary (`/workers/canary`):** a scripted end-to-end order on each seeded API through the real reducers, Actors and Bright Data, run before and after every merge to `main`. A failing canary freezes merges until it is fixed. Record pass/fail, verified rate, timing and cost per call; these are the only numbers the README may quote.
- JS checks: `pnpm run build`, `pnpm run typecheck`, `pnpm test`.
- Per §2 rules 15–16: backend features are verified with direct API calls against the deployed services, frontend features in a real browser via `agent-browser`, and each verified feature is committed.

---

## 11. Gates and schedule (PT, recomputed Sat Oct 24, 2:51 PM)

| Gate | Target | Done when | Status |
|---|---|---|---|
| 0 | done | A procedure makes an HTTP call; a route receives a callback; a web client subscribes. One CREAO API run end to end. Front Desk in ASI:One: chat reply, delayed-message test, payment card renders. Droid hello-world in a worktree. Apify and Bright Data smoke tests. **`forge-extract` prototype on 3 real public sites with the verified rate measured.** | done |
| 1 | done | Extraction LLM picked; roles and reducers; seeded APIs chosen; one existing-API order end to end (COO → Task run → verification → Auditor → delivered). **Schema freeze.** | done except the founder's ASI:One order |
| 2 | Sat 6 PM | New-request flow with the full admission gate and real Research through Bright Data. Challenge flow works. | in progress |
| 3 | Sat 7 PM | Full ASI:One order with payment. Dashboard live on two devices. All seeded APIs pass the canary. Open to Cal Hacks hackers (daily cap on). | canary passes; rest pending |
| 4 | Sat 10 PM | Compile path (flow C) on one seeded API, including reject → repair → accept, founder ship approval, measured cost-per-call drop, and a second buyer. Budget-change moment works. | template + droid-runner in progress |
| Skin | Sat 9 PM | Forge-floor skin: per-order factory scene (order picker, stations, pipes, packets driven by events). Required, not cuttable. | in progress |
| 5 | Sun 2 AM | Iteration tickets, Time Machine, cards, x402 if eligible. | not started |
| Cutoff | Sun ~4 AM | Anything in this file still unfinished is dropped or best-effort only, following the cut order (§12). | |
| Submit | Sun 4–8 AM | README, videos, rehearsal (3–4 hours). Submit by **8:15 AM** (Devpost hard deadline 9:00 AM). | |

The goal is everything in this file. If a gate fails, repair that path before adding features.

**Measured so far (Oct 24, `docs/proof/`):** `forge-extract` with Claude Haiku (`claude-haiku-5-5`, tool-use structured output) on the 3 seed sites: 296/302 values verified on an independent Bright Data re-fetch (98%). open-roles 184/190 (page truncated to 60K of 449K chars), yc-directory 5/5, gpu-listings 107/107. ASI-1 not yet measured. The module's 12 API tests pass on Maincloud (`forge`). The `/web` client subscribes on Maincloud; a task enqueued over HTTP appeared in the browser within ~0.75 s with no reload (agent-browser, `docs/proof/web-gate0-after.png`).

---

## 12. Cut order (cut from the top)

1. Coinbase x402
2. Interactive cards
3. CFO scheduled daily report
4. `coverage` and `format` ticket labels (keep `challenge`, `enhancement`, `question`, `status`)
5. Buyer agent (fallback: the second buyer is a second ASI:One user)
6. The Browser API rung of the ladder (keep Unlocker + country retry; reject JS-only sources at the gate)
7. Time Machine scrubbing (keep a plain REPLAY event list)
8. Stripe payment (use the FET testnet fallback, or record an honest TEST MODE "unpaid" quote)

Never cut: the admission gate, `forge-extract` with the quote anchor, a real existing-API order in ASI:One, the four CREAO roles, Bright Data verification, the challenge flow, one real Droid compile, two devices in sync, the forge-floor skin.

---

## 13. Submission checklist

- [ ] Devpost submitted by 8:15 AM Sun with tracks: Factory Droid SDK, Fetch.ai, CREAO: Best One-Person Company (founder's pick; one track only), SpacetimeDB, Apify (+ Best Actor with `forge-extract`), Bright Data, Coinbase x402 (if eligible), Microsoft Built for the Real World, Best Solo Hack.
- [ ] Public GitHub repo. Demo video on Devpost (required).
- [ ] README with one section per sponsor: what it does here, what breaks without it, and where to see it.
- [ ] CREAO: all four agent IDs and run share links in the README; an agent shown running in the demo; one cited rejection and one compile decision linked.
- [ ] Fetch: Front Desk and buyer agent names, addresses and badges in the README; the buyer agent's purchase log; ASI:One submission agent; a separate 3–5 minute Fetch video.
- [ ] Apify: `forge-extract` link and Store listing, Task list, compiled Actor version history; Best Actor entry.
- [ ] Bright Data: products used, sample request logs, an honest `unverifiable` example.
- [ ] Factory: a Droid compile trace (trigger, prompt, steps, diff, tests, rejection, repair, approval), Engineering tab screenshots, the control table.
- [ ] SpacetimeDB: two-device screenshots/clip; the list of reducers and procedures.
- [ ] Only measured numbers (canary results: verified rate, cost per call). TEST MODE labels everywhere.

---

## 14. Open questions (ask at booths; record answers here)

| Who | Question | Answer |
|---|---|---|
| Organizers | Is a solo founder eligible? Student eligibility? | Solo is allowed. Student eligibility not yet confirmed. |
| CREAO | Can one project enter both AI-First Disruptor and One-Person Company? | No. Only one CREAO track per project. Founder picked Best One-Person Company. |
| Fetch | Is data delivered in chat with a dataset link fine? Do delayed messages show in ASI:One? Which payment method renders? | Tested Sat Oct 24: Stripe test mode renders in ASI:One and a 4242 payment completed end to end (CommitPayment → `Session.retrieve` paid → CompletePayment). ASI:One needs `@agent1…` on every message, and its own assistant replies to agent messages, so the Front Desk strips mentions and ignores chatter. Delayed messages: **not shown in ASI:One**. A follow-up sent 69 s after the quote was accepted by Agentverse (`DELIVERED`) but never appeared in the chat. Use the on-demand `status` fallback (§7). Dataset-link delivery: not yet asked. |
| SpacetimeDB | Are procedures and HTTP routes stable on Maincloud this weekend? | |
| Apify | Does an LLM-based generic extractor (with quote verification) qualify for Best Actor? Do Droid-compiled Actors and later edits affect eligibility? Are Tasks a good fit for "an API per request"? | |
| Bright Data | Do the promo credits cover the Browser API? Is a gate that rejects login/paywall/personal-data requests the right reading of your rules? Can our account get KYC for Greenhouse HTML boards? | Greenhouse HTML boards are blocked by Bright Data compliance without KYC (measured Oct 24); the JSON API works. |
| Coinbase | Does the founder (a visa holder living in the US) qualify? | |

### Event facts (checked Fri Oct 23, ~10 PM PT)

- Cal Hacks 13.0, Palace of Fine Arts, SF. Devpost hard deadline Sun Oct 25, 9:00 AM PT (target 8:15 AM). Judging 10:30 AM. Pitch 3 minutes + 2 minutes Q&A. A demo video on Devpost is required.
- Prizes: Factory $2,000 (1 winner; Droid must do real work in the running product). Fetch.ai $1,500 / $1,000 / $500. CREAO Best AI-First Disruptor $2,500 or Best One-Person Company $1,500, one track only (README needs the agent ID and a run share link; rubric: AI as foundation 30%, depth on CREAO 25%, originality 20%, track fit 15%, demo 10%). SpacetimeDB $2,048 / $1,024 / $512. Apify $2,000 / $1,000 / $800 / $400 / $400 + Best Actor $400 (an Actor built in Apify AI Chat for the event). Bright Data: credits + Amazon cards for 3 places (disqualified for login/paywall scraping, non-public personal data, mocked demo data, README-only use). Coinbase Best Use of x402 (if eligible). Microsoft Built for the Real World (README framing only).

---

## 15. Official docs

| Topic | Link |
|---|---|
| Cal Hacks 13.0 Devpost | https://cal-hacks-13-0.devpost.com/ |
| Devpost dates | https://cal-hacks-13-0.devpost.com/details/dates |
| Hacker guide (sponsor tracks) | https://docs.google.com/document/d/1RQrueC9wm5u8uxtWSC2gadIchp05hVayhGUrIjxT9dE/edit?tab=t.0 |
| Prizes / FAQ | https://hive.hackberkeley.org/prizes · https://hive.hackberkeley.org/faq |
| CREAO Cal Hacks guide / tech | https://community.creao.ai/CalHacks2026 · https://community.creao.ai/CalHacks2026/tech |
| CREAO agents | https://docs.creao.ai/features/agents |
| Factory Droid SDK (TS) | https://docs.factory.com/sdk/typescript |
| SpacetimeDB at Cal Hacks | https://spacetimedb.com/blog/spacetime-at-calhacks |
| SpacetimeDB reducers / event tables | https://spacetimedb.com/docs/functions/reducers/ · https://spacetimedb.com/docs/tables/event-tables/ |
| Fetch.ai hackpack | https://www.fetch.ai/events/hackathons/calhacks-13-0/hackpack |
| ASI:One | https://asi1.ai/ |
| Apify Actors | https://docs.apify.com/platform/actors |
| Apify Actor tasks | https://docs.apify.com/platform/actors/running/tasks |
| Bright Data Web Unlocker | https://docs.brightdata.com/products/web-unlocker/introduction |
| Coinbase x402 | https://docs.cdp.coinbase.com/x402/welcome |
