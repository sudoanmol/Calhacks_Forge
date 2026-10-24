# AGENTS.md: FORGE build contract

Every coding agent working in this repo reads this file before writing code. If it conflicts with anything else, this file wins.

- Product base: `docs/reference/FORGE_guide.pdf` (product, roles, story). This file overrides the PDF where they conflict.
- Implementation reference: `docs/reference/Lights_On_v7_build_plan.pdf` (earlier plan with the same sponsors, the challenge flow and the risk controls). Use it only for patterns; everything it scopes out stays out.
- **verify** means the item has not been checked against official docs. Read the docs (Context7 or the links in §15) before you build on it, then remove the marker.

---

## 1. TL;DR

**Pitch.** FORGE is a one-person company staffed by AI agents. Customers hire it through ASI:One chat to deliver verified public company intelligence: SaaS pricing, recent launches, and hiring counts. CREAO employees decide whether to accept, research, counteroffer or invest. When a capability is missing and worth building, Factory Droid builds it into our Apify Actor. Bright Data fetches and independently verifies every value. SpacetimeDB is the company's live state. Agents earn bonuses only on accepted work. Customers can challenge any delivered value and watch the company recheck it in seconds.

**The loop.**

```
ASI:One customer ─▶ Front Desk (Fetch) ─▶ SpacetimeDB order ─▶ COO (CREAO)
   ├─ catalog hit ─▶ Apify Actor run ─▶ Bright Data verify ─▶ Auditor ─▶ delivered in chat
   └─ missing     ─▶ Research ─▶ CFO invests ─▶ Droid builds ─▶ Auditor ─▶ founder approves ship
                        ─▶ new Actor version ─▶ every buyer of that capability gets it
customer: "row 4 is wrong" ─▶ challenge ─▶ recheck ─▶ Auditor ─▶ refund + clawback, or fresh quote
```

**Sponsors.**

| Sponsor | Job in FORGE | What breaks without it | What their judges see |
|---|---|---|---|
| CREAO | COO, Research, CFO, Auditor: all commercial and QA judgment | Nobody decides, researches, invests or audits | Four saved agents, real run share links, COO→Research→CFO→Auditor handoffs, a reject followed by an accept |
| Factory Droid SDK | The runtime engineer that extends the Actor | No new capabilities, no warranty fixes | Ticket-triggered session, allowlist, approval prompt, streamed steps, diff, tests, failed attempt then repair |
| SpacetimeDB | The only database: orders, tasks, budgets, ledger, events | No shared state, no rules, no live dashboard, no replay | Two devices updating together, a budget change blocking a build, a guarded double claim, Time Machine |
| Fetch.ai | Front Desk: the whole customer journey in ASI:One | No customers | Agentverse listing, Chat Protocol order → pay → status → delivery → challenge, all inside ASI:One |
| Apify | The product: one Actor with versions | Nothing to sell or reuse | Actor runs, datasets, version history, a second buyer reusing a capability Droid built |
| Bright Data | Retrieval, research discovery, independent verification | No live data, no verification, no challenge recheck | Request logs with status, retries, country and timing; an honest `unverifiable` |
| Coinbase (if eligible) | x402 pay-per-call access to a delivered feed | Only the x402 feature | One x402 challenge/response purchase |

---

## 2. Rules

1. Never fake a demo moment. No mocked research, no hardcoded values, no staged failures.
2. Replays are labeled **REPLAY**. Anything simulated is labeled **SIMULATED**.
3. All money is test mode and labeled **TEST MODE** everywhere it appears (chat, dashboard, README).
4. Public, company-level data only. No logins, no paywalls, no personal data (job counts only, never names).
5. Keys stay server-side. Use test keys made for this project only. Never commit secrets. `/actor` worktrees contain no secrets.
6. Untrusted input (web pages, agent output, webhook bodies, chat text) never authorizes anything. Only reducers authorize, using `ctx.sender` roles and stored state.
7. Founder approvals happen only through reducer calls from the dashboard under the founder identity.
8. Never make an HTTP call while a transaction is open. Only procedures and workers call the outside world.
9. Never invent a replacement value. If retrieval fails, the value is `unverifiable`.
10. Actor versions are additive only. Never rename or remove an output field.
11. Only measured numbers go in the README.
12. New ideas go in `/docs/after-hackathon.md`, not in code.
13. After Gate 1 the schema is frozen: changes are additive only.
14. Use pnpm for JS (never npm) and uv for Python.

