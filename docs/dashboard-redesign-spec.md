# Dashboard redesign: handoff spec

**Branch:** `dashboard-redesign`. **Implementer:** the agent assigned to this spec. **Reviewer:** the agent that wrote it (reviews each step's commit, screenshots and `docs/progress.md` entry). **Scope:** `/web` only.

This spec is binding for the dashboard. [AGENTS.md](../AGENTS.md) §8 was rewritten to match it; where this document and [astra-advice.md](astra-advice.md) differ, this document wins. Where this document and AGENTS.md §2 (rules) differ, §2 wins.

## 0. Read first

1. AGENTS.md §1–§3 (what the company is), §2 (rules), §5 (tables), §8 (dashboard contract), §9 (demo script).
2. `web/src/App.tsx`, `Office.tsx`, `scene.ts`, `Floor.tsx`, `Drawer.tsx`, `Detail.tsx`, `Events.tsx`, `Engineering.tsx`, `Controls.tsx`, `Apis.tsx`, `styles.css`. About 90 KB total. `scene.ts` is the pure projection from rows to station states; keep it pure.
3. The live database is `forge` on Maincloud. The dashboard dev server is usually running at `http://localhost:5180` (`pnpm -C web dev`). Read-only SQL for exploring data: `curl -s -X POST https://maincloud.spacetimedb.com/v1/database/forge/sql -H 'Content-Type: text/plain' --data "SELECT kind, payload FROM event"`. Column names come back snake_case.
4. Headcount:1, the LA Hacks 2026 winner of the same CREAO track, for the density target only: https://devpost.com/software/headcount-1 (six screenshots). We borrow its three-level information density, its avatar identity, its org chart with counted handoffs, and its honesty labels. We do not borrow its pixel town, its replay-only demo, or its in-world clock.

## 1. Why

Judges see the dashboard for about 15 seconds before deciding whether to lean in. Today it shows seven header numbers, a raw 150-row event log taking 40% of the screen, eleven stations each carrying five labels, a catalog with 15 `test-…`/`retire-…` rows and a Controls tab that is a config file with Save buttons. The underlying work is real and strong; the screen hides it.

The CREAO "Best One-Person Company" rubric: "One human operating like a funded startup. Win if: you show an org chart of agents that hand work to each other." Judging: AI as foundation 30%, depth on CREAO 25%, originality 20%, track fit 15%, demo and storytelling 10%. The dashboard must let a judge see, without reading JSON: what the customer asked, which employee owns it now, what each employee decided and why, what the founder was asked to approve, and that engineering happens for a business reason.

Three levels of detail, always:

| Level | Content | Where |
|---|---|---|
| At a glance | request, owner, outcome, founder action needed | header, order headline, floor, Needs-you rail |
| One click | decision, rationale, evidence, next employee | feed line, station drawer, org-chart node card |
| Proof | CREAO run link, quotes, Bright Data attempts, diff, tests, raw event JSON | expanders inside drawers and the feed |

## 2. Rules that bind this work

From AGENTS.md §2, restated for the UI:

- Never fake anything. Every number, sentence and state renders from stored rows. No invented reasoning, no "success" inferred from activity, no staged failures.
- Labels: money is **TEST MODE** everywhere it appears. Simulated payments are **SIMULATED PAYMENT**. Recorded history is **RECORDED** with its own timestamps. A client-side replay, if built, is **REPLAY**. Scripted traffic is **TEST TRAFFIC**.
- Founder actions are reducer calls under the founder identity (`decide_approval`, `set_budget_cap`, `set_config`, `close_compile`). Nothing else authorizes anything. Non-founder identities see the same screens read-only.
- Unknown or missing data stays visible as unknown. A `kind` with no sentence template still renders (fallback) and is never dropped. A missing run link renders as "no link recorded", not as a dead button.
- Frontend changes are verified in a real browser with `agent-browser` (interactions and screenshots), not by typecheck alone. Commit each step once verified, Conventional Commits (`feat(web): …`). Never commit a failing build.
- `/web` only. Do not change `module/`, `workers/`, `fetch-agents/`, `actors/`. The schema is frozen (additive only) and every public table the dashboard needs already exists. If you find you need a field that does not exist, stop and write it under §16 instead of working around it.
- Use pnpm. No new runtime dependencies except `qrcode` (step 7), if that step is reached.
- New ideas go in `docs/after-hackathon.md`, not in code.

## 3. Scope

**Cut (remove from the UI):** header treasury, budget triple, db name, identity hash, "connected" text, "open orders" stat; floor legend row; floor durations; second caption line; sponsor colors on the floor; the Controls tab (becomes a gear modal); retired APIs in the catalog (toggle); task and run tables in drawers; "older (134)…" dropdown; "Droid is sleeping" copy; the global raw Events panel as the default right rail.

**Restructure:** header (4 numbers), main panel 70% / right rail 30%, tabs `Office · Org chart · Catalog · Engineering`, order picker compact and scoped to real orders, right rail = Needs you / Feed / Engineering strip.

**Add:** order headline, order-scoped feed with sentences, Needs-you rail with plain-language approval cards, Org chart view with counted handoffs, Engineering recorded timeline, Controls modal, role avatars, decision cards in drawers, dataset QR code (last).

**Out of scope:** a floor replay with scrubber (AGENTS.md §12 item 7: a plain recorded list is enough), founder messaging to agents, a Books tab, sound, new animations beyond the existing packet and pulses, any backend change.

## 4. Terms and scoping rules

**Real order.** An `orders` row whose `customer.asiSender` starts with `agent1q` (a Fetch agent address: ASI:One users and the buyer agent) and whose id is not in `canary_order`. Everything else is **test traffic** (senders like `test-sender-…`, `cli-test-…`, `asi-test-…`, `cmp-test-…`, `asi-e2e…`, `canary…`). As of Oct 24 18:40 PT the live database has 205 orders, 59 canary, 9 real (#20, #27, #104, #123 quoted and unpaid; #131, #196, #202, #205 delivered; #199 audit-rejected). Use this as a check that your filter is right.

Default views show real orders only. A **Show test traffic** toggle (off by default, in the order picker bar) reveals the rest; every test row carries a `TEST TRAFFIC` badge (canary rows keep the existing `canary` badge too). This is a display filter; nothing is deleted or hidden from the raw views. Put the `agent1q` rule in one function (`isRealOrder`) with a comment explaining why it exists.

**Visible scope.** "Real orders" or "all traffic" depending on the toggle. Header stats, the company feed, the org chart counts and the catalog's "last dataset" link all follow the visible scope. Retired APIs (`api_retired`) are hidden from the catalog and from engineering job lists unless their own "Show retired" toggle is on.

**Agent decision.** An event whose `kind` is one of `coo_accepted`, `coo_rejected`, `coo_counteroffered`, `coo_requested_research`, `research_reported`, `cfo_proposed`, `audit_accepted`, `audit_rejected`, `challenge_upheld`, `challenge_rejected`, `compile_accepted`, `compile_rejected`. **Founder approval:** `approval_approved` or `approval_rejected`. Both are counted inside the visible scope: order-scoped events count when their order is real; `challenge` events when `payload.orderId` is a real order; `ticket` events when the ticket's API is not retired.

**Open order.** A real order that is paid and not in `TERMINAL` (`flow.ts`). Quoted-but-unpaid orders are "unpaid quotes", not open work.

**Role avatar.** A 22 px disc with two-letter initials in the role's accent color (§8): COO, RE(search), CFO, AU(ditor), DR(oid), FD (Front Desk), FO (Founder), TR (Treasurer), RU (Rules). The same component renders on the floor block, in feed lines, in drawers and in the org chart. Avatars are the visual thread that connects the four screens.

## 5. Layout

Desktop (primary target 1920×1080, projector; must also hold at 1440×900):

```
┌ FORGE · a one-person company  [TEST MODE] [SIMULATED PAYMENTS?]   Revenue $67.00 · Verified 99% · Cost/call $0.004–0.03 · 3 APIs for sale · Agent decisions 23 : Founder approvals 3   ● LIVE  ⚙ ┐
│ #205 · open-roles for Lattice   [Delivered]  21/21 verified  $1.00 TEST MODE · SIMULATED PAYMENT  2m 10s  customer agent1q25…                                                                      │
├──────────────────────────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────┤
│ Orders  ● 1 running · 4 unpaid quotes   [#205 ▣][#202][#199][#196][#131]…   │ NEEDS YOU                                                                 │
│ ☐ Show test traffic   🔍                                                    │ Nothing is waiting on the founder.                                        │
│                                                                              ├───────────────────────────────────────────────────────────────────────────┤
│ Office · Org chart · Catalog · Engineering                                   │ ORDER #205                                       This order | Company     │
│                                                                              │ 18:25:03  FD  Quoted $1.00 for open-roles (board: lattice)                │
│   [the forge floor: 8 flow stations in the U, back office on its platform]   │ 18:25:50  FD  Customer paid $1.00 · SIMULATED PAYMENT                     │
│                                                                              │ 18:26:10  COO Accepted: use the existing open-roles API. "Existing       │
│                                                                              │               catalog API open-roles covers this exactly…"  Open run ↗   │
│                                                                              │ 18:26:17  WH  21 values extracted (21 anchored to a quote)  Dataset ↗    │
│                                                                              │ 18:26:24  BD  Re-fetched 1 source: 21/21 verified                        │
│                                                                              │ 18:26:45  AU  Accepted the deliverable. "ACCEPT: 21/21 values…" Open run ↗│
│                                                                              │ ▸ Show 12 more events (plumbing)                                          │
│                                                                              ├───────────────────────────────────────────────────────────────────────────┤
│                                                                              │ DROID  Idle · open-roles v1.0 shipped 00:50 · nothing queued   Open →     │
└──────────────────────────────────────────────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────┘
```

Grid: `main { grid-template-columns: 7fr 3fr }`. The right rail is three stacked sections with fixed order; Needs you grows with content (max 40% of the rail), the feed takes the rest, the Droid strip is one row pinned at the bottom.

Phone (390×844, the founder's second device): header (4 numbers, wrap), Needs you, order headline, the existing `Pipeline` list instead of the floor, the feed. No floor, no org chart, no catalog grid (the catalog becomes a vertical list). The drawer stays a bottom sheet.

## 6. Components

File names are suggestions; keep components small and keep `scene.ts` pure. Reuse `useTable` subscriptions already set up in `main.tsx` (every table needed is already subscribed, including `refund`? Check: `refund` is not in the subscription list; add it, it is a public table).

### 6.1 Header (`App.tsx` → `Header.tsx`)

- Left: wordmark `FORGE`, subtitle `a one-person company`, `TEST MODE` badge, and `SIMULATED PAYMENTS` badge only when a visible order has `stripeSessionId` starting `demo-simulated:`.
- Center, four numbers plus the decisions pair, all `tabular-nums`:
  - **Revenue**: as today (negated sum of `books` balances for `customer:*` accounts), label "revenue · TEST MODE".
  - **Verified**: as today (`value_record` statuses in `CHECKED`), shown as `99%` with `1258/1274` small.
  - **Cost / call**: as today (range over `api_cost` rows with runs > 0 for non-retired APIs).
  - **APIs for sale**: count of `api` rows not in `api_retired`.
  - **Agent decisions N · Founder approvals M**: per §4, with a `title` tooltip stating the scope ("real orders and live APIs" or "all traffic"). This is the One-Person Company number; it goes in step 4, not step 1.
- Right: connection dot (green `ok`, red `bad`, tooltip has the full status text), `LIVE` badge (`REPLAY` only if a replay view is ever open), a `Founder` or `Viewer` chip based on the staff check already in `App.tsx`, and a gear button that opens the Controls modal (§6.9).
- Removed: treasury, eng budget triple, open orders, `db forge`, identity hash, the word "connected".

### 6.2 Order headline (`OrderHero.tsx`)

Rendered above the tabs whenever an order is selected (Office tab) and on the phone. Two lines:

1. `#205 · open-roles for Lattice`: order id, API name (or the first 60 characters of `requestText` when `apiId` is undefined), and a param summary built from `params` JSON (`{"board":"lattice"}` → `for lattice`; otherwise `· key: value` pairs, max two).
2. Chips: human status pill (table below), `21/21 verified` (from `value_record` rows of the order in `CHECKED`, verified count over total), price `$1.00 TEST MODE` plus `SIMULATED PAYMENT` when applicable, elapsed `2m 10s` (createdAt → the terminal event's `at`, or "running for …" from createdAt when not terminal), customer `agent1q25…` (first 10 characters), `TEST TRAFFIC` or `canary` badge when applicable.

Status labels (`orders.status` → text): `quoted` → "Quoted, unpaid"; `paid` → "Paid, waiting for the COO"; `triaging` → "COO deciding"; `researching` → "Research checking the source"; `accepted` → "Accepted, starting the extractor"; `running` → "Extractor running"; `verifying` → "Bright Data verifying"; `auditing` → "Auditor reviewing"; `delivered` → "Delivered"; `rejected` → "Rejected by the COO"; `rejected_at_desk` → "Rejected at the desk"; `counteroffered` → "Counteroffer sent"; `audit_rejected` → "Audit rejected"; `failed` → "Failed". Unknown status → the raw status with underscores replaced.

### 6.3 Order picker (`Office.tsx` → `Picker`)

- One row: `Orders` title, `● 1 running · 4 unpaid quotes` (counts over the visible scope), chips for the newest 8 visible orders (`#id`, API name or short request, status pill, age, badges), a search input (matches `#id` or request text, replaces the "older" dropdown), and the `Show test traffic` checkbox (replaces `show canary`).
- Auto-follow stays as today: the newest in-progress real order, else the newest real order. The `● N new orders` button stays.
- Keep the existing `data-testid`s (`picker`, `chip-<id>`, `new-order`).

### 6.4 Floor (`Floor.tsx`, `scene.ts`)

Changes only; the isometric blocks, pipes, packet, stamps and badges stay.

- Per station: name (28 px), one caption line (max 26 characters, ellipsis; full text in the `<title>` and the drawer), state badge, stamp. Remove the duration label and the second caption line.
- Sponsor tag: keep the text, make it a muted monochrome tag (`#7a736a`, 13 px, no colored stroke). Sponsor colors live in drawer headers, the org chart and the catalog.
- Avatar disc at the top-left corner of the block for COO, Research, CFO, Auditor, Droid, Front Desk, Treasurer.
- Back office: keep positions. Make the separation explicit: platform label `BACK OFFICE · improves the catalog, not this order`; a dashed pipe from Droid to Warehouse labeled `ships new versions` that lights when a `compile_job` is `shipping` or became `shipped` in the last 24 h. Idle back-office stations render at 0.5 opacity.
- Copy: Droid idle caption `No engineering queued`; queued `N builds queued`; working `Building {api} · attempt {n}`; waiting on approval `Waiting for founder approval`; `ineligible` → `Blocked: over the engineering cap`. Derive from `compile_job.status` (§6.8 label table), not from task rows alone.
- Remove the legend row. The state badge icons (✓ ✕ ! ●) carry the meaning without color.

### 6.5 Right rail: Needs you (`NeedsYou.tsx`, replaces `ApprovalCards`)

Pending `approval` rows (status `pending`), newest first. Each card:

- Title and body from the kind map below. Requested-by line from the matching `approval_requested` event (`actor`, `at`). Amount with `TEST MODE` when > 0. A one-line consequence.
- `Approve` and `Reject` buttons call `decide_approval` (existing `useReducer(reducers.decideApproval)`). Disabled for non-founders with the text "Founder identity required". While pending: disabled with "Sending…". On error: the error text under the card (`role="status"`). After success the card disappears because the row leaves `pending`; the feed shows the founder's decision.
- Empty state: `Nothing is waiting on the founder.` and, when step 4 is done, `N agent decisions so far today without you.`

| kind | title | body | consequence |
|---|---|---|---|
| `api_ship` (ref ticket) | Publish the compiled `{api}`? | Droid's attempt {attempt} passed fixtures, contract and live tests; the Auditor accepted it: "{compile_accepted.reason}". | Every buyer's next call uses the compiled version. The worker runs `apify push` only after this. |
| `spend_over_cap` (ref ticket) | Spend ${amount} over the engineering cap on `{api}`? | The CFO proposed ${amount} to build a dedicated extractor: "{cfo rationale}". Only ${available} is left under the ${cap} cap. | Approving reserves the money and queues Droid. |
| `droid_action` (ref task) | Let Droid run `{tool}` `{detail}`? | Outside the auto-allowed test commands. Reason: {reason}. | Rejecting denies this one call; Droid continues without it. |
| `refund_over_limit` (ref refund) | Refund ${amount} on order #{refund.orderId}? | Challenge #{refund.challengeId} was upheld. The refund is above the ${refund_limit_cents} limit. | The customer account is credited; the responsible bonus is clawed back. |
| unknown kind | `{kind humanized}` #{id} | `{detail}` | — |

Data: `approval` row, `compile_job` by `ticketId` (attempt, rationale, amountCents), `budget` (cap, reserved, spent), `refund` by id, `config.refund_limit_cents`, the `approval_requested` event with `refType=approval` and `refId=id` (payload `tool`, `detail`, `reason` for droid actions). Fall back to the raw `detail` string when a field is missing.

### 6.6 Right rail: Feed (`Feed.tsx`, replaces `Events.tsx`)

- Header: `ORDER #205` with a segmented toggle `This order | Company`. Default: this order. The company view respects the visible scope and `Show all events`.
- This-order view: all events with `refType=order` and `refId=order.id`, plus `challenge` events whose `payload.orderId` is this order, plus `task` and `run` events for this order's tasks (for the expanders). Oldest first; the list auto-scrolls to the newest row when a new row arrives and the user has not scrolled up. The newest row has a soft highlight; when the order is not terminal the last row shows a pulsing dot.
- Company view: newest first, 100 rows, with a `Load more` button.
- Each row: time (`clock`), avatar + actor label (§7 actor map), the sentence, an optional link, and a `▸` expander showing `kind`, `refType #refId` and the pretty JSON payload (the current `Events.tsx` behavior lives here).
- **Plumbing** rows (§7) are hidden behind one row `▸ Show N more events (plumbing)` at the end of the list (this-order view) or behind the `Show all events` checkbox (company view). Failures are never plumbing.
- Grouping: consecutive `research_fetched` rows become one row `Bright Data fetched N pages for Research (robots, terms, page, volatility)` whose expander lists each fetch (`kind`, `target`, `httpStatus`, `ms`, `attempts`). Consecutive `droid_droid_message` rows (company view) become `Droid · N messages` with the same expander.
- Links: CREAO decisions link to the `run` row for the role's task (`shareUrl` if set, else `https://agent.creao.ai/chat?threadId={threadId}` labeled `Open CREAO run (account login)`; if neither, the text `no run link recorded`). `api_run_ingested` links to `orders.datasetUrl`. `gate_check_recorded` links to `citationUrl`. `values_verified` and `challenge_rechecked` link to the Verify / Delivered station drawer (`onOpen`).

### 6.7 Right rail: Droid strip (`DroidStrip.tsx`)

One row: avatar, `DROID`, one sentence from the newest non-retired `compile_job` (table in §6.8), `Open →` switches to the Engineering tab with that job selected. When no job exists: `No engineering work yet`.

### 6.8 Engineering view (`Engineering.tsx`)

Keep the job selector (newest first, retired hidden behind `Show retired API jobs`) and the founder `Close compile` form. Replace the body with:

- Title: `Build a dedicated extractor for {api}` (the plain-language verb; "compile" and "Tier 0 → Tier 1" appear in a muted technical sub-line: `compile ticket #{ticketId} · Tier 0 → Tier 1 · attempt {attempt}`).
- Badge: `RECORDED {createdAt} → {updatedAt}` when the job is `shipped`, `failed` or `closed`; `LIVE` otherwise.
- Status sentence from this table (`compile_job.status` → text):

| status | sentence |
|---|---|
| `awaiting_cfo` | CFO reviewing: {triggerDetail summary} |
| `awaiting_approval` | Blocked: ${amountCents} is over the engineering cap; waiting for the founder |
| `queued` | Funded: ${amountCents} reserved; waiting for a worker to claim it |
| `ineligible` | Blocked: over the engineering cap (${budget.capCents}); raise the cap to requeue |
| `compiling` | Droid is building attempt {attempt} |
| `auditing` | Auditor reviewing attempt {attempt} |
| `rework` | Sent back by the Auditor; Droid resumes the same session |
| `ship_pending` | Accepted; waiting for the founder's publish approval |
| `shipping` | Publishing to Apify |
| `shipped` | Shipped as v{version} · Tier 1 |
| `failed` | Failed: {compile_failed.reason} |
| `closed` | Closed by the founder: {reason} |
| other | the raw status |

- Then a vertical timeline (oldest first) built from events with `refType=ticket, refId=ticketId` and `refType=task` for tasks whose `ticketId` matches. Steps:
  1. **Trigger** (`compile_triggered` or `ticket_opened`): `buyers` → "{buyers} distinct buyers (threshold {minBuyers})"; `verified_rate` → "{verified}/{total} verified over {runs} runs ({verifiedRate}) below {minVerifiedRate}"; `challenge_upheld` → "Challenge #{challengeId} upheld on order #{orderId}: the extractor misread row {row} ({metric})".
  2. **CFO** (`cfo_proposed`): decision, amount, the full rationale in an expander, the CREAO run link.
  3. **Budget** (`budget_reserved`, `compile_over_cap`, `spend_over_cap_approved`, `compile_ineligible`, `compile_eligible_again`): one line each.
  4. **Attempt n** (group by `payload.attempt` from `compile_started` to `compile_rejected` / `compile_accepted`): `droid_session_created` or `droid_session_resumed` ("same session, resumed"), `droid_prompt` (expander), each `droid_tool_decision` as a chip `{tool} · {outcome}` with `reason` in the tooltip (`auto-allowed` green, `denied` red, `founder-approved` gold, `needs-approval` amber), `droid_files_changed` (`src/extract.js, src/jsonspan.js`), each `droid_tests` as `fixtures ✓ 1/1`, `contract ✓`, `live ✕ 1 failed` with the output in an expander, `compile_submitted` ("submitted: tests {passed ? 'passed' : 'failed'}"), then the Auditor's `compile_rejected` ("sent back: {reason}", max attempts shown) or `compile_accepted` ("accepted: {reason}") with its run link. `droid_droid_message` rows are not shown individually; a count (`{n} Droid messages`) with an expander is enough.
  5. **Publish** (`approval_requested` kind `api_ship`, `approval_approved`/`approval_rejected`, `api_ship_approved`): who asked, what the founder decided, when.
  6. **Ship** (`droid_ship_push_started`, `droid_ship_push_finished` exit code and ms, `droid_ship_build_confirmed` build number and status, `api_version_shipped` version, tier, fields): "v1.0 · Tier 1 · {fields.length} fields, superset of v0.1".
  7. **Cost**: "Before: {costBeforeMicros} per call (measured over Tier 0 runs). After: {api_cost.costPerCallMicros} measured over {api_cost.runs} Tier 1 runs" or "After: no Tier 1 runs yet". Never show a projected saving as measured.
- The extractor diff (`testResults.diff`) sits in an expander under the accepted attempt: `Extractor diff · {files}`.
- Separate sessions stay separate: if `droid_session_created` appears twice, render two session headers. A passed test is a test step; acceptance is the Auditor step; approval is the founder step; shipped is the ship step. Never merge them.

### 6.9 Controls modal (`Controls.tsx`)

Opened from the header gear. Title `Company rules · TEST MODE`. Four primary levers, each with a plain label, the current value, one effect sentence, an input and Save:

| lever | reducer / key | input | effect sentence |
|---|---|---|---|
| Engineering budget cap | `set_budget_cap` (dollars → cents) | number, 2 decimals | Lowering it makes compiles that no longer fit ineligible immediately; raising it requeues them. |
| Build after N distinct buyers | `set_config` `compile_min_buyers` | integer | An API with this many buyers gets a compile ticket; the CFO decides whether to invest. |
| CREAO runs at once | `set_config` `creao_max_concurrency` | integer | Fewer concurrent runs means tasks queue at the stations. |
| Refund limit | `set_config` `refund_limit_cents` (dollars → cents) | number | Refunds above it need the founder's approval. |

`Advanced` expander: the remaining `config` rows exactly as the current `ConfigEditor`. Read-only for non-founders with the existing message. Esc closes. The current `Reserved $… · spent $… · cap $…` line stays under the budget lever.

### 6.10 Catalog (`Apis.tsx`)

Cards, three per row (one per row on the phone), for each `api` not in `api_retired`, ordered Tier 1 first then by name:

- Name (large), description (two lines, ellipsis), tier badge: `Tier 1 · compiled by Droid` (gold) or `Tier 0 · generic extractor` (bronze), version and engine (`v1.0 · Actor` / `v0.1 · Task`).
- Stats row: verified `{verifiedRateBp/100}%`, buyers `{buyerCount}`, cost per call (`api_cost.costPerCallMicros` when `runs > 0`, else `costPerCallCents`; label "per call · TEST MODE"), volatility (`volatile · 15 min window` / `stable`).
- Sources as domains (deduped), fields as chips.
- `Dataset ↗` of the newest delivered visible order for this API, if any.
- Engineering line when a `compile_job` exists for the API: its §6.8 status sentence, linking to the Engineering tab.
- `Show retired (N)` toggle at the bottom reveals a muted table: name, retired at, reason.

### 6.11 Org chart (`OrgChart.tsx`, new tab)

The track's "win if" screen. SVG or CSS grid; hierarchy top-down:

```
                        Founder (you)
             approves money and shipping · sets the rules
                              │
   Customers ── Front Desk ── COO ─────────────────────────────┐
   (ASI:One,    (Fetch uAgent)  (CREAO)                         │
    buyer agent)       ┌─────────┼─────────┐                    │
                   Research    Auditor     CFO                  │
                   (CREAO +    (CREAO)    (CREAO)               │
                  Bright Data)    │          │ invests           │
                                  │        Droid ── Warehouse (Apify)
                                  └── audits builds   (Factory)
   Treasurer and Rules: reducers (SpacetimeDB), shown as a footer strip, not as employees.
```

Each node: avatar, name, one-line responsibility, `runs on` chip in the sponsor color (CREAO saved agent / Fetch uAgent / Factory Droid / reducers), live status word (`idle`, `working`, `waiting · N queued`) derived from `task` rows by role, and a decisions count inside the visible scope.

Edges carry a label and a count computed from events in the visible scope:

| edge | label | count |
|---|---|---|
| Customers → Front Desk | requests | `order_quoted` |
| Front Desk → Customers | rejected at the desk | `order_rejected_at_desk` |
| Front Desk → COO | paid orders handed over | `order_paid` |
| COO → Research | research requested | `coo_requested_research` |
| Research → COO | reports filed | `research_reported` |
| COO → Warehouse | runs ordered | `coo_accepted` |
| COO → Customers | rejected with a reason | `coo_rejected` (+ `coo_counteroffered` as "counteroffers") |
| Warehouse → Auditor | deliverables for audit | `values_verified` |
| Auditor → Customers | delivered / rejected | `audit_accepted` / `audit_rejected` |
| Customers → Auditor | challenges | `challenge_opened` (upheld / rejected counts in the tooltip) |
| Rules → CFO | compile tickets | `compile_triggered` |
| CFO → Droid | builds funded | `cfo_proposed` with `decision = COMPILE` |
| Droid → Auditor | builds submitted | `compile_submitted` |
| Auditor → Droid | sent back for rework | `compile_rejected` |
| Auditor → Founder | publish approvals requested | `approval_requested` with `kind = api_ship` |
| Founder → Droid | publish approved / actions denied | `approval_approved` kind `api_ship` / `approval_rejected` kind `droid_action` |
| Founder → Rules | rule changes | `config_set` + `budget_cap_set` |

Scope footer: `Counts from stored events · real orders and live APIs` (or `· all traffic`). Clicking a node opens a side card: responsibility, runs on, what it decides, and its last three decisions as feed sentences with run links. Clicking an edge filters the company feed to that kind.

### 6.12 Drawers (`Drawer.tsx`)

For `coo`, `research`, `cfo`, `auditor` lead with a **decision card**: avatar and `COO · Accepted` (or Rejected / Counteroffered / Requested research / Pending / Sent back), then `Decision:` one line, `Reason:` the full stored reason, `Evidence:` (COO: the matched API and its tier; Research: the layer-3 gate table; Auditor: the verified counts and a link to the values table; CFO: buyers, cost per call, cap, reserved), `Next:` the next station by name, `Open CREAO run` button (link rule from §6.6), footnote `task #4217 · attempt 1 · 19 s`. Remove the Tasks tables and the Runs tables.

For `apify`, `verify`, `delivered` keep the evidence tables (they are the Bright Data and Apify proof) but put the count badges and the dataset link first. `delivered` gets the QR code in step 7. `droid` shows the §6.8 status sentence and a button to the Engineering tab instead of the task and ticket tables. `treasurer` stays.

## 7. Feed sentence map

Actor labels: `front_desk` → Front Desk (FD); `coo` → COO; `research` → Research (RE); `cfo` → CFO; `auditor` → Auditor (AU); `droid`, `droid_runner` → Droid (DR); `treasurer` → Treasurer (TR); `rules` → Rules (RU); `founder` → Founder (FO); `canary` → Canary; `dispatch`, `procedure`, `route`, `schedule` → System (muted, no avatar). Money fields are cents unless named `Micros` (`microsUsd` in `scene.ts`).

Classes: **story** rows show by default; **plumbing** rows fold; **system** rows appear only with `Show all events`; **failure** rows always show, in the failure color. Payload keys below are the ones present in the live database as of Oct 24.

| kind | class | sentence (payload keys in braces) | link |
|---|---|---|---|
| `order_quoted` | story | Quoted ${priceCents} for {api name or request} | |
| `order_params_set` | plumbing | Parameters set: {params as k: v} | |
| `order_paid` | story | Customer paid ${priceCents} TEST MODE{ · SIMULATED PAYMENT if simulated} | |
| `order_rejected_at_desk` | story | Rejected at the desk: {check humanized}. {reason} | |
| `admission_started` | plumbing | Checking admission for {sources.length} source(s) | |
| `admission_waiting` | story | First fetch saved; waiting to measure volatility ({volatility} so far) | |
| `admission_passed` | story | Admission passed: {volatility} source | |
| `admission_rejected` | failure | Admission rejected at {check}: {reason} | source |
| `gate_check_recorded` | story | Gate check {check}: {result}{ (automatic)} — "{citationText}" | citationUrl |
| `research_fetched` | plumbing (grouped) | Bright Data fetched {n} pages for Research | |
| `research_reported` | story | Research filed its report: {checks as "robots pass, terms pass, …"}; volatility {volatility} | run |
| `coo_accepted` | story | Accepted: use the existing {api} API. "{reason}" | run |
| `coo_rejected` | story | Rejected the order. "{reason}" | run |
| `coo_counteroffered` | story | Counteroffered. "{reason}" | run |
| `coo_requested_research` | story | Sent to Research. "{reason}" | run |
| `api_created` | story | Created the {name} API (Tier {tier}) | |
| `apify_task_queued` / `apify_task_created` / `apify_task_failed` | story / story / failure | Creating the Apify Task for {name} / Apify Task {apifyTaskId} created for {name} / Apify Task failed for {name}: {error} | |
| `api_run_started` | story | Started the {engine = actor ? compiled Actor : forge-extract Task} run | |
| `api_run_waiting_for_task` | story | Waiting for the API's Apify Task to exist | |
| `api_run_ingested` | story (failure if values = 0) | {values} values extracted ({extracted} anchored to a quote) | dataset |
| `values_verified` | story (failure if verified = 0 and total > 0) | Bright Data re-fetched {pages} page(s): {counts.verified}/{total} verified{, n mismatch, n stale, n unverifiable} | Verify drawer |
| `audit_skipped_canary` | plumbing | Audit skipped: canary order | |
| `audit_accepted` | story | Accepted the deliverable. "{reason}" | run |
| `audit_rejected` | failure | Rejected the deliverable. "{reason}" | run |
| `order_failed` | failure | Order failed: {reason} | |
| `challenge_opened` | story | Customer challenged row {row} ({metric} = "{value}"): {reason} | |
| `challenge_rechecked` | story | Recheck in {totalMs/1000}s: saved page {savedResult} ("{savedValue}"), fresh page {freshResult} ("{freshValue}") after {freshAttempts} attempt(s) | Delivered drawer |
| `challenge_rejected` | story | Rejected the challenge: "{reason}" (saved quote: "{savedQuote}") | run |
| `challenge_upheld` | story | Upheld the challenge: "{reason}". Value superseded ({newStatus}); refund ${refund.amountCents}; {clawedBack ? bonus clawed back} | run |
| `run_cost_booked` / `run_cost_settled` | plumbing | Booked run cost {totalMicros} (Apify {apifyMicros}, LLM {llmMicros}, Bright Data {brightdataMicros}) / Settled run cost {totalMicros} | |
| `approval_requested` | story | Asked the founder: {kind humanized}{ ${amountCents}} | |
| `approval_approved` / `approval_rejected` | story | Founder approved / rejected {kind humanized} | |
| `budget_cap_set` | story | Set the engineering cap ${from} → ${to}; {ineligible.length} compile(s) became ineligible, {eligibleAgain.length} eligible again | |
| `config_set` | story | Changed {key}: {from} → {to} | |
| `ticket_opened` (label compile) / `compile_triggered` | story | Opened a compile ticket for {api}: {trigger humanized with detail} | |
| `cfo_proposed` | story | Proposed {decision}: ${amountCents}. "{rationale}" | run |
| `budget_reserved` | story | Reserved ${amountCents} of the ${capCents} cap for {api} | |
| `compile_over_cap` | story | {api} needs ${amountCents}; ${availableCents} left under the cap → approval #{approvalId} | |
| `compile_ineligible` / `compile_eligible_again` | story | {api} compile ineligible: cap ${capCents} below ${amountCents} / eligible again under the ${capCents} cap | |
| `spend_over_cap_approved` | story | Founder approved ${amountCents} over the cap for {api} | |
| `compile_started` | story | Droid started attempt {attempt} on {api} | |
| `compile_submitted` | story | Attempt {attempt} submitted: tests {passed ? passed : failed} ({tests.*.status}) | |
| `compile_rejected` | story | Sent attempt {attempt} back ({attempt}/{maxAttempts}): "{reason}" | run |
| `compile_accepted` | story | Accepted attempt {attempt}: "{reason}" | run |
| `compile_failed` | failure | Build failed: {reason} | |
| `compile_closed` | story | Founder closed the compile: {reason} | |
| `api_ship_approved` | story | Founder approved publishing {api} | |
| `api_version_shipped` | story | {api} v{version} shipped (Tier {tier}, {fields.length} fields); cost per call before: {costBeforeMicros} | |
| `engineering_spend_booked` | plumbing | Booked ${amountCents} engineering spend for {api} | |
| `api_retired` / `api_updated` | story | Retired {name}: {reason} / Updated {name} | |
| `droid_*` | plumbing in the company feed (grouped as "Droid · N messages"); rendered individually only in the Engineering timeline | | |
| `task_queued`, `task_dispatched`, `task_claimed`, `task_done`, `task_cancelled`, `orphan_dispatch_recovered` | plumbing | Task #{refId} {queued for role / dispatched to run #{runRef} / claimed (attempt {attempt}) / done / cancelled: {reason}} | |
| `task_lease_expired`, `task_ended_without_decision` | failure | A CREAO run ended without a decision; task #{refId} requeued | |
| `creao_run_started` / `creao_run_completed` | plumbing | CREAO run {externalId short} started for {role} / completed ({resultChars} chars) | run |
| `creao_run_start_failed`, `creao_callback_rejected`, `creao_refresh_failed`, `apify_callback_rejected`, `apify_refresh_failed` | failure | {kind humanized}: {reason or httpStatus} | |
| `customer_registered`, `staff_set`, `module_init`, `defaults_ensured`, `canary_orders_backfilled`, `http_smoke`, `route_ping`, `verify_probe` | system | {kind humanized} | |
| any other kind | story | {kind humanized} — {first three payload fields as k: v} | |

Humanize: replace `_` with spaces; keep API names and metric names verbatim. Quote stored reasons verbatim; never shorten a reason in the expander (the row may truncate to three lines with a "more" control).

## 8. Visual tokens (`styles.css`)

Keep the palette (`--bg #121110`, `--panel`, `--ember`, `--gold`, `--ok`, `--bad`, `--warn`). Add role accents for avatars: COO `#b896ff`, Research `#3fd0c0`, CFO `#f2b33d`, Auditor `#ff7cc0`, Droid `#a9b4c6`, Front Desk `#6d9bff`, Founder `#fff6e6`, Treasurer `#e9c35a`, Rules `#8d8780`. State colors stay the only saturated colors on the floor. Sponsor colors appear only in drawer headers, the org chart `runs on` chips and the catalog tier badges.

Type: Inter for everything; header numbers 18 px tabular; station names 28 px; captions 20 px; feed rows 13.5 px with 6 px vertical padding; section titles 11.5 px uppercase tracked (reuse `.picker-title`). Panel gap 14 px. No new animation except a 200 ms fade-in on new feed rows and the existing packet, pulse and stamp motions.

## 9. Accessibility

Every clickable thing is a `button` or has `role="button"` and `tabIndex=0` with Enter/Space handling (stations already do). Tabs are buttons with `aria-selected`. Expanders are `<details>` or buttons with `aria-expanded`. Meaning never depends on color alone: state badges keep their glyphs, approval buttons have text, tier badges have text, failure rows have a `✕` prefix. Contrast of muted text on panels ≥ 4.5:1 (`#a39d92` on `#1a1815` passes). Esc closes drawers and the Controls modal.

## 10. Verification protocol

Run after every step, before its commit:

```sh
pnpm -C web typecheck && pnpm -C web build
```

Browser checks with `agent-browser` (load the skill with `agent-browser skills get core` first; use a named session):

```sh
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix redesign)"
agent-browser open http://localhost:5180/ --viewport 1920x1080
agent-browser wait --load networkidle
agent-browser screenshot docs/proof/redesign/<step>-<view>.png
```

Required screenshots, 1920×1080 unless stated: `office` (default, a real order selected), `office-drawer-coo`, `office-drawer-verify`, `needs-you` (if a pending approval exists; otherwise screenshot the empty state and say so), `feed-company` with `Show all events` on, `org-chart`, `catalog`, `catalog-retired` (toggle on), `engineering` (ticket #6, open-roles), `controls-modal`, and phone `phone-office` and `phone-feed` at 390×844. Interactions to exercise and note in `docs/progress.md`: pick another order with a chip, search for `#199`, toggle test traffic, open and close a drawer with Esc, expand a feed row, open the Controls modal and cancel.

Live-update check (once, after step 2): with the founder identity, change the engineering cap from $20.00 to $20.01 and back in the Controls modal; the feed must show both `budget_cap_set` rows without a reload, and the header must not show the budget anymore. Restore the value. Do not run the compile integration tests (they claim live worker tasks) and do not create orders.

Honesty check (every step): search the rendered page text for `sleeping`, `projected`, `guaranteed`; none may appear. Every `$` amount visible must have `TEST MODE` within the same card or line.

## 11. Order of work and commits

Each step ends with typecheck, build, the step's screenshots, a `docs/progress.md` row, and one commit. Stop after each step long enough for the reviewer to comment; keep going if no comment arrives within the step's own duration.

| step | work | est. | commit |
|---|---|---|---|
| 1 | §6.1 header diet, remove legend and durations, §6.10 catalog cards with retired hidden, §6.9 Controls modal, `isRealOrder` + `Show test traffic` in the picker | 1.5 h | `feat(web): judge-facing header, catalog cards and controls modal` |
| 2 | §6.2 order headline, §6.6 feed with the §7 map replacing `Events.tsx`, right rail layout 7fr/3fr | 2 h | `feat(web): order headline and sentence feed` |
| 3 | §6.11 org chart tab with counted handoffs | 1.5 h | `feat(web): org chart with counted handoffs` |
| 4 | §6.5 Needs-you rail, §6.12 decision cards in drawers, header decisions pair | 1 h | `feat(web): needs-you rail and decision cards` |
| 5 | §6.8 Engineering recorded timeline, §6.7 Droid strip, §6.4 Droid copy and back-office pipe | 2 h | `feat(web): engineering timeline and droid strip` |
| 6 | §6.4 floor text diet, avatars everywhere, §8 tokens, phone layout pass | 1 h | `feat(web): floor text diet and role avatars` |
| 7 | QR code on the Delivered drawer and station (`qrcode`, dataset URL) | 0.5 h | `feat(web): dataset QR code` |

Steps 1–4 are the CREAO pitch; do them first and in order. If time runs out, stop after a complete step; never leave a half-finished view on `main`.

## 12. Acceptance checklist

- A new viewer can state the request, current owner, outcome and whether the founder is needed within 15 seconds, from the header, headline and floor alone.
- No `test-…`, `retire-…` or `cmp-test-…` API is visible without the retired toggle. No test-traffic order is visible without the test-traffic toggle. Toggled-on test rows carry `TEST TRAFFIC`.
- Every decision line in the feed and every decision card shows the stored reason verbatim and links to the CREAO run when a `run` row exists; otherwise it says `no run link recorded`.
- Switching orders updates headline, floor, feed and drawers together with nothing from another order mixed in.
- The org chart's counts match a SQL count over the same scope for at least `coo_accepted`, `audit_accepted` and `approval_approved` (write the three queries and their results in `docs/progress.md`).
- Engineering shows trigger, CFO decision, budget, each attempt with its own tests and Auditor verdict, founder approval and ship as separate steps, with `RECORDED` and timestamps for finished jobs.
- Approve and Reject call `decide_approval`; a non-founder identity sees disabled buttons and "Founder identity required"; an error renders under the card.
- Every unknown event kind renders through the fallback; none is dropped (`Show all events` row count equals the SQL count for the visible scope).
- `TEST MODE`, `SIMULATED PAYMENT`, `TEST TRAFFIC`, `RECORDED` labels are present where §2 requires them. `sleeping`, `projected`, `guaranteed` do not appear.
- Keyboard: tabs, chips, stations, feed expanders, approval buttons and the modal are reachable and operable; Esc closes drawers and the modal.
- Laptop (1920×1080 and 1440×900) and phone (390×844) screenshots are in `docs/proof/redesign/` and listed in `docs/progress.md`.
- `pnpm -C web typecheck` and `pnpm -C web build` pass at every commit.

## 13. Handback

For the reviewer, after each step: the commit hash, the screenshots, the `docs/progress.md` row (step, status, what was verified, which interactions), and any item from §16 you hit. Write what you did not verify as plainly as what you did. The reviewer answers in [redesign-review.md](redesign-review.md); read its newest section before starting the next step and answer each numbered item in your progress row.

## 14. Files you will touch

`web/src/App.tsx`, `Office.tsx`, `Floor.tsx`, `scene.ts`, `Drawer.tsx`, `Detail.tsx`, `Events.tsx` (delete or reduce to the raw expander), `Engineering.tsx`, `Controls.tsx`, `Apis.tsx`, `styles.css`, `main.tsx` (add `tables.refund` to the subscription), new `Header.tsx`, `OrderHero.tsx`, `Feed.tsx`, `feedText.ts` (the §7 map, pure, unit-testable), `NeedsYou.tsx`, `DroidStrip.tsx`, `OrgChart.tsx`, `Avatar.tsx`, `scope.ts` (`isRealOrder`, visible-scope helpers). Keep `module_bindings/` generated; do not hand-edit.

## 15. Things that are already true (do not re-verify, do not break)

- Ticket #6 is the real open-roles compile: attempt 1 failed the live test, the Auditor sent it back, attempt 2 passed in the resumed session, approval #10 shipped it as v1.0 (`docs/compile-proof.md`). Approvals #4 and #8 are real rejected `droid_action` requests. The Engineering view must show these as they are.
- Order #199 is the honest research-and-reject story (Wikipedia source, Auditor rejected a missing field, API retired). It must stay visible as a real order with `Audit rejected`.
- `creao` `run` rows have no `shareUrl` yet (39 runs, 0 share links); the thread link fallback (already used in `Engineering.tsx`) is the normal path until the founder creates share links. One public CFO share link exists in `docs/creao/deployment.md`, but it is not on a `run` row; do not hardcode it in the UI.
- The floor already renders purely from rows and animates only on state change. Keep it that way.

## 16. Open questions for the reviewer

Append here as you go. Known at handoff:

1. AGENTS.md §9 says the replay centerpiece is the `gpu-listings` compile; the real compile is `open-roles` (ticket #6). The founder should update §9. The Engineering timeline of ticket #6 is that centerpiece.
2. The `agent1q` rule for real orders is a convention, not a stored flag. If the Front Desk ever registers a customer with another prefix, the filter must be revisited. A stored `source` on `customer` would be the additive fix after the hackathon.
3. `Agent decisions : Founder approvals` counts events, not unique decisions; a rework counts twice (rejected then accepted). State this in the tooltip.
4. **Scoping `approval_*` events** (found Oct 24 19:15 PT while computing the §6.11 counts). These events are `refType=approval`, so the §4 rule treats them as company-level and the real-order view would count all 10 approvals, 7 of which belong to retired `cmp-test-*` compiles or test-order refunds. Scope them through the payload instead: `ticketId` → the ticket's API is not retired (covers `api_ship`, `spend_over_cap`, `droid_action`); `refundId` → the refund's order is real (needs `tables.refund`). With that rule the real-order header pair is **16 : 1** (16 agent decisions; 1 founder approval, #10, the open-roles ship) and all-traffic is **200 : 10**. State the scope in the tooltip as §6.1 says.
5. **Real-scope edge counts for step 3 to check against** (same snapshot; the SQL-equivalent is the §4 rule applied to `event` joined with `orders`, `customer`, `canary_order`, `ticket`, `api_retired`): requests 9 · rejected at the desk 0 · paid orders handed over 5 · research requested 1 · reports filed 1 · runs ordered 5 · rejected with a reason 0 · deliverables for audit 5 · delivered 4 / rejected 1 · challenges 1 (upheld 0, rejected 1) · compile tickets 2 · builds funded 1 · builds submitted 2 · sent back for rework 1 · publish approvals requested 1 · publish approved 1 / actions denied 0 · rule changes 47. Zero-count edges render faint, not hidden, so the chart keeps its shape when the toggle flips. The two `compile tickets` are #1 (yc-directory, challenge trigger, closed) and #6 (open-roles).
6. **Feed actor for `route` and `procedure` events.** §7 maps them to a muted "System", which makes the Apify and Bright Data steps of every order anonymous. Derive a named actor from the kind instead: `api_run_started`, `api_run_ingested`, `api_run_waiting_for_task`, `apify_task_*` → **Warehouse** (avatar `WH`, Apify tone); `values_verified`, `challenge_rechecked`, `research_fetched` → **Bright Data** (avatar `BD`); `creao_run_*` → the role named in the payload. "System" stays for schedules, smoke tests and anything else without a better owner.
