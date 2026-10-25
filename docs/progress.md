# In-progress work

This log tracks the work authorized after the CREAO setup. All money and payments are **TEST MODE**.

| Work | Status | Completion check |
|---|---|---|
| Commit the compile worker's existing changes | Done | Typecheck, module and web builds, workspace tests, 19 module unit tests, and 3 live compile CLI tests passed |
| Clean live test fixtures and stuck jobs | Done | Both `cmp-test` listings retired with orders, versions, and books unchanged; YC ticket 1 closed from the founder dashboard; isolated compile suite 8/8 |
| Founder controls and approvals | Done | Budget changes enforced live; real ship approval #10 approved through the dashboard; other identities read-only |
| Engineering view | Done | Real failed attempt, Auditor rejection, resumed session, accepted tests, approval and shipped state rendered in Brave |
| Automated Tier 1 compile | Done | Ticket 6 shipped through real Droid, Auditor and dashboard approval; two canaries passed; independent buyer order 196 paid and received version 20 |
| Research admission gate | Done | Order 199: automatic checks, 122-second comparison, real Research report and COO-created Apify Task; Auditor honestly rejected a missing field and API was retired |
| Customer challenge | Done | ASI:One order 202, challenge 14: real saved/fresh fetch and Auditor ruling; department quote matched, so challenge was rejected |
| ASI:One and two-device validation | Done | Order 202: Stripe test checkout → compiled API → 21 verified values delivered in ASI:One → challenge 14; physical phone live updates confirmed |
| Demo payment shortcut | Done | FORGE_DEMO_PAY=true: ASI:One order 205 skipped checkout, labeled chat/dashboard/books SIMULATED, and delivered 21 real verified values; 34 relevant tests passed |

## Current evidence

- CREAO agents and the real CFO decision are recorded in [deployment.md](creao/deployment.md).
- The buyer purchased `open-roles` through the real FET testnet Payment Protocol and received 21 verified values before and after compilation. Logs: `fetch-agents/buyer/logs/20261024T222758Z.json` and `fetch-agents/buyer/logs/20261025T005417Z.json`.
- `open-roles` is now Tier 1, Actor `RdQhIe6Jj6mE2qT4L`, version 1.0. Both other seeded APIs remain Tier 0. The two simulated `cmp-test` fixtures are retired.
- A physical phone loaded the dashboard through Tailscale and the user confirmed a $20.00 → $21.00 cap change appeared without refresh. The cap was restored to $20.00.
- The founder dashboard lowered the budget cap from 2000 to 40 cents: ticket 6 became ineligible and its reservation was released. Restoring the cap requeued it. Both changes are recorded in live reducer events.

## Validation constraints

- Compile integration tests must not claim the live `open-roles` worker task. Run them in an isolated database.
- Founder approvals use the dashboard's founder identity and reducer calls.
- Replay, iteration routing, Books, optional extras, and submission materials remain outside this in-progress batch unless needed to complete one of the rows above.

## Batch completion

All rows above are complete. `docs/astra-advice.md` remains unchanged in its separate commit `cd51860`; none of its advice has been acted on. The demo flag is enabled in the ignored local `.env`, while `.env.example` defaults off. The Front Desk and dashboard are running.

## Dashboard redesign (branch `dashboard-redesign`)

Handoff spec: [dashboard-redesign-spec.md](dashboard-redesign-spec.md), binding for `/web`; AGENTS.md §8 was rewritten to match it. The implementing agent appends one row per spec §11 step after that step's commit (commit hash, screenshots in `proof/redesign/`, interactions exercised, anything not verified). The reviewer comments on each row before the next step.