**Not building:** the Lights On ProofPage HTML and its `/p` route, Rush Hour, presence cursors, money ticker, human-decision counter, pause switch, Slack, Gmail, Moss, fact-checker for hire, Droid trust levels, scheduled monitoring/subscriptions, arbitrary-website support, multiple product domains.

---

## 3. Product spec

### Domain: public company intelligence from official sources

| Capability | Source | Fields (v1) | v1 limits |
|---|---|---|---|
| `pricing` | Vendor's official pricing page | plan, list_price, unit, billing_period, free_tier, contact_sales | Default page view only. Prices behind monthly/annual toggles are not read in v1. |
| `changelog` | Official changelog or blog | title, date, url (launches in the last 90 days) | |
| `jobs` | Public Greenhouse, Lever, Ashby job-board APIs | team, location, open_count | Counts only, never names. |

- **Catalog v1** is one Apify Actor with these three capabilities.
- **Honest seeding.** The first real build is toggle support (monthly/annual) using the Bright Data Browser API. v1 genuinely cannot do it, so the first build is real work.

### Surfaces (only two)

1. **ASI:One chat** (Fetch Front Desk). This is the entire customer journey. There is no customer website.
2. **Founder dashboard** (`/web`). Live across laptop and phone through SpacetimeDB subscriptions.

Results are delivered in chat as data: a short table or summary in the message, plus a link to the Apify dataset or JSON export.

### Roles

| Role | Runs on | Decides |
|---|---|---|
| Front Desk | Fetch uAgent + ASI-1 | Parses intent, quotes, takes payment, classifies post-delivery messages, posts status. No commercial judgment beyond the quote. |
| COO | CREAO saved agent | ACCEPT / COUNTEROFFER / REQUEST_RESEARCH / PROPOSE_BUILD / REJECT (with reason) |
| Research | CREAO saved agent + Bright Data SERP/Unlocker | Feasibility findings with sources and confidence. Never a commercial rejection. |
| CFO | CREAO saved agent | Invest / defer / reprice. Writes the daily report (scheduled CREAO run). |
| Auditor | CREAO saved agent | Accept/reject each deliverable with a written reason, based on the deterministic check result |
| Treasurer | Reducers (code, not an LLM) | Moves money in the ledger, enforces caps |
| Droid | Factory Droid SDK via `droid-runner` | Builds, enhances and repairs the Actor inside a worktree |
| Founder | Dashboard (founder identity) | Approvals only (see §5) |

### Addition 1: verified values

Every delivered value is a `value_record`:

```
organization, metric, value, sourceUrl, excerpt, observedAt, verifiedAt,
actorVersion, method, status  // status: extracted | verified | mismatch | unverifiable | corrected
```

- Verification is an independent Bright Data Web Unlocker re-fetch of `sourceUrl` that must contain both the exact `excerpt` and `value`.
- On a blocked, empty or slow page: one retry from a different country with a bounded timeout, then `unverifiable`.
- The Auditor accepts/rejects with a written reason that cites the deterministic check result.
- Bonuses are paid only for accepted deliverables.

### Addition 2: customer challenge (the fast live demo moment)

The customer writes "row 4 is wrong because…" in chat:

1. The Front Desk calls `open_challenge(orderId, row, reason)`.
2. The `recheck` procedure re-fetches the source through Web Unlocker within seconds. Both dashboard screens update from the subscription.
3. The Auditor resolves it:
   - **Upheld:** the value is corrected (new `value_record` with `status=corrected` that supersedes the old one), a test-mode refund is issued, and the responsible bonus is clawed back. If the extractor caused the error, a warranty ticket goes to Droid. Warranty work is unpaid.
   - **Rejected:** the customer gets the fresh quote and timestamp in chat.

### Addition 3: iterating a built API

After delivery, the Front Desk classifies each customer message with ASI-1 into exactly one label. If confidence is below `config.classify_min_confidence`, it asks the customer to clarify.

