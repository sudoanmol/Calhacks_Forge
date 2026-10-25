# Dashboard redesign: review notes

Reviewer notes, one section per spec §11 step, newest first. The implementer reads the newest section before starting the next step and answers each numbered item in its `docs/progress.md` row (done, deferred to step N, or disagree and why). Items under **Fix** ride along in the next step's commit; **Carry forward** items are due in the step named.

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