| Step | Status | Verified |
|---|---|---|
| Handoff: spec written, AGENTS.md §8 rewritten, §2 "Not building" list reconciled | Done | Markdown fences and table widths checked; no code changed; dashboard still serves the current UI at `localhost:5180` |
| Step 1: header diet, catalog cards, Controls modal, `isRealOrder` + Show test traffic | Done, awaiting review | `pnpm -C web typecheck` and `build` pass. Browser (agent-browser, viewer identity): header shows only revenue $5.00, verified 100% 85/85, cost/call $0.0041–$0.0291, 3 APIs for sale, LIVE, Viewer, gear; no treasury/budget/db/identity. Real-order filter shows exactly #205 #202 #199 #196 #131 #123 #104 #27 as chips, and #20 via search (the 9 real orders). Picker: 0 running · 4 unpaid quotes. Chip #202 switched the floor to order 202. Search `#199` left one chip. Show test traffic: canary/test chips badged TEST TRAFFIC (+canary), header revenue $67.00 and 1258/1274 verified. Catalog: open-roles (Tier 1), gpu-listings, yc-directory only; Show retired lists 15. Controls modal opens from the gear, shows 4 levers + Advanced, read-only for the viewer, Esc closes it. Floor legend and durations removed. "sleeping" copy replaced by "No engineering queued"; page `textContent` has no sleeping/projected/guaranteed. Screenshots: `proof/redesign/step1-office.png`, `step1-office-1440.png`, `step1-office-test-traffic.png`, `step1-search-199.png`, `step1-catalog.png`, `step1-catalog-retired.png`, `step1-controls-modal.png`, `step1-phone-office.png`. Not verified: saving a lever (no founder identity in the test browser; the cap live-update check is scheduled after step 2). Not yet done (later steps): tabs still lack Org chart, approval cards and the raw Events panel are unchanged, phone layout untouched. |
| Step 2: order headline, sentence feed (§6.6, §7) replacing `Events.tsx`, 7fr/3fr rail | Done, awaiting review | `pnpm -C web typecheck` and `build` pass. Browser (agent-browser): headline reads `#205 · open-roles for lattice · Delivered · 21/21 verified · $1.00 TEST MODE SIMULATED PAYMENT · 1m 41s · customer agent1q25u…`. This-order feed for #205 shows 7 story rows (Front Desk quote and paid, COO accept with its reason and CREAO thread link, Warehouse run and Dataset link, Bright Data 21/21, Auditor accept with link) plus "Show 11 more events (plumbing)". #199 shows the research gate checks with citations, the Research report, the new API created for the order ("Accepted: create a new wikipedia-palace-fine-arts API", decided from `api.createdAt` ≥ order time, not inferred from wording), the failure-styled Auditor rejection and the founder's retirement. #202 shows challenge opened, recheck in 1.0 s and the Auditor's rejection. Expanding the recheck row shows kind, `challenge #14` and the JSON; "Verify details →" opened the Verify drawer and Esc closed it. Company view: 133 story rows in the real scope, 431 with Show all events, 1846 with test traffic on (equals `SELECT … FROM event`, 1846 rows, so no kind is dropped). **Live check** (founder token from `spacetime login show` placed in a separate agent-browser session's localStorage, then removed): cap $20.00 → $20.01 → $20.00 from the Controls modal; both `budget_cap_set` rows appeared in the company feed without a reload, the header shows no budget, and SQL confirms `cap_cents = 2000`. Honesty check: none of sleeping/projected/guaranteed. Review items: **1** done (`useOrderSelection` drops a pick that left the visible scope; #204 picked then toggle off → floor, headline and chip all return to #205, 0 TEST TRAFFIC badges); **2** done (focus moves to Close on open, back to the gear on Esc); **3** done (`tables.refund` subscribed, used by the event scope); **4** deferred to step 6; **5** done (§16.4 approval scoping in `useEventScope`; §16.6 actors: Warehouse/Bright Data/run role, System only otherwise). Nit (duplicate `.stat b`) fixed. Screenshots: `step2-office.png`, `step2-office-199.png`, `step2-feed-expanded.png`, `step2-office-drawer-verify.png`, `step2-feed-company.png`, `step2-live-cap-change.png`, `step2-office-1440.png`, `step2-phone-office.png`, `step2-phone-feed.png`. Not verified: auto-scroll and the pulsing dot on an order that is still running (no order was in flight, and the spec forbids creating one). The order feed omits ticket events (compile work belongs to the Engineering view). Approval cards still sit above the tabs until step 4. |