| Label | Example | Handled by | Notes |
|---|---|---|---|
| `challenge` | "row 4 is wrong" | Addition 2 | |
| `enhancement` | "add monthly price", "add a seats field" | COO → Research → CFO → Droid → Auditor → founder approves ship | |
| `coverage` | "add Linear and Coda" | COO → Research checks feasibility with Bright Data | Droid only if a new extractor is needed |
| `format` | "CSV", "only enterprise plans" | COO | No engineering |
| `question` | | Front Desk answers from order data | |
| `status` | | Front Desk answers from events | |

- Versions are additive only (new fields, companies or sources). The contract test fails the build otherwise.
- Every version passes three tests: (1) the live pages behind the request, (2) saved fixtures that already pass, (3) the contract test.
- Droid resumes the same session for the same capability.
- Every Actor ship needs founder approval on the dashboard.
- An improvement reaches every buyer of that capability. The Front Desk announces it, e.g. "v0.3 shipped: added monthly_price, 3/3 verified; your feed and N other buyers' feeds now include it."
- The COO can reject requests with a reason, e.g. anything that is not public company-level data.

---

## 4. Architecture and repo layout

```
            ASI:One
               │ Chat + Payment Protocol
        /fetch-agents (Python uAgent, mailbox)
               │ HTTP API: call reducers, SQL reads
               ▼
 ┌────────────────── SpacetimeDB (Maincloud) /module ──────────────────┐
 │ tables · reducers (rules, Treasurer) · procedures (only outbound IO) │
 │ schedules (dispatch, lease sweep, books check) · HTTP routes         │
 └───┬──────────────┬───────────────┬──────────────────┬────────────────┘
     │ procedures   │ subscriptions │ reducers         │ routes
     ▼              ▼               ▼                  ▲
 CREAO runs     /web dashboard   /workers/droid-runner  /creao-callback
 Apify runs     (laptop+phone)   /workers/canary        /apify-callback
 Bright Data                     /skills/forge-cli (used by CREAO agents)
```

| Path | What | Stack |
|---|---|---|
| `/module` | SpacetimeDB module: tables, reducers, procedures, routes | TypeScript |
| `/web` | Founder dashboard | Vite + React + generated SpacetimeDB bindings (**verify** SDK package name) |
| `/workers/droid-runner` | Claims build/enhancement/warranty tasks and drives Droid | Node + TypeScript |
| `/workers/canary` | Scripted end-to-end order | Node + TypeScript |
| `/fetch-agents` | Front Desk uAgent (and optional buyer agent later) | Python, uv |
| `/actor` | The Apify Actor: extractors, fixtures, tests, schemas | Node (from Apify AI Chat) |
| `/skills/forge-cli` | Dependency-free CLI + SKILL.md for CREAO agents (also published as a public GitHub repo) | Node built-ins only |
| `/docs` | Reference PDFs, after-hackathon ideas, proof assets | |

---

## 5. Data model, reducers, procedures, routes

All ids are `t.u64().primaryKey().autoInc()`. Money is integer cents. Times are `t.timestamp()`. Public tables are subscribable by the dashboard; private tables are reachable only through reducers and procedures.

