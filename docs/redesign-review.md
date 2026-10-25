# Dashboard redesign: review notes

Reviewer notes, one section per spec §11 step, newest first. The implementer reads the newest section before starting the next step and answers each numbered item in its `docs/progress.md` row (done, deferred to step N, or disagree and why). Items under **Fix** ride along in the next step's commit; **Carry forward** items are due in the step named.

## Step 2 · `1d389b3` · approved

Checked: the diff of all 21 files (secret scan clean); `pnpm -C web typecheck` and `build` on the clean tree; the nine `step2-*` screenshots; the live page at `localhost:5180` as a viewer, 1920×1080. Headline for #205 reads `#205 · open-roles for lattice · Delivered · 21/21 verified · $1.00 TEST MODE · SIMULATED PAYMENT · 1m 41s · customer agent1q25u…`, for #199 `Audit rejected · 1/1 verified · 12m 37s`. This-order feed: #205 shows exactly the 7 story kinds (`order_quoted`, `order_paid`, `coo_accepted`, `api_run_started`, `api_run_ingested`, `values_verified`, `audit_accepted`) plus `Show 11 more events (plumbing)`; #199 shows 19 story rows (4 gate checks with `citation ↗` links to robots.txt, the article and the Wikimedia terms; Research report; `api_created`; Apify Task rows; the second COO decision; failure-styled `audit_rejected`; `api_retired`) plus 26 plumbing. Every CREAO decision links to `https://agent.creao.ai/chat?threadId=…`, `api_run_ingested` to the Apify dataset. The expander on `values_verified` shows `kind`, `order #199 · event #1772 · 18:08:03` and the JSON; `Verify details →` opens the Verify drawer and Esc closes it. **Step 1 fix 1 confirmed:** toggle on, pick #204 (`TEST TRAFFIC canary`, feed `ORDER #204`), toggle off → headline, feed and chip return to #205, 0 `TEST TRAFFIC` badges. **Fix 2 confirmed:** gear → focus on the Close button; Esc → focus back on the gear. Honesty grep: none of sleeping/projected/guaranteed. Company view: 135 story rows in the real scope; `Show all events` → 433. I recomputed 433 independently from SQL by applying the §4 rules to `event` joined with `orders`, `customer`, `canary_order`, `task`, `ticket`, `approval`, `refund`, `run`, `api_retired` (`/tmp/forgeui/scopecount.mjs`): config 35 · staff 21 · api 17 · order 59 · ticket 18 · task 218 · run 42 · budget 18 · approval 2 · challenge 3 = 433. The 100-event company page renders as 99 rows because consecutive `research_fetched` rows group; the "in scope" number counts events, which is right. `budget.cap_cents = 2000` by SQL after the live cap check. The `isNewApi` inference for the second COO decision on #199 (`api.createdAt ≥ order.createdAt`) is sound; keep it.

**Fix (in the step 3 commit)**

1. Company-level rows outside `config`/`budget`/`staff` vanish in the real scope. `useEventScope` returns `false` for unknown `refType`s, which drops 139 events: `route` 7 (`route_ping`), `url` 27 (`http_smoke` 7, `verify_probe` 20) and `customer` 105 (`customer_registered`). §4 says company-level rows always show, and acceptance §12 wants the Show-all count to equal the SQL count for the scope. Return `true` for `url` and `route`, and scope `customer` by the customer's own `asiSender` (`agent1q`, 4 of 105 customers: #12, #18, #54, #105). Expected real-scope Show-all count after the fix, on today's data: 433 + 7 + 27 + 4 = 471. Keep `default: return false` so a future unknown refType is a visible gap rather than noise.

**Carry forward**

2. Floor captions still carry `$` with no `TEST MODE` in the same card: Front Desk `Paid $1.00`, CFO vault `cap $20.00 · used $5.40`, Treasurer `$1.00 in · $0.0039 cost · bonuses $0.10`. The header badge is on another card, so §10's rule fails on the floor. For step 6 (floor text diet): either drop the amounts from captions (the headline already shows the price) or put one `TEST MODE` tag inside the floor panel.
3. Step 7 (dataset QR code) is cut; see spec §11. Nothing to build.
4. Spec §8 now lists the Warehouse and Bright Data avatar tones you used (`#97d74f`, `#5fb8e8`) so they are not off-spec.

Nits, no action: the phone media query in `styles.css` has one over-indented `.stats` line; `Feed.tsx` `useLayoutEffect` sets `scrollTop = 0` on every company re-render, which also fires on live inserts (acceptable since the company list is newest-first). Not verified by me either: auto-scroll and the pulsing dot on a running order (no order in flight).
## Step 1 · `ebc4e82` · approved

Checked: the diff of all 12 source files; `pnpm -C web typecheck` on the clean tree; the live page at `localhost:5180` with agent-browser as a viewer. Header shows four numbers with `TEST MODE` on every `$`, `LIVE`, `Viewer`, gear; tabs carry `role="tab"` and `aria-selected`; real-order chips are exactly #205 #202 #199 #196 #131 #123 #104 #27 with #20 reachable by search; `Show test traffic` flips revenue $5.00 → $67.00, 8 chips, 5 `TEST TRAFFIC` badges, `26 running · 60 unpaid quotes`; Catalog shows the 3 live APIs with the 15 retired ones behind the toggle, and the yc-directory card carries ticket #1's "Closed by the founder" line, which matches `compile_job` ticket 1 → api 2; the Controls modal shows 4 levers plus Advanced, read-only for a viewer, closes on Esc and on backdrop click; the page text contains no `sleeping`, `projected` or `guaranteed`. `isRealOrder` matches §4 and its comment explains the convention. `engText.ts` already covers the §6.8 status table.

**Fix (in the step 2 commit)**

1. Hidden selection drives the floor. Pick a `TEST TRAFFIC` order (I used #204), then untick `Show test traffic`: no chip is selected, but the floor keeps rendering #204 (REJECT at the COO) with no `TEST TRAFFIC` badge anywhere. The real-orders view is showing test traffic unlabeled, which §4 forbids. In `OfficeTab`, a picked order that is no longer visible counts as unpicked: `const selectedId = picked !== null && visible.some((o) => o.id === picked) ? picked : auto;` and clear `picked` in an effect so `newer` is not computed against a stale pick. Once the headline exists (step 2), the same rule keeps headline, floor and feed on one order.
2. Modal focus. Opening the Controls modal leaves `document.activeElement` on the gear. Move focus into the dialog on open (`autoFocus` on the Close button or the first enabled input) and return it to the gear on close. §9.

**Carry forward**

3. `tables.refund` is still missing from the `main.tsx` subscription list; step 4's `refund_over_limit` card needs it (§6.5).
4. The phone `Pipeline` rows still show durations (47 s, 19 s, …). The spec only cuts them from the floor; decide in step 6 whether the phone keeps them and say which in the progress row.
5. Spec §16 items 4–6 (added with this note) change the inputs of steps 2–4: approval events need payload scoping, the real-scope edge counts for the org chart are listed, and `route`/`procedure` feed rows get a named actor instead of "System". Read them before the feed work in step 2.

Nit, no action: `.stat b { font-size: 18px; }` is declared twice in `styles.css`.