| Table | Key fields | Public |
|---|---|---|
| `config` | key, value (flags, caps, prices, concurrency, confidence threshold) | yes |
| `staff` | identity, role (`founder`/`front_desk`/`coo`/`research`/`cfo`/`auditor`/`droid_runner`/`canary`) | yes |
| `customer` | identity, asiSender, createdAt | yes |
| `order` | customerId, capability, scope (JSON), priceCents, status, actorVersionId, datasetUrl | yes |
| `ticket` | orderId, label (§3 Addition 3), text, confidence, status | yes |
| `task` | kind, orderId/ticketId, role, status, leaseOwner, leaseUntil, attempt, input/output (JSON) | yes |
| `capability` | name, currentVersionId, buyerCount | yes |
| `actor_version` | capabilityId, version, fields (JSON), apifyBuildId, droidSessionId, testsPassed, shippedAt | yes |
| `value_record` | orderId, row, organization, metric, value, sourceUrl, excerpt, observedAt, verifiedAt, actorVersion, method, status, supersedesId | yes |
| `evidence` | valueRecordId, url, country, httpStatus, attempt, ms, matched, fetchedAt (one row per Bright Data attempt) | yes |
| `challenge` | orderId, valueRecordId, reason, status, verdict, auditorReason | yes |
| `approval` | kind (`spend_over_cap`/`actor_ship`/`droid_action`/`refund_over_limit`), refId, amountCents, detail, status, decidedAt | yes |
| `budget` | name (`engineering`), capCents, reservedCents, spentCents | yes |
| `bonus` | role, taskId, amountCents, status (`accrued`/`paid`/`clawed_back`) | yes |
| `event` | at, actor, kind, refType, refId, payload (JSON). Append-only. Drives the dashboard and the replay. | yes |
| `run` | provider (`creao`/`apify`/`brightdata`/`droid`), externalId, taskId, threadId, status, shareUrl, startedAt, endedAt | yes |
| `ledger` | txId, account, amountCents (signed), memo, at. Double-entry. | **private** |
| `callback_token` | token, provider, runRef, usedAt | **private** |
| `*_schedule` | one per scheduled procedure/reducer: `dispatch_schedule`, `lease_sweep_schedule`, `books_check_schedule`, `order_poll_schedule` | private |

**Ledger accounts:** `treasury`, `customer:<orderId>`, `seat:<role>`, `vendor:brightdata`, `vendor:apify`, `budget:engineering`. Each `txId`'s entries sum to zero. `books_check` (scheduled) asserts that the sum across all rows is zero and emits an `event` if it is not. The dashboard Books view reads a public summary that the Treasurer reducers maintain, never the raw ledger.

### Reducers (rules live here)

Every reducer first checks `staff` for `ctx.sender`'s role and throws `SenderError` on a violation. Every state change also appends an `event`.

| Reducer | Caller | Effect |
|---|---|---|
| `register_customer`, `create_order`, `record_payment` | front_desk | Creates the order. Payment moves it to `paid` and enqueues a `coo_triage` task. |
| `open_ticket`, `open_challenge` | front_desk | Creates the ticket/challenge and enqueues the next task |
| `claim_task(kind)` | any worker role | Atomically picks the oldest eligible `queued` task for the caller's role and sets `leaseOwner`/`leaseUntil`. A double claim yields one winner. |
| `complete_task(id, output)` | lease owner | Validates the lease, stores the output, advances the flow |
| `coo_decide`, `research_report`, `cfo_propose`, `audit_verdict` | matching CREAO seat | Typed decisions (enums plus reason text). Invalid transitions throw. |
| `reserve_budget(amount)` | Treasurer (internal) | Fails if `reserved + amount > cap`. Over the cap → an `approval` is created and the build waits. |
| `set_budget_cap`, `set_config` | founder | Lowering the cap re-evaluates pending builds; any that no longer fit become `ineligible` immediately. |
| `decide_approval(id, approve)` | founder | Only path that unblocks gated actions |
| `accrue_bonus`, `pay_bonus`, `claw_back`, `refund` | Treasurer (internal) | Ledger moves. Refunds over `config.refund_limit` need an approval. |
| `log_droid_event`, `record_actor_version` | droid_runner | Streams Droid messages as events and records the new version |
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
| `start_actor_run` | Apify run API | Passes the run webhook pointing at `/apify-callback?token=…` |
| `ingest_actor_run` | Apify run + dataset | Re-fetches run status with our key, dedupes on run ID, writes `value_record` rows |
| `verify_values` | Bright Data Web Unlocker | Independent re-fetch, exact quote-and-value match, one retry from another country, then `unverifiable`. Logs every attempt to `evidence`. |
| `recheck` | Bright Data Web Unlocker | Challenge path. Same check as `verify_values`, for one row. Target: seconds. |
| `research_fetch` | Bright Data SERP + Unlocker | Exposed to the Research agent through the CLI |

### HTTP routes

`/creao-callback` and `/apify-callback`, served at `/v1/database/<db>/route/<path>` (beta, unauthenticated, exact match: **verify**).

- Require a one-time `callback_token`; mark it used.
- Never trust the body. Re-fetch the run status with our key and dedupe on run ID.
- CREAO webhooks are unsigned, retried up to 3x, and cannot reach localhost, so test against Maincloud.

---

## 6. Flows

### A. Catalog hit (Gate 1)

1. Customer asks in ASI:One. Front Desk parses intent with ASI-1, calls `create_order`, quotes, and takes test payment → `record_payment`.
2. `dispatch` starts the COO run. The COO reads the order and catalog through the CLI and calls `coo_decide(ACCEPT, capability)`.
3. `start_actor_run` → Apify → `/apify-callback` → `ingest_actor_run` writes `value_record`s (`extracted`).
4. `verify_values` re-fetches each row → `verified` / `mismatch` / `unverifiable`.
5. `dispatch` starts the Auditor with the check results. The Auditor calls `audit_verdict` per deliverable with reasons.
6. Treasurer accrues bonuses for accepted work. Order → `delivered`.
7. Front Desk (polling order state) posts the table, statuses and dataset link.

### B. Build path (Gate 4)

1. COO → `REQUEST_RESEARCH`. Research uses SERP + Unlocker and calls `research_report` (sources, what is achievable, confidence).
2. COO → `PROPOSE_BUILD`. CFO → `cfo_propose(invest, amount, rationale)`.
3. `reserve_budget`. If it is over the cap, an `approval` is created and the founder decides.
4. A `build` task is queued. `droid-runner` claims it, creates a worktree of `/actor`, and runs a Droid session (§7).
5. Tests run (live pages, fixtures, contract). The result goes to the Auditor. **Reject → rework in the same Droid session → accept.**
6. `approval(actor_ship)`. The founder approves. The worker runs `apify push` and calls `record_actor_version`.
7. The order resumes as a catalog hit on the new version. A second buyer orders the same capability and reuses it at no engineering cost.

### C. Challenge (Gate 2)

`open_challenge` → `recheck` (seconds) → Auditor `audit_verdict` → upheld: corrected record + `refund` + `claw_back` (+ warranty ticket if the extractor was at fault) / rejected: fresh quote + timestamp in chat.

### D. Iteration tickets (Gate 5)

Front Desk classifies → `open_ticket(label)` → routes per the Addition 3 table. Every Actor change goes through flow B steps 4–6 with the three tests. On ship, the Front Desk posts the announcement to every buyer of that capability.

---

## 7. Per-sponsor build guide

All shapes below are **verify** until checked against the docs in §15.

### SpacetimeDB (`/module`)

- TypeScript module on Maincloud. Bindings: `spacetime generate --lang typescript`.
- Lifecycle reducers: `init` (seed config, founder staff row), `clientConnected`, `clientDisconnected`.
- Module env values via `ctx.env`. `--delete-data` wipes them, so re-set them after a wipe.
- Workers and the Fetch agent use the HTTP API: `POST /v1/identity`, `/v1/database/<db>/call/<reducer>`, `/v1/database/<db>/sql`. Each holds its own identity, mapped to a role in `staff`.

```ts
import { schema, table, t, SenderError } from 'spacetimedb/server'; // verify import path
import { ScheduleAt } from 'spacetimedb';

const task = table({ name: 'task', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  kind: t.string(), role: t.string(), status: t.string(),
  leaseOwner: t.identity().optional(), leaseUntil: t.timestamp().optional(), attempt: t.u32(),
});
const lease_sweep_schedule = table(
  { name: 'lease_sweep_schedule', scheduled: 'lease_sweep' },          // verify onSchedule option name
  { id: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() },
);
const spacetimedb = schema({ task, lease_sweep_schedule /* , ... */ });
export default spacetimedb;

export const claim_task = spacetimedb.reducer({ kind: t.string() }, (ctx, { kind }) => {
  const role = roleOf(ctx, ctx.sender);
  if (!role) throw new SenderError('unknown identity');
  const next = [...ctx.db.task.iter()]
    .filter(r => r.kind === kind && r.role === role && r.status === 'queued')
    .sort((a, b) => Number(a.id - b.id))[0];
  if (!next) return;
  ctx.db.task.id.update({ ...next, status: 'claimed', leaseOwner: ctx.sender,
    leaseUntil: addMs(ctx.timestamp, LEASE_MS), attempt: next.attempt + 1 });
});

export const recheck = spacetimedb.procedure({ valueRecordId: t.u64() }, t.unit(), (ctx, { valueRecordId }) => {
  const rec = ctx.withTx(tx => tx.db.value_record.id.find(valueRecordId));
  const res = ctx.http.fetch('https://api.brightdata.com/request', { /* §7 Bright Data */ });
  ctx.withTx(tx => applyRecheck(tx, rec, res));
});
```

### CREAO (`/skills/forge-cli`, agent setup)

- Four saved agents: COO, Research, CFO, Auditor. Each has structured inputs, autonomy **Auto**, and its own seat token (a SpacetimeDB identity token) stored in CREAO Secrets.
- Agents never start other agents. Only the `dispatch` procedure starts runs.
- Agents act only through `forge-cli`. Its commands map 1:1 to the reducers for that seat plus read-only SQL: `forge order <id>`, `forge catalog`, `forge decide …`, `forge research-fetch <url>`, `forge report …`, `forge verdict …`. Node built-in `fetch` only, no packages, because packages installed during a run are not saved. (To persist an environment, use Create Agent / Update Environment.)
- Rework continues the same `threadId`.
- The CFO's daily report is a CREAO scheduled run that writes to the dashboard through `forge report`.
- API: base `https://agent.creao.ai`, `Authorization: Bearer capi_…`.
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

- Claims `build` / `enhancement` / `warranty` tasks through `claim_task` and creates `git worktree add` of `/actor` (no secrets).
- `createSession({cwd, autonomyLevel: 'low', disabledToolIds, permissionHandler})`. The handler auto-approves an allowlist: running tests, a local Actor run against fixtures, and live pages through Bright Data. Anything else creates `approval(droid_action)` and waits for the founder's decision.
- Every streamed message is logged with `log_droid_event`.
- Follow-ups on the same capability use `resumeSession(id)` (the id is stored on `actor_version`/`capability`).
- The worker, never Droid, runs `apify push`, and only after `actor_ship` is approved.

```ts
import { createSession, ToolConfirmationOutcome } from '@factory/droid-sdk/node'; // FACTORY_API_KEY; verify names
const session = await createSession({
  cwd: worktree, autonomyLevel: 'low',
  permissionHandler: async (req) =>
    allowlisted(req) ? ToolConfirmationOutcome.ProceedOnce
      : (await founderApproves(req)) ? ToolConfirmationOutcome.ProceedOnce
      : ToolConfirmationOutcome.Cancel,
});
for await (const msg of session.stream(ticketPrompt(task))) await logDroidEvent(task.id, msg);
await session.close();
```

### Fetch (`/fetch-agents`)

- Front Desk uAgent: Chat Protocol, mailbox, published manifest, Agentverse listing, Innovation Lab category.
- ASI-1 parses intent and classifies tickets. The agent quotes or counteroffers.
- Payment Protocol as seller: Stripe test mode (`payment_method="stripe"`, `metadata.stripe = {publishable key, client secret, checkout session id}`). Confirm by `stripe.checkout.Session.retrieve(id).payment_status == "paid"`. The secret key never goes in metadata. Test card 4242 4242 4242 4242. Fallback: FET testnet.
- Map each ASI:One sender to its own SpacetimeDB `customer`.
- Poll order state and post progress. Never end the session while an order is open.
- Gate 0 test: do delayed (agent-initiated) messages appear in ASI:One? If not, fall back to on-demand `status`.
- Use interactive cards if supported (**verify**).
- Optional later: a buyer agent that discovers and buys the newly built capability.

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
    ...  # ASI-1 parse → reducer call → reply

@agent.on_interval(period=10.0)
async def post_progress(ctx: Context): ...  # SQL poll of open orders → message the customer

agent.include(chat, publish_manifest=True)
agent.include(pay, publish_manifest=True)
```

### Apify (`/actor`)

- Build the Actor in Apify AI Chat first (Best Actor eligibility), then pull it into `/actor`.
- Clean `input_schema.json` and dataset schema. One dataset item per value, matching the `value_record` fields.
- Fetch pages through Bright Data. `fixtures/` holds saved pages, `test/` holds the fixture tests and the contract test (output fields ⊇ the previous version's fields).
- Run: `POST /v2/acts/{username~actor}/runs?token=…&webhooks=<base64 JSON>`. Status: `GET /v2/actor-runs/{id}`. Items: `GET /v2/datasets/{id}/items?clean=true`.
- Store listing with pay-per-event pricing is a founder task.

### Bright Data

| Product | Used for |
|---|---|
| SERP API | Research discovery: a Google search URL with `&brd_json=1` |
| Web Unlocker | Actor retrieval and independent verification/recheck |
| Browser API | Toggle pages only: Playwright `chromium.connectOverCDP(wssUrl)` |

```
POST https://api.brightdata.com/request
Authorization: Bearer <key>
{ "zone": "<unlocker zone>", "url": "<page>", "format": "raw", "country": "us" }
```

Log every attempt to `evidence`: status, retry, country, timing.

### Coinbase (only if eligible; first to cut)

x402 pay-per-call access to a delivered feed. Nothing else.

---

## 8. Dashboard spec (`/web`)

One page. A persistent header shows **TEST MODE**, the connection status and the founder identity. Everything renders from subscriptions; nothing animates without a state change.

| View | Shows | Founder actions |
|---|---|---|
| Office | One station per role (current task, lease, last event), order queue, live event feed, Droid stream (steps, diffs, test output) | none |
| Products | Capabilities, versions with fields and test results, buyer counts, recent runs and datasets | none |
| Books | Revenue, vendor costs, engineering budget (cap/reserved/spent), bonuses (accrued/paid/clawed back), refunds, books-check status | Change the engineering cap |
| Approvals | Pending approvals with detail and amount | Approve / reject |
| Time Machine | Scrubber over `event` rows for one order or build, banner **REPLAY**, original timestamps | Play / scrub (read-only) |

- The Time Machine is a client-side projection of stored events. It calls no reducers and procedures, so it never re-triggers payments or deploys.
- It must work at phone width (second device).

---

## 9. Demo script (3 minutes + 2 minutes Q&A)

Two screens: the laptop shows the dashboard and ASI:One; the phone shows the dashboard. Everything is live unless labeled.

| Time | Action | Evidence |
|---|---|---|
| 0:00–0:20 | Hook. A judge places a real catalog order in ASI:One (pays with the test card). | The order appears on both screens instantly |
| 0:20–0:45 | The COO CREAO run starts and the order moves through Apify → verify | Real run ID and link, task transitions, `evidence` rows |
| 0:45–1:20 | Delivered in chat: table + dataset link. **The judge challenges row N.** Recheck in seconds; both screens update; the Auditor verdict is posted. | Bright Data request log, challenge state, refund/clawback or fresh quote |
| 1:20–2:10 | **REPLAY**: the real toggle-support build. Research → CFO invests → Droid fails a test → Auditor rejects → repair → accept → founder approves → v0.2 → a second buyer reuses it | Original timestamps, Droid diff and tests, CREAO run links, Apify version |
| 2:10–2:35 | The founder lowers the engineering budget live; a pending build becomes ineligible | Reducer-driven state change on both screens |
| 2:35–3:00 | **The judge asks for an enhancement in chat.** The ticket is classified and the pipeline starts; it ships during Q&A | The live ticket, then the "vN shipped" announcement in chat |

Close: "One human approved the consequential actions. The company did the rest."

---

## 10. Testing and canary

- **Module:** double-claim test (two identities, one winner), budget cap test, books-sum test, sender-role test per reducer.
- **Actor:** fixtures, contract test, live-page test (all three are required for every version).
- **Routes:** a replayed callback with a used token is rejected; a duplicate run ID is a no-op.
- **Canary (`/workers/canary`):** a scripted end-to-end catalog order through the real reducers, Actor and Bright Data, run before and after every merge to `main`. A failing canary freezes merges until it is fixed. Record the pass/fail and timing; these are the only numbers the README may quote.
- JS checks: `pnpm run build`, `pnpm run typecheck`.

---

## 11. Gates (PT)

| Gate | By | Done when |
|---|---|---|
| 0 | Fri night | A procedure makes an HTTP call; a route receives a callback; a web client subscribes. One CREAO API run end to end. Front Desk in ASI:One: chat reply, delayed-message test, payment card renders. Droid hello-world in a worktree. Apify and Bright Data smoke tests. |
| 1 | Sat 4 AM | Roles and reducers. One catalog-hit order end to end (COO → Actor run → verification → Auditor → delivered in chat). **Schema freeze.** |
| 2 | Sat 9 AM | Real Research through Bright Data. Challenge flow works. |
| 3 | Sat 2 PM | Full ASI:One order with payment. Dashboard live on two devices. Open to Cal Hacks hackers. |
| 4 | Sat 7 PM | Build path (flow B) with toggle support, including reject → repair → accept, founder ship approval, and a second buyer's reuse. Budget-change moment works. |
| 5 | Sat 7–11 PM | Iteration tickets, Time Machine, cards, x402 if eligible. |
| Freeze | Sun 12 AM | No new features. Sun 12–7 AM: README, videos, rehearsal. Submit by **8:15 AM** (hard deadline 9:00 AM). |

If a gate fails, stop adding features and repair that path first.

---

## 12. Cut order (cut from the top)

1. Coinbase x402
2. Optional Fetch buyer agent
3. Interactive cards
4. CFO scheduled daily report
5. `coverage` and `format` ticket labels (keep `challenge`, `enhancement`, `question`, `status`)
6. Live enhancement shipping during Q&A (show the replay only)
7. Time Machine scrubbing (keep a plain REPLAY event list)
8. Stripe payment (use the FET testnet fallback, or record an honest TEST MODE "unpaid" quote)

Never cut: a real catalog order in ASI:One, the four CREAO roles, Bright Data verification, the challenge flow, one real Droid build, two devices in sync.

---

## 13. Submission checklist

- [ ] Devpost submitted by 8:15 AM Sun with tracks: Factory Droid SDK, Fetch.ai, CREAO: exactly one track (One-Person Company or AI-First Disruptor; founder picks), SpacetimeDB, Apify (+ Best Actor), Bright Data, Coinbase x402 (if eligible), Microsoft Built for the Real World, Best Solo Hack.
- [ ] Public GitHub repo. Demo video on Devpost (required).
- [ ] README with one section per sponsor: what it does here, what breaks without it, and where to see it.
- [ ] CREAO: all four agent IDs and run share links in the README; an agent shown running in the demo.
- [ ] Fetch: agent names, addresses and badges in the README; ASI:One submission agent; a separate 3–5 minute Fetch video.
- [ ] Apify: Actor link, Store listing, version history; Best Actor entry.
- [ ] Bright Data: products used, sample request logs, an honest `unverifiable` example.
- [ ] Factory: a Droid session trace (prompt, steps, diff, tests, approval).
- [ ] SpacetimeDB: two-device screenshots/clip; the list of reducers and procedures.
- [ ] Only measured numbers (canary results). TEST MODE labels everywhere.

---

## 14. Open questions (ask at booths; record answers here)

| Who | Question | Answer |
|---|---|---|
| Organizers | Devpost says "college students 18+, team of 2–4, team required", but the prize page lists Best Solo Hack. Is a solo founder eligible? Student eligibility? | Solo is allowed. Student eligibility not yet confirmed. |
| CREAO | Can one project enter both AI-First Disruptor and One-Person Company? | No. Only one CREAO track per project. |
| Fetch | Is data delivered in chat with a dataset link fine? Do delayed messages show in ASI:One? Which payment method renders? | |
| SpacetimeDB | Are procedures and HTTP routes stable on Maincloud this weekend? | |
| Apify | Do Droid's later edits keep Best Actor eligibility? | |
| Bright Data | Do the promo credits cover the Browser API? | |
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
| Bright Data Web Unlocker | https://docs.brightdata.com/products/web-unlocker/introduction |
| Coinbase x402 | https://docs.cdp.coinbase.com/x402/welcome |

