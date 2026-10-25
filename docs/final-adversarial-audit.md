# FORGE final adversarial audit (pre-submission)

- **Scope.** Release readiness of the refund work in `docs/paid-failure-spec.md` and of the paid-order lifecycle around it, for the Cal Hacks demo. This is not a security or style review.
- **Audited.** `main` at `214932c80af9ad40ebb3064040f6a1006b53cdd5`, four commits ahead of `origin/main` at `9da0a926b9f0d151ca3d635529a648e13b323f81`. Sun Oct 25 2026, about 00:00 to 01:45 PT.
- **Method.** End-to-end code reading (module, Front Desk, forge-cli, CREAO prompts, dashboard), the existing suites, and temporary scripts in `/tmp/forge-final-audit/` run against local SpacetimeDB databases named `forge-final-*` on `127.0.0.1:3000`. Maincloud was only read (anonymous `SELECT` and `spacetime describe`). Nothing was published, refunded or created on Maincloud. No tracked file was changed.
- **Words.** *Verified* means a test or script I ran passed. *Inspection* means code reading only. *Unverified* means neither. Line numbers refer to `214932c`. `index.ts` means `module/src/index.ts`.

---

## 1. Executive release verdict

| Decision | Verdict | Why |
|---|---|---|
| Push the four refund commits to `origin/main` | **GO** | Full diff reviewed; the spec is met; no P0; refund, challenge, order, API and upgrade tests pass; plain fast-forward of `origin/main`; exactly the 16 expected files. |
| Refund implementation against `docs/paid-failure-spec.md` | **PASS** | Every §8 acceptance item holds, including the two the implementer left unverified (delivered-order refusal, UPHELD challenge refund through the shared helper). One test deviation: the committed retry test drives an Apify *start* failure, not an ingested `FAILED` run (§3). |
| Publish the module to Maincloud | **GO, run by the founder, following §14** | Schema change is additive (one new reducer, no table or column change). Publishing HEAD over old data was replayed locally twice: empty migration plan, statuses preserved, nothing refunded automatically. The #199 repair was replayed end to end on a local replica built from a real Apify + Bright Data run. |
| Product claim "a paid customer always gets a deliverable or a refund" | **NOT YET TRUE** | Pre-existing gap **F1**: when a CREAO run ends without its reducer call, or its webhook never lands, or CREAO refuses to start runs, the order sits in `paid`, `triaging`, `researching` or `auditing` forever with the money held, and no reducer (including the new `refund_order`) can resolve it. Never seen on Maincloud (0 `task_ended_without_decision` events across about 200 CREAO tasks), but it is the same failure class the refund work set out to close. Fix A in §11 closes it. |

Top findings (full list in §5 and §6):

| ID | Sev | Finding |
|---|---|---|
| F1 | P1 | A CREAO run without a decision, a lost CREAO webhook, or a CREAO start-failure loop strands a paid order with no refund and no founder rescue. Two lost webhooks stop all dispatch (`creao_max_concurrency` = 2). |
| F2 | P1 (trust) | "Refunded" means a FORGE ledger credit. No Stripe or FET refund is ever issued, yet chat says "your payment was refunded" and the dashboard says "Refunded". Header "revenue" is net ledger cash and silently includes a SIMULATED payment. |
| F7 | P2 | The Office floor says "Queued for a CREAO run" while the CREAO run is actually running, which is the demo script's 0:30 beat. |
| F8 | P2 | `audit_verdict` ACCEPT has no deterministic floor: an LLM ACCEPT on zero verified values delivers nothing and keeps the money. |
| F3, F4 | P2 | Refund wording contradicts state: the counteroffer text always claims a refund; the feed says "Refunded by the founder" for a pending refund and never shows the decline in the order's feed. |

Recommended order for the remaining hours: Fix A-min (founder "stop and refund" for stalled orders, about 1 h with tests), Fix B (refund and revenue wording, about 45 min), Fix F (floor caption, 10 min). Then Fix A-auto if time allows. Everything else can wait until after judging.

---

## 2. Latest four commits reviewed

| # | SHA | Subject | Files | +/− |
|---|---|---|---|---|
| 1 | `f8252d75f156e7f746d1cd0098a91136d47d8659` | feat(module): refund paid orders that end without a deliverable | `module/src/index.ts`, `module/test/refunds.test.mjs` (new), `web/src/module_bindings/index.ts`, `web/src/module_bindings/refund_order_reducer.ts` (new), `web/src/module_bindings/types/reducers.ts` | +281 / −23 |
| 2 | `003eb2d8ffe7bb48755c645157c3f858b8097b79` | feat(front-desk): report refunds in the status reply | `fetch-agents/front_desk/agent.py`, `status.py`, `stdb.py`, `fetch-agents/tests/test_status.py` | +39 / −5 |
| 3 | `554742aa81d0bfe1b4257113f50e3c8ca5b09f25` | feat(web): refund badge and founder refund on dead-end orders | `web/src/App.tsx`, `NeedsYou.tsx`, `OrderHero.tsx`, `feedText.ts`, `styles.css` | +49 / −6 |
| 4 | `214932c80af9ad40ebb3064040f6a1006b53cdd5` | docs: record the refund rule and its checks | `docs/paid-failure-spec.md`, `docs/progress.md` | +9 / −8 |

All four: author Anmol Hurkat, 2026-10-24 22:04:42 −0700. Total `9da0a92..214932c`: 16 files, +378 / −42.

Checks:

- **Ancestry.** Branch `main`. No upstream tracking branch is configured (`git rev-parse @{u}` fails), so every comparison names `origin/main` explicitly; `origin/HEAD` points to it (`git@github.com:sudoanmol/Calhacks_Forge.git`). After a fresh `git fetch`, `git ls-remote origin refs/heads/main` returns `9da0a92…`, `git merge-base --is-ancestor origin/main HEAD` succeeds, and the branch is 0 behind and 4 ahead. A push is a fast-forward.
- **Push.** Done after this audit: `git push origin main` printed `9da0a92..214932c main -> main`, and `git ls-remote origin refs/heads/main` returns `214932c80af9ad40ebb3064040f6a1006b53cdd5`. No hook or CI runs on push (no `.github/`, only sample git hooks), so nothing was deployed.
- **Scope.** Every changed file belongs to the spec. No secrets, lockfiles, configs or unrelated files.
- **Bindings.** I regenerated bindings from HEAD's module into `/tmp` (`spacetime generate --lang typescript -p module`): **0 lines differ** from the committed `web/src/module_bindings`.
- **Working tree.** No tracked modifications. Untracked: `docs/final-hackathon-winning-audit.md` (created 00:41 by a concurrent session; not read for this audit, not included). `docs/order-states.html`, untracked and referenced by the spec, disappeared during the audit; I did not delete it. `docs/proof/web-refund-order.png` is gitignored. This file is untracked and is not part of the push.
- **Regressions outside the refund path.** `failOrder` now also refunds; all of its callers are paid-path transitions (`index.ts:1477-1483`, `:2325`, `:1451`). Apify start failures now retry once after 5 s instead of failing at once (one more Apify run, intended). The UPHELD challenge block moved into `refundOrder`: amounts and accounts are unchanged, the ledger memo text changed, and `approval.detail` gains `cause`; `NeedsYou.tsx:105` treats a missing cause as a challenge, so pre-upgrade approvals render as before. Canary orders (price 0) produce no refund rows (`index.ts:817`). Nothing in compile, research, dispatch, routes or forge-cli changed. Typechecks, the web build, pytest and the module suites pass (§4).

---

## 3. Refund-spec compliance assessment

| Spec | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| §2.1 | A paid order that ends without a deliverable is refunded automatically by reducer code | `refundOrder` is called from `coo_decide` (`index.ts:990`), the admission catch (`:2139`), `audit_verdict` (`:1007`), `failOrder` (`:1444`) and UPHELD `challenge_verdict` (`:1118`) | refunds.test T1, T2, T3, T4; probe A1; probe-real P1; challenge.test T4 | PASS for every exit into `rejected`, `counteroffered`, `audit_rejected`, `failed`. The F1 exits never reach these call sites. |
| §2.2 | Only the Apify run is retried | `retryOrFail` (`:1449-1454`) is used only by the start failure (`:1517`) and a non-`SUCCEEDED` ingest (`:1680`) | refunds.test T3, T4 | PASS |
| §2.3 | Limit and approval rule unchanged | `decide_approval` refund branch (`:1166-1172`) unchanged apart from the memo | refunds.test T5; probe A2 | PASS |
| §2.4 | Additive only; `refund.challengeId` = 0 without a challenge; one new reducer | Maincloud vs HEAD: 40/40 tables, 0 column differences; reducers 34 → 35 (`refund_order(orderId u64, reason string)`) | `spacetime describe` comparison; local upgrades show an empty migration plan | PASS |
| §2.5 | Every refund writes an event; TEST MODE everywhere money appears | `order_refunded` (`:833`), `order_refund_requested` (`:1188`); TEST MODE in memos, chat lines, badge and feed | tests and browser check | PASS; wording problems F2, F3, F4 |
| §2.6 | No orders, payments or approvals created on Maincloud | Maincloud has 0 `order_refunded` events; its 6 refund rows predate the change | read-only snapshot | PASS |
| §2.7 | The founder publishes | Maincloud still has 34 reducers | `spacetime describe` | PASS (not published) |
| §3.1 | `refundOrder` helper | `index.ts:814-835`, identical in substance to the spec listing | diff | PASS |
| §3.2 | Call sites; a counteroffered order stays `counteroffered` | as above | refunds.test T2 | PASS |
| §3.3 | One retry; the `start_failed` run row carries `threadId` | the run row is inserted with `threadId: o.id.toString()` before the HTTP call (`:1488`); attempts counted by `threadId` (`:1450`) | refunds.test T3: exactly one `order_run_retried` (attempt 2), then `failed` "(after a retry)" and refunded | PASS |
| §3.3 | Config and param failures fail at once | `:1477-1483` and `:2323-2326` call `failOrder` directly | refunds.test T4 (no `order_run_retried`) | PASS |
| §3.4 | `refund_order`: founder only, dead paid orders only, "never paid", "nothing left to refund" | `index.ts:1178-1190` | refunds.test T6; probe P1 (refuses `auditing`), P2 and `delivered-refusal.mjs` (refuse `delivered`); upgrade-after (refuses `paid`, `quoted`) | PASS |
| §3.5 | Bindings regenerated and committed | `web/src/module_bindings/refund_order_reducer.ts` and two index files | regenerated diff is empty | PASS |
| §4 tests 1, 2, 5, 6 | COO reject, counteroffer, config failure, over-limit approval | `module/test/refunds.test.mjs` T1, T2, T4, T5 | 6/6 | PASS |
| §4 test 3 | Auditor REJECT refunds | not in `refunds.test.mjs` | probe-real P1 (real Apify + Bright Data), 199-after | Covered only by audit scripts; commit it (TH3) |
| §4 test 4 | Ingest a non-`SUCCEEDED` run twice | the committed test uses a fake Apify id, so the *start* fails twice (`refunds.test.mjs:99-118`) | refunds.test T3 | DEVIATION; the ingest path is inspection only (TH1) |
| §4 test 7 | `refund_order` on `delivered` → 530 | not in the committed file | probe-real P2; `delivered-refusal.mjs` 6/6 | Verified by me; commit it (TH4) |
| §4 test 8 | UPHELD still refunds through the shared helper | `module/test/challenge.test.mjs` | 5/5 | PASS |
| §5 | Front Desk refund lines, counteroffer sentence, desk rejection without TEST MODE | `status.py:26`, `:93-101`; `agent.py:91`; `stdb.py:136` | pytest 107 passed / 24 skipped | PASS; F3 and F6 |
| §6 | Feed kinds, badge, founder button, Needs-you text | `feedText.ts:144-147`; `OrderHero.tsx:62-95`; `NeedsYou.tsx:105-111` | browser check (viewer) | PASS; F4 |
| §7 step 4 | Post-publish live check | not done (founder step) | n/a | OPEN, see §14 |
| §8 | The two unchecked boxes | delivered refusal; UPHELD via the helper | probe-real P2, `delivered-refusal.mjs`, challenge.test T4 and T5 | Now verified |
| §9 | "retrying CREAO runs (the lease sweep already requeues them)" | False. `lease_sweep` only requeues `claimed` tasks (`:752`); CREAO tasks are `dispatched` (`:2365`) | inspection | Spec error; root of F1 |

`docs/progress.md:16` also says the delivered refusal and the UPHELD refund "need a delivered order, i.e. Maincloud". That is not true: I built delivered orders on local databases with real Apify runs and scripted seat verdicts.

**Verdict: PASS.** The implementation does what the spec asks and is safe to merge. The spec's scope was incomplete because of the §9 error, which leaves F1 open.

---

## 4. Verified test results

### 4.1 Executed

| Suite or script | Where | Result | Notes |
|---|---|---|---|
| `pnpm -C module typecheck` | local | exit 0 | |
| `pnpm -C web typecheck` | local | exit 0 | |
| `pnpm -C web build` | local | exit 0 | chunk-size warning only |
| `uv run pytest tests` in `fetch-agents` | local | 107 passed, 24 skipped | includes the new refund lines in `test_status.py` |
| `unit.test.mjs`, `research-unit.test.mjs`, `compile_unit.test.mjs` | node | 21/21 | |
| `refunds.test.mjs` | `forge-final-audit` (no vendor keys) | 6/6 | |
| `orders.test.mjs` | `forge-final-audit` | 8/8 | |
| `api.test.mjs` | `forge-final-audit` | 12/12 | |
| `challenge.test.mjs` | `forge-final-challenge` (real Apify + Bright Data) | 5/5 in 110 s | UPHELD refund through `refundOrder`; over-limit approval; recheck about 2.4 s |
| `delivered-refusal.mjs` (temp) | `forge-final-challenge` | 6/6 | `refund_order` on a delivered order → 530, no refund row |
| `probe-real.mjs` (temp) | `forge-final-probe` (real Apify + Bright Data) | 25/25 | P1: real run reaches `auditing` in 54 s; `refund_order` refused while auditing; Auditor REJECT → one `issued` 100 refund (challenge 0), `customer` −100 → 0, `treasury` 700 → 600, header formula 100 → 0, duplicate refund and second verdict refused. P2: delivered; `refund_order` refused; UPHELD 600 > 500 → `pending_approval` with cause `challenge_upheld`; decline keeps −600; no rescue (F5); books sum 0 |
| `probe-admission.mjs` (temp) | `forge-final-audit` | 29/29 | A1: blocked source after payment → `rejected`, one `issued` refund (cause `admission_rejected`), balance 0, no `research_gate` task, duplicate refused. A2: price 600 COO REJECT → `pending_approval` (cause `coo_rejected`); `refund_order` while pending refused; decline; `refund_order` re-requests (cause `founder`); approve → 0; third call refused; books 0 |
| `upgrade-before.mjs` / `upgrade-after.mjs` (temp) | `forge-final-upgrade`: module @ `9da0a92`, then HEAD without `--delete-data` | 7/7, 12/12 | empty migration plan; statuses kept; no automatic refunds; `refund_order` rescues old `rejected`, `counteroffered`, `failed` orders and refuses `paid` and `quoted`; retry-once works after the upgrade; module env `APIFY_TOKEN` survived |
| `199-before.mjs` / `199-after.mjs` (temp) | `forge-final-199`: module @ `9da0a92` with a real Apify + Bright Data run, then HEAD | 7/7, 15/15 | Before: Auditor REJECT → `audit_rejected`, no refund row, −100 (the #199 bug). After publishing HEAD: nothing refunded by the publish, `treasury` unchanged; `refund_order(1, "audit rejected before the refund rule existed")` → one `issued` 100 refund (cause `founder`), `customer` 0, `treasury` −100, header formula 100 → 0, reason on `order_refund_requested`, second call refused, status still `audit_rejected`, books 0 |
| Bindings regeneration | `/tmp` | 0 lines differ | |
| Schema comparison | Maincloud (`spacetime describe`, read-only) vs HEAD | 40/40 tables, 0 column differences, +1 reducer | |
| Maincloud snapshot | anonymous `SELECT` only | see §14.1 | |
| Browser (agent-browser, viewer identity, Vite against `forge-final-probe`) | local | refund badge, feed rows and header revenue matched the books | showed F4 (pending text without decline) and a duplicated "Opened a compile ticket" row (F18). I did not click the founder button myself; the implementer's screenshot `docs/proof/web-refund-order.png` covers that flow |

### 4.2 Present but not executed

- `module/test/compile.test.mjs` (real Apify runs and the compile flow; not touched by the commits).
- `module/test/admission.test.mjs` (admission gate with real Bright Data; probe A1 covers the refund branch).
- `module/test/research.test.mjs`, `module/test/creao.test.mjs` (CREAO webhooks need Maincloud), `module/test/fixes.test.mjs`.
- `skills/forge-cli/test/forge.test.mjs`; `workers/canary/test/*`; `workers/droid-runner/test/*`; `actors/*/test/*`.
- The canary (`workers/canary`) against Maincloud: running it writes orders to Maincloud, and Maincloud still runs the old module. The latest recorded results (`workers/canary/results/`, all on the old module) pass for every seeded API: `yc-directory` (2026-10-24 22:55 UTC), `gpu-listings` (22:57 UTC, after a failed attempt at 22:55 UTC), `open-roles` (2026-10-25 00:51 UTC). `AGENTS.md` §10 asks for a canary after every merge to `main`; run it after the §14.4 publish (§13 step 3).
- The live Front Desk in ASI:One on the new code (the running process must be restarted to load it).

### 4.3 Inspection only

- Late or duplicate Apify callbacks after a retry or a failure (`index.ts:1646`, `:1671`, `:1676`); used callback tokens (`:1405`, `:1718`).
- A scheduled retry firing after the order changed (`:1470`).
- `create_apify_task` failure refunding waiting orders (`:2323-2326`).
- `priceCents` never changes after creation (set only at `:870` and `:901`), so a refund computed from the price matches the payment.
- Mutual exclusion of the automatic refund triggers (§7 row 19).
- Every F1 stranding path, the floor caption (F7), the Auditor floor (F8).

### 4.4 Judge scenarios

| # | Scenario | Classification | Evidence | Missing |
|---|---|---|---|---|
| 1 | Existing API, customer pays | **Partially working** | Backend chain verified locally with real Apify + Bright Data and scripted COO and Auditor verdicts on a simulated payment (probe-real P2: delivered). Maincloud history: 4 delivered real orders (#131, #196, #202, #205). | ASI:One chat, Stripe checkout and real CREAO runs on the new module |
| 2 | Brand-new API | **Unverified** | Only the admission-reject branch ran (probe A1). Maincloud history: 14 `research_gate` tasks done; #199 itself was a new API that reached auditing. | A new-API order on the new module |
| 3 | Invalid deliverable | **Verified working** (reducer path) | probe-real P1; 199-after | The LLM Auditor choosing REJECT was not exercised; no reducer floor on ACCEPT (F8) |
| 4 | Collection fails after payment | **Partially working** | Start failure twice → failed + refund (refunds.test T3); config failure (T4); admission failure (probe A1) | A run that ends `FAILED`/`ABORTED`/`TIMED-OUT` (ingest path) is inspection only; a lost Apify webhook strands `running` (F1 group) |
| 5 | Fails once, succeeds on retry | **Unverified** | Inspection of `retryOrFail` and the `start_api_run` guard | TH2 |
| 6 | Fails twice, refunded | **Verified working** (start-failure variant) | refunds.test T3 | Ingest variant (TH1) |
| 7 | Customer challenges delivered data | **Verified working** (backend, real Bright Data recheck, scripted Auditor) | challenge.test 5/5; probe-real P2 | ASI:One leg and a real CREAO ruling on the new module |
| 8 | Founder refunds an eligible order | **Verified working** (reducer) | 199-after; probe A2; refunds.test T6 | The founder button was not re-clicked by me |
| 9 | Founder refunds an ineligible order | **Verified working** (reducer) | `delivered`, `auditing`, `quoted`, `rejected_at_desk`, non-founder and "nothing left" all return 530 with a clear message | The UI hides the button (inspection, `OrderHero.tsx:68`) |
| 10 | ASI:One status question | **Partially working** | `test_status.py` covers the three refund lines | Live Front Desk not run; refunds shown only for the newest order (F6); counteroffer text unconditional (F3) |
| 11 | Size or site limits | **Gracefully unsupported** (verified for a blocked domain at admission) | probe A1; desk checks unit-tested in `test_gate.py` | Desk page-cap counteroffer live |
| 12 | JS-heavy or blocked source | **Partially working** | Blocked: verified (A1). JS-heavy: the ladder marks unloadable pages `_page`/`unverifiable`; Auditor REJECT refunds (reducer path verified) | No JS-heavy site run this session |
| 13 | Slow external service | **Unverified** | Inspection: Apify Task timeout 300 s → `TIMED-OUT` → one retry → fail + refund; Bright Data 45 s per attempt; CREAO has no timeout (F1) | Slow-path tests |
| 14 | Dashboard refresh mid-workflow | **Unverified** this session | All order state comes from subscriptions (inspection); earlier live-update proof `docs/proof/web-gate0-after.png` | Refresh on two devices during a live order |
| 15 | Autonomous decision while another operation is pending | **Partially working** | A second verdict is refused (P1); `refund_order` during a pending refund is refused (A2); `refund_order` on an in-flight order is refused (P1) | Scheduled retry racing a state change (inspection); back-office CREAO work can delay a live order (F12) |
| 16 | Compile or repair changes the catalog | **Unverified** | The commits do not touch compile code; orders pin `apiVersionId` at ACCEPT (`index.ts:979`, read at `:1471`). Maincloud history: 6 compiles done, 3 ships | `compile.test.mjs` not run |

### 4.5 Side effects of testing

- Real Apify runs and Bright Data requests were spent on the project's accounts (about six Task runs plus verification and recheck fetches).
- My databases had no CREAO app ids and started 0 CREAO runs. The implementer's `forge-audit-test` started a real CREAO Auditor run (run 2, external id `02fe449d-cff3-4a8a-9fcf-5ea017716d4a`) whose agent read **Maincloud** order #1 through its `FORGE_DB_URL`; that run is still `pending` locally (F11).
- Local databases left on the local server: `forge-final-audit`, `forge-final-challenge`, `forge-final-probe`, `forge-final-upgrade`, `forge-final-199` (and the implementer's `forge-refund-test`, `forge-audit-test`). Delete them with `spacetime delete -s local <name>` when no longer needed.

---

## 5. P0 and P1 findings with code evidence

### P0

None. F1 is not rated P0 because it predates these commits (the commits shrink the failure class rather than create it), it has never occurred on Maincloud (0 `task_ended_without_decision` events, 0 leaked in-flight runs, 9 start failures that all recovered), and a single demo order is unlikely to hit it. It is still the most important fix before a live paid demo.

### F1 (P1). Stalled CREAO work strands a paid order with no refund and no rescue

**Location and evidence**

- `index.ts:1384-1389` (`refreshCreaoRun`): when a finished run's task is still `dispatched`, the task becomes `failed` and `task_ended_without_decision` is logged. The order is not touched.
- `refreshCreaoRun` has two callers: `creao_poll` (`:1394-1398`, founder or canary only, never scheduled) and the webhook route (`:1412`). Nothing polls CREAO on a schedule.
- `lease_sweep` (`:746-758`) requeues only `claimed` tasks. CREAO tasks go `queued` → `dispatched` (`:2365`). `cancel_task` (`:701-713`) only cancels `queued` tasks.
- `dispatch` counts CREAO runs in `starting`, `pending`, `running` or `queued` against `creao_max_concurrency` (`:2356-2358`; Maincloud value 2). A run whose webhook never lands stays in flight forever.
- On a start failure `dispatch` requeues the task with no cap or delay (`:2402-2405`), every 5 s (`DISPATCH_EVERY_MICROS`, `:1432`), each time writing a run row, a callback token and an event. Maincloud has 9 `creao_run_start_failed` events.
- `refund_order` refuses everything outside `DEAD_PAID` (`:1184`), so the founder cannot refund `paid`, `triaging`, `researching` or `auditing`.
- The only manual re-dispatch is broken. `enqueue_task` (`:687-699`) inserts `orderId: undefined`, so `dispatch` sends `orderId: ''` (`:2378`), and `skills/forge-cli/forge.mjs:370` (`String(t.orderId ?? t.input?.orderId ?? '')`) keeps the empty string because `??` does not skip `''`: the agent sees `orderId: null` and unfilled `<orderId>` steps. If it recovers the id from `input`, `closeTasks` (`:855-861`) still matches on `row.orderId`, so the rescue task is never closed and is later marked `failed` with a false `task_ended_without_decision`.
- Misleading text: `web/src/feedText.ts:203` renders "A CREAO run ended without a decision; task #N requeued", but nothing requeues it. Same in `docs/dashboard-redesign-spec.md:338`. `docs/paid-failure-spec.md:193` claims the lease sweep requeues CREAO runs.
- Same shape for Apify, with a working manual workaround: there is no scheduled `apify_poll` (`:1707-1711`, founder or canary only; the canary worker nudges only its own orders, `workers/canary/src/canary.ts:16`, `:80`). A lost Apify webhook leaves the order `running` until someone calls `apify_poll <runRef>`.
- Observed locally: `forge-audit-test` run 2 has been `pending` since about 21:54 PT Oct 24 and will never resolve, so it permanently occupies one of that database's two dispatch slots.
- Maincloud right now: 0 in-flight CREAO runs, 0 non-terminal Apify runs, no real-scope order stuck. Two canary orders (#68, #178, price 0) sit in `paid` with cancelled triage tasks, which shows the stuck state is reachable.

**Reproduction (local, no CREAO spend)**

1. Start a local server. Publish HEAD to a scratch database with `CREAO_API_KEY=invalid CREAO_APP_ID_COO=invalid` in the shell and no `PUBLIC_ROUTE_BASE`.
2. As a front_desk seat: `create_order` (price 100), then `record_payment` with a `demo-simulated:` session id.
3. Observe `creao_run_start_failed` about every 5 s with no end, the order `paid`, `customer:<id>` = −100, and `refund_order` returning 530 "order N is paid; only rejected, counteroffered, audit_rejected or failed orders can be refunded by hand".
4. Variant with a real agent that ignores the task (for example the FORGE Probe app as `CREAO_APP_ID_COO`): after the run completes, `creao_poll <runRef>` marks the task `failed` with `task_ended_without_decision`; the order stays `paid` with the money held.

**Root cause.** The agent contract ("a run that ends without a decision fails the task") is enforced on the task, but no rule turns a failed or timed-out agent task into an order outcome, and nothing reconciles runs whose webhook is lost.

**Impact.** A judge who pays can be told "with the COO for review" or "the Auditor is reviewing them" forever, with the money held and nothing for the founder to press. Two lost webhooks block every later order at `paid` until someone runs `creao_poll` by hand. A CREAO outage writes rows every 5 s per queued task.

**Minimal fix.** Fix A in §11: A-min gives the founder a "stop and refund" path for stalled orders; A-auto requeues an undecided task once, then fails and refunds the order, times out stale CREAO runs inside `dispatch`, bounds start-failure retries, and corrects the feed text and docs.

**Regression tests.** TA1 to TA6 (§11).

**Expected outcome.** Every paid order reaches `delivered` or a dead state with a refund row within a bounded time (about two run timeouts), and the founder can always resolve one by hand.

**Effort.** A-min about 1 h with tests; A-auto 2 to 3 h; tests about 1 h.

**Confidence.** High that the gap exists (code plus local evidence). Medium to low that it triggers during one demo.

### F2 (P1, trust). "Refunded" is a ledger credit; the payment rail is never reversed

**Location and evidence**

- `refundOrder` posts only ledger rows: `customer:<id>` +amount and `treasury` −amount (`index.ts:831`; approval path `:1171`). There is no Stripe or FET refund anywhere (`fetch-agents/` never calls a Stripe refund API or sends FET back; the module has no Stripe key).
- Customer wording: `fetch-agents/front_desk/status.py:26` "your payment was refunded"; `:97` "Refunded $X (TEST MODE)."; `challenge.py:90-92` "issued". Dashboard: `web/src/OrderHero.tsx:89` "Refunded $X TEST MODE"; `feedText.ts:145` "Refunded $X to the customer"; `:147` "Refunded by the founder".
- #199 was paid through a Stripe test checkout session (`cs_test_…`). After `refund_order`, the Stripe test dashboard will still show that payment as succeeded and not refunded.
- Revenue (`web/src/Header.tsx:22-25`) is minus the sum of `customer:<id>` balances over the visible orders, that is, payments minus ledger refunds. It is **net cash received in the ledger (TEST MODE)**: not gross payments (refunds are subtracted), not recognized revenue (orders still running and undelivered count), not profit (vendor costs and bonuses are not subtracted). It includes SIMULATED payments without a SIMULATED label (F9).

**Reproduction.** On `forge-final-199`, `refund_order` set `customer:1` to 0 and moved the header figure from 100 to 0, while no call to any payment provider exists in the code path.

**Root cause.** The spec defines a refund as a Treasurer ledger move; the customer-facing words came from the challenge path and were never qualified.

**Impact.** A judge asks "did the money go back to my card?" The honest answer is no, while the screen says "Refunded". Under `AGENTS.md` rules 1 and 2 this reads as an unlabeled simulation.

**Minimal fix.** Fix B in §11: say "refund booked in FORGE's ledger; the test payment itself is not reversed" on every surface, add a tooltip that defines revenue, and show the SIMULATED share. A real Stripe test-mode refund issued by the Front Desk is the behavioral alternative, but it needs a new reducer to record the Stripe refund id, so it belongs in `docs/after-hackathon.md`.

**Regression tests.** TB1 to TB4. **Expected outcome.** No surface says or implies that a payment provider returned money. **Effort.** 30 to 45 min. **Confidence.** High.

---

## 6. P2 issues and deferred concerns

### P2

| ID | Finding | Location and evidence | Impact | Fix (§11) | Effort | Confidence |
|---|---|---|---|---|---|---|
| F3 | Counteroffer status always claims a refund | `status.py:26` is unconditional. Wrong when the refund is pending (price above `refund_limit_cents`) or declined, and for every counteroffer if the Front Desk runs this code before the module is published | Chat claims money moved when it did not | B | 10 min | High |
| F4 | Refund feed contradicts state | `feedText.ts:147` says "Refunded by the founder" for every `order_refund_requested`, including `pending_approval`. The decline is logged as `approval_rejected` with `refType` `approval` (`index.ts:1172`), so the order's feed never shows it. Seen in the browser on local order #2: the order feed ends with "Refunded $6.00 … (waiting for the founder's approval)" after the founder declined; only the Company feed shows "Founder rejected refund over limit". The badge is right (`OrderHero.tsx:63`) | The founder or a judge reads a refund that will never happen | C | 30 min | High |
| F5 | A declined UPHELD refund on a delivered order cannot be re-requested | `refund_order` refuses `delivered` (`index.ts:1184`); verified (probe-real P2 "GAP"). Dead orders can re-request after a decline (probe A2) | A mistaken decline is final; the customer keeps a corrected-but-unrefunded order | D | 20 min | High |
| F6 | Status reply shows refunds only for the newest order | `agent.py:91` fetches refunds for `orders[0]`; `status.py:118-120` prints older orders as "#id status" | A customer asking about an older dead order sees no refund line | E | 20 min | High |
| F7 | Floor caption is wrong while CREAO works | `scene.ts:65` (`OPEN_TASK` = `queued`, `claimed`), `:151-152` and `:213-214` treat only `claimed` as working; CREAO tasks are `dispatched` (`index.ts:2365`) | During a live COO or Auditor run the station reads "Queued for a CREAO run"; the demo script's 0:30 beat says "its run has started" | F | 10 min | High (code); not observed live |
| F8 | Auditor ACCEPT has no deterministic floor | `audit_verdict` (`index.ts:995-1027`) accepts any ACCEPT with a reason. The floor (REJECT if N = 0, V = 0, M > 0 or V/N < 0.8) lives only in the prompt (`docs/creao/auditor.md:56`, `:91`); `compile_verdict` by contrast refuses ACCEPT unless all tests passed (`auditor.md:112`) | An LLM slip delivers nothing and keeps the payment | G | 20 min | High (code), low likelihood |
| F9 | Header revenue mixes SIMULATED and in-flight payments under "revenue" | `Header.tsx:22-25`, `:45`. Maincloud real scope today: $5.00 = #131 and #196 (64-character session ids, FET-style), #199 (Stripe test), #202 (Stripe test), #205 (`demo-simulated:`). After the #199 repair: $4.00, of which $1.00 is SIMULATED | A judge cross-checking sees an unlabeled simulated dollar (`AGENTS.md` rule 2) | B | 15 min | High |
| F10 | Retry coverage gap | `refunds.test.mjs:99-118` drives only a start failure. The ingest path for `FAILED`/`ABORTED`/`TIMED-OUT` (`index.ts:1678-1681`) and fail-then-succeed are untested | Scenario 5 is unproven | H | 45 min | High |
| F11 | Local test databases can drive real CREAO agents against Maincloud | `spacetime publish` reads declared env names from the shell (`index.ts:612-620`). A local publish after `source .env` sets `CREAO_APP_ID_*`, so local `dispatch` starts real runs whose agents use `FORGE_DB_URL` = Maincloud and act on Maincloud orders with the same ids. Observed with `forge-audit-test` | Wrong reads, wasted CREAO runs; a decision could land on Maincloud canary orders #68 or #178 (both `paid`) | I | 10 min | High |
| F12 | Back-office CREAO work can delay a live order | `dispatch` picks the oldest queued CREAO tasks of any kind (`index.ts:2359-2363`), concurrency 2 shared by all roles | A compile review or challenge audit queued just before the judge's order delays the COO by one run (minutes) | J, or raise `creao_max_concurrency` to 3 or 4 for the demo | 15 min | Medium (inspection) |
| F13 | Admission errors become permanent rejections with raw error text | The admission catch (`index.ts:2130-2140`) turns any exception, including a transient Bright Data or network error, into `rejected` plus a refund; the reason is the raw string (`:2135`), for example "Admission robots: SenderError: www.facebook.com is on the blocked domain list (facebook.com) (…)" from probe A1 | A judge's legitimate new API can be rejected by a transient fetch error; crude text in chat | Retry the failing fetch once inside `admission_precheck`; strip `SenderError:`/`Error:` prefixes | 30 min | Medium |

### P3 (defer)

- **F14.** Founder-approved refunds without a challenge get the memo "refund order N challenge 0 (TEST MODE, founder-approved)" (`index.ts:1171`). The ledger is private, so only SQL readers see it.
- **F15.** After a decline and a re-requested approval, the status reply prints both "Refunded $6.00 (TEST MODE)." and "The founder declined the refund of $6.00 (TEST MODE)." (`status.py:96-101`).
- **F16.** `PLAIN['rejected']` is "rejected by the COO" (`status.py:27`) even when the module's admission check rejected the order (event `admission_rejected` by `rules`).
- **F17.** During REPLAY, the hero badge uses today's refunds (`OrderHero.tsx:63-90`, `cursor !== null`).
- **F18.** The feed shows "Opened a compile ticket" twice for one ticket (pre-existing; seen in the browser).
- **F19.** Stale docs: `docs/progress.md:16` (delivered order "needs Maincloud"), `docs/paid-failure-spec.md:193` (lease sweep), `docs/dashboard-redesign-spec.md:338` ("requeued"), `skills/forge-cli/SKILL.md:31` (UPHELD "refunds the order"; over the limit it becomes a founder approval, which `docs/creao/auditor.md:103` states correctly).
- **F20.** A counteroffer ends the order (no accept reducer, spec §9). The customer must place a new order. The COO prompt does not say so (§9 P-5).

---

## 7. Complete money and order-state invariant matrix

Money column: refund rows written, then the balance of `customer:<id>` (0 means the customer holds nothing against FORGE; −price means FORGE keeps the payment).

| # | Scenario | Code path | End state | Money | Customer sees (status reply) | Evidence | Result |
|---|---|---|---|---|---|---|---|
| 1 | Unpaid request rejected | `reject_at_desk` (`index.ts:894-908`) inserts a new order at price 0; an unpaid quote stays `quoted` | `rejected_at_desk` or `quoted` | none; 0 (never debited) | "rejected at the desk" plus reason, no price | orders.test "desk rejection…"; refunds.test T6 (`refund_order` refuses both) | Verified OK |
| 2 | Paid, COO REJECT | `coo_decide` `:987-990` | `rejected` | 1 `issued` (`coo_rejected`); 0 | "rejected by the COO", reason, "Refunded $1.00 (TEST MODE)." | refunds.test T1; probe A2 over the limit | Verified OK |
| 3 | Paid, COUNTEROFFER | `coo_decide` `:988-990` | `counteroffered` (terminal) | 1 `issued` (`coo_counteroffered`); 0 | "counteroffered by the COO: your payment was refunded; ask for the smaller scope…" plus refund line | refunds.test T2 | Verified OK; F3 |
| 4 | Admission fails after payment | admission catch `:2130-2140` (only while `researching`, `:2134`) | `rejected` (event `admission_rejected`) | 1 `issued` (`admission_rejected`); 0 | "rejected by the COO" (F16), raw reason (F13), refund line | probe A1 | Verified OK |
| 5 | Apify run fails once, then succeeds | ingest `:1678-1681` → `retryOrFail` `:1452-1453` → `start_api_run` 5 s later | `accepted` → `running` → `verifying` → `auditing` | none; −price | "accepted by the COO, about to run" during the retry | inspection | **Unverified** (TH2) |
| 6 | Apify run fails twice | `retryOrFail` `:1451` → `failOrder` | `failed`, reason "… (after a retry)" | 1 `issued` (`run_failed`); 0 | "failed", reason, refund line | refunds.test T3 (start-failure variant) | Verified OK; ingest variant TH1 |
| 7 | Apify run fails to start | `start_api_run` `:1514-1518` → `retryOrFail` | as rows 5 and 6 | as rows 5 and 6 | as rows 5 and 6 | refunds.test T3 | Verified OK |
| 8 | Config or param failure | `start_api_run` `:1477-1483`; `create_apify_task` `:2323-2326` | `failed` at once, no retry | 1 `issued` (`run_failed`); 0 | "failed. Reason: api has no runnable version", refund line | refunds.test T4; orders.test T5 | Verified OK (`create_apify_task` variant by inspection) |
| 9 | Auditor REJECT | `audit_verdict` `:1005-1007` | `audit_rejected` | 1 `issued` (`audit_rejected`); 0 | "rejected by the Auditor", reason, refund line | probe-real P1; 199-after | Verified OK |
| 10 | Auditor ACCEPT | `audit_verdict` `:1011-1025` | `delivered`; bonuses accrued | none; −price (kept) | table and dataset link | probe-real P2 | Verified OK; F8 |
| 11 | Customer challenges | `open_challenge` (`delivered` only, `:1061`) → `recheck` → `audit_challenge` | order `delivered`; challenge `rechecking` → `auditing` | none yet | fresh quote within seconds, ruling later | challenge.test T2, T3 | Verified OK |
| 12 | Challenge UPHELD | `challenge_verdict` `:1109-1147` → `refundOrder` `:1118` | `delivered`; value superseded; challenge `upheld`; bonuses clawed back; compile or warranty ticket | 1 `issued` (`challenge_upheld`, `challenge_id` set); 0. Over the limit: `pending_approval`; −price | challenge reply with the refund state (`challenge.py:90-92`) | challenge.test T4, T5; probe-real P2 | Verified OK |
| 13 | Challenge REJECTED | `:1100-1106` | `delivered`; challenge `rejected` | none; −price | saved quote, fresh value, both timestamps | challenge.test T3 | Verified OK |
| 14 | Refund needs founder approval | `refundOrder` `:818-829` (amount above `refund_limit_cents`, 500) | order status unchanged | `pending_approval` plus `approval(refund_over_limit)` with `detail.cause`; −price | "Refund of $X is waiting for the founder's approval (TEST MODE)." | refunds.test T5; probe A2; probe-real P2 | Verified OK |
| 15 | Founder approves | `decide_approval` `:1166-1172` | unchanged | `issued`; 0 | "Refunded $X (TEST MODE)." | refunds.test T5; probe A2 | Verified OK; F14 |
| 16 | Founder declines | `decide_approval` `:1169-1170` | unchanged | `rejected`; −price (kept by an explicit decision) | "The founder declined the refund of $X (TEST MODE)." | probe A2; probe-real P2 | Verified OK; dead orders can re-request, delivered cannot (F5); decline not in the order feed (F4) |
| 17 | Founder refunds an older dead order | `refund_order` `:1178-1190` | unchanged | 1 `issued` (`founder`) plus `order_refund_requested`; 0 | refund line | 199-after; upgrade-after; refunds.test T6 | Verified OK |
| 18 | Repeated or duplicate refund requests | outstanding = price minus non-rejected refunds (`:815-817`); `refund_order` "nothing left" (`:1187`) | n/a | never a second live row | n/a | refunds.test T6; probe P1, A1, A2; 199-after | Verified OK |
| 19 | Overlapping refund triggers | each automatic trigger fires on one transition out of a live state: `coo_decide` needs `paid`/`triaging` (`:970`), `audit_verdict` needs `auditing` (`:1002`), the admission catch needs `researching` (`:2134`), `failOrder` runs only from `accepted`/`running`. A founder call during a pending refund finds nothing left | n/a | one live row | n/a | probe A2 (founder during pending refused); probe P1 (second verdict refused) | Verified for the tested pairs; the rest by inspection |
| 20 | Scheduled retry fires after the order changed | `start_api_run` returns when the status is not `accepted` (`:1470`) | no change | no change | n/a | inspection | OK by inspection |
| 21 | Late callbacks after failure or refund | Apify: terminal run returns (`:1646`), dedupe (`:1671`), a non-`running` order is ignored (`:1676`). CREAO: terminal run returns (`:1363`); late reducer calls hit status guards | no change | no change | n/a | probe P1 (late second verdict refused); Apify replay by inspection | OK; Apify replay unverified |
| 22 | Refund when the customer is already partly or fully refunded | `refundOrder` refunds the remainder only; 0 means no row | n/a | none, or the remainder | n/a | probe P1, A1, A2 ("nothing left") | Verified for full; partial by inspection (no partial refunds exist) |
| 23 | Pre-migration order enters a new refund path | publish over old data refunds nothing; `refund_order` rescues old dead orders; old in-flight orders follow the new code | n/a | n/a | n/a | upgrade-after 12/12; 199-after 15/15 | Verified OK |
| 24 | CREAO run ends without a decision | `refreshCreaoRun` `:1384-1389` fails the task only | `paid`/`triaging`, `researching` or `auditing`, forever | none; −price forever; `refund_order` refuses | "with the COO for review", "being checked by Research" or "the Auditor is reviewing them", forever | inspection; Maincloud 0 occurrences | **FAIL (F1)** |
| 25 | CREAO webhook never lands | no scheduled poll; the run stays in flight (`:2356`) | as row 24; after two such runs no order is dispatched | as row 24 | as row 24, for every new order | inspection; local `forge-audit-test` run 2 | **FAIL (F1)** |
| 26 | CREAO refuses to start runs (outage, credits) | `dispatch` requeues every 5 s, no cap (`:2402-2405`) | `paid` | −price | "paid, waiting for the COO to review it" | Maincloud: 9 start failures, all recovered | **PARTIAL (F1)** |
| 27 | Apify webhook never lands | no scheduled `apify_poll` | `running` | −price | "collecting data from the source pages" | inspection; founder workaround `apify_poll` | Latent (F1 group) |
| 28 | Auditor ACCEPTs zero verified values | no reducer floor | `delivered` | −price (kept) | delivered, empty table | inspection | Risk (F8) |
| 29 | Declined UPHELD refund on a delivered order | `refund_order` refuses `delivered` | `delivered` | `rejected`; −price; no re-request | "declined" | probe-real P2 | **PARTIAL (F5)** |

### The ten invariants

| # | Invariant | Verdict | Evidence or counterexample |
|---|---|---|---|
| 1 | No double refunds | **Holds** | Outstanding = price minus non-rejected refunds (`index.ts:815-817`); duplicates refused in refunds.test T6, probe P1, A1, A2, 199-after; triggers are mutually exclusive (row 19) |
| 2 | No negative refundable balance | **Holds** | `Math.max(0, …)` (`:816`); `priceCents` never changes after creation (`:870`, `:901`) |
| 3 | No permanently stuck paid orders | **Violated (pre-existing)** | Rows 24 to 27 (F1) |
| 4 | No retry resurrects a terminal order | **Holds** | Retries come only from `accepted` (start failure) or `running` (ingest); `start_api_run` ignores other states (`:1470`); exactly one retry (refunds.test T3) |
| 5 | No delivery after an irreversible failure | **Holds** | Delivery needs `auditing` (`:1002`); ingest needs `running` (`:1676`); second verdict refused (probe P1) |
| 6 | No mutually incompatible order, refund and challenge states | **Holds in the backend** | `delivered` plus an UPHELD refund is by design. Display contradictions: F3, F4, F15 |
| 7 | No untracked outstanding customer money | **Partial** | Every balance is in `books`, but rows 24 to 27 hold money with no resolution path. On Maincloud, 54 dead orders still hold $1.00 each (53 test-traffic orders plus #199); publishing refunds none of them; `refund_order` can |
| 8 | No accounting claim contradicted by the ledger | **Partial** | "Refunded" implies a provider refund (F2); "Refunded by the founder" on a pending refund (F4); counteroffer claim (F3); header revenue includes SIMULATED and in-flight payments (F9); memo "challenge 0" (F14) |
| 9 | Customer-visible status matches the backend | **Partial** | Older orders' refunds hidden (F6); floor caption (F7); admission rejection attributed to the COO (F16); stalled orders' text promises progress that never comes (F1) |
| 10 | No hidden dead end that needs a manual database fix | **Violated for rows 24 to 27; holds for every dead order** | No reducer can fail or refund a stalled in-flight order; the only workaround (`enqueue_task`) is broken (F1). Every dead order is reachable by `refund_order` |

---

## 8. End-to-end agent-flow gaps

The code takes payment **before** the COO decides (spec §1). The real sequence is Front Desk quote → payment → COO → (Research and admission) → Apify → Bright Data verification → Auditor → delivery → challenge or refund.

| Boundary | What runs | If slow | If a tool fails | If the agent output is malformed or unexpected | Customer recovery | Gap |
|---|---|---|---|---|---|---|
| Customer → Front Desk | ASI-1 parse, layer-2 checks (`test_gate.py`), `create_order` or `reject_at_desk`, quote | ASI-1 latency | the reply asks again (inspection) | n/a (deterministic code) | ask again | none new |
| Payment → `record_payment` | Stripe `Session.retrieve(...).payment_status == "paid"`, FET, or `demo-simulated:` | provider latency | no `record_payment` | n/a | pay again | the customer pays before the COO decides; every COO REJECT or COUNTEROFFER now refunds (verified) |
| COO (CREAO) | `dispatch` → run → `forge decide` → `coo_decide` | minutes; FIFO across all kinds with concurrency 2 (F12) | start-failure loop, lost webhook (F1) | unknown API or invalid decision → `SenderError`, the agent must retry; a run that gives up leaves the order stuck (F1) | none (F1) | F1, F12 |
| Research and admission | `startAdmission` → `admission_precheck` (robots, reachability, volatility 120 s apart) → `research_gate` → `research_report` → COO again | at least 2 minutes by design | any exception → `rejected` plus refund with raw text (F13) | no report → stuck `researching` (F1) | automatic refund for admission errors | F1, F13 |
| Executor (Apify) | `start_api_run` → Task or Actor → webhook → ingest | Task timeout 300 s → `TIMED-OUT` → one retry | start failure or `FAILED` → one retry, then fail plus refund | n/a | automatic | lost webhook (F1 group); ingest retry untested (F10) |
| Verification (Bright Data) | `verify_values` per value with the fallback ladder | 45 s per attempt, up to two countries | fetch errors caught per value (inspection) | n/a | n/a | a host crash leaves `verifying` with no reconciliation (inspection) |
| Auditor | `audit` task → `forge verdict` → `audit_verdict` | minutes | as COO | ACCEPT on zero verified values (F8); no verdict (F1) | REJECT refunds | F1, F8 |
| Delivery → customer | status reply on demand (ASI:One does not show delayed messages, `AGENTS.md` §14) | the customer must ask "status" | n/a | n/a | n/a | refund line only for the newest order (F6) |
| Challenge | `open_challenge` → `recheck` → `audit_challenge` → `challenge_verdict` | recheck about 2.4 s; ruling in minutes | recheck errors → `unavailable` → the prompt says REJECTED | no verdict → the challenge stays `auditing` forever (F1 group; no money held) | n/a | F5 |
| Founder refund | dashboard button → `refund_order` | n/a | a 530 message renders under the headline | n/a | n/a | stalled orders have no button (F1) |
| Compile or repair | trigger → CFO → Droid → Auditor → founder ship | n/a | n/a | n/a | n/a | not tested this session; in-flight orders keep their `apiVersionId` (`index.ts:979`, `:1471`) |

---

## 9. Prompt and tool-contract issues

- **P-1. "A run that ends without a decision fails the task."** Stated in `docs/creao/coo.md:66`, `auditor.md:80`, `cfo.md:63`, `skills/forge-cli/SKILL.md:47`, `forge.mjs:379-384` and `docs/creao/README.md:38`. Accurate for the task, but the order is never handled (F1). Fix the module, not the prompts; after Fix A, change `README.md:38` to "requeues the task once, then fails and refunds the order".
- **P-2. The Auditor's floor lives only in the prompt** (`auditor.md:56`, `:91`); the reducer accepts any ACCEPT (F8). Add the reducer check; keep the prompt.
- **P-3. `forge.mjs:370` uses `??`.** A task dispatched with `orderId: ''` (every `enqueue_task` task, `index.ts:693`, `:2378`) yields `orderId: null` and unfilled `<orderId>` steps. Use `String(t.orderId || t.input?.orderId || '')`.
- **P-4. `SKILL.md:31`** says UPHELD "refunds the order (TEST MODE)". Above `refund_limit_cents` it creates a founder approval instead (`auditor.md:103` is correct). Append "(above the refund limit: a founder approval)".
- **P-5. COUNTEROFFER now ends the order and refunds it**, and there is no accept path. `docs/creao/coo.md` does not say so. Add one sentence: "COUNTEROFFER ends this order and refunds it; put the smaller scope in the reason so the customer can ask for exactly that."
- **P-6. ASI:One replies are built from stored rows**, so no refund or delivery is ever hallucinated, except `PLAIN['counteroffered']` (F3). Older orders' refunds are not shown (F6).
- **P-7. Broad exception handling.** The admission catch (F13). `refreshCreaoRun` parses a 200 body without a try (`index.ts:1372`); a non-JSON 200 from CREAO would throw inside the webhook route, CREAO retries at most three times, and the run then joins row 25 (inspection, low likelihood; wrap the parse and log `creao_refresh_failed`).
- **P-8. Unbounded loops.** `dispatch` requeues start failures forever (F1). The Apify retry is bounded (two runs). One recheck per challenge.
- **P-9. Stale context and wrong database.** Tasks carry the order id at the top level and in `input` (except `enqueue_task`). The agents' database URL is fixed in CREAO secrets, so any local database with CREAO app ids drives agents against Maincloud (F11).

---

## 10. Cross-service consistency risks

| ID | Risk | Systems | Status | Mitigation |
|---|---|---|---|---|
| R-1 | Ledger refund vs payment rail | module, Stripe, FET, chat, dashboard | Verified by code: no provider refund exists | Fix B (wording) |
| R-2 | Deploy order | module, Front Desk, dashboard | Inspection | Publish the module first, then restart the Front Desk, then reload dashboards. The new Front Desk claims counteroffer refunds that the old module does not make; the new dashboard shows a refund button whose reducer does not exist on the old module (the click fails with an error under the headline) |
| R-3 | Lost webhooks starve dispatch | CREAO, module | Inspection plus local evidence | Fix A; meanwhile check in-flight CREAO runs before the demo (§13) |
| R-4 | Duplicate or late Apify callbacks | Apify, module | Inspection (`index.ts:1646`, `:1671`, `:1676`; used tokens `:1405`, `:1718`) | Write a replay test if time allows |
| R-5 | Two founder devices press Refund | dashboard, module | Verified: the second call returns "nothing left to refund" | none needed |
| R-6 | Refresh mid-workflow | dashboard, SpacetimeDB | Unverified this session | §13 step 11 |
| R-7 | Header vs books | dashboard, ledger | Verified numerically (header formula 100 → 0 after a refund) | Fix B tooltip |
| R-8 | Back-office CREAO work delays live orders | CREAO, module | Inspection | Fix J or a higher concurrency for the demo window |
| R-9 | Local databases drive agents against Maincloud | CREAO, local SpacetimeDB, Maincloud | Observed (`forge-audit-test`) | Fix I; never `source .env` before a local publish |
| R-10 | A compile ships mid-order | Droid, Apify, module | Inspection: orders pin `apiVersionId` at ACCEPT | none needed |
| R-11 | Publishing does not repair old orders | module, ledger | Verified (upgrade-after, 199-after) | The founder runs `refund_order` (§14) |

---

## 11. Exact fix instructions and acceptance tests

Conventions for every test below: the local harness of `module/test/refunds.test.mjs` (`module/test/client.mjs`; `SPACETIME_HOST=http://127.0.0.1:3000`, `SPACETIME_DB=<scratch db>`); seats created by the founder with `set_staff`; orders created through `create_order` and `record_payment` with a `demo-simulated:` session id; state read by SQL (`refund`, `books`, `event`, `orders`, `task`, `run`). Never `source .env` for local tests: it points `SPACETIME_HOST` at Maincloud and carries seat tokens and CREAO app ids.

### Fix A (F1). Every paid order reaches an outcome

**A-min, do this first: founder "stop and refund" for stalled orders.**

1. `index.ts`, next to `DEAD_PAID` (`:809`): `const STALLED = new Set(['paid', 'triaging', 'researching', 'auditing']);` and `const CREAO_RUN_TIMEOUT_MS = 15 * 60 * 1000;`.
2. `CREAO_TERMINAL` (`:1289`): add `'timed_out'`, so a late webhook or poll for a run we gave up on is ignored at `:1363`.
3. `refund_order` (`:1178-1190`): keep the `DEAD_PAID` path. Add a branch for `STALLED.has(o.status)`:
   - Refuse with `SenderError("order N is <status> and still has work in flight (task #T <status>); wait for it or cancel the task first")` when any task with `orderId === o.id` is `queued` or `claimed`, or when the order's `admission_job` is `pending`, `checking` or `waiting`.
   - For each task of this order that is `dispatched`: find its CREAO run (`run.taskId === task.id`, status `starting`, `pending`, `running` or `queued`). If that run started less than `CREAO_RUN_TIMEOUT_MS` ago, refuse ("the CREAO run is still working; try `creao_poll` or wait"). Otherwise set the run to `timed_out` with `endedAt`, the task to `failed`, and log `creao_run_timed_out`.
   - Then `const failed = setOrder(ctx, o, { status: 'failed', decisionReason: `Stopped by the founder: ${reason}` }, 'founder', 'order_failed', { reason, stalledAt: o.status });`, `const row = refundOrder(ctx, failed, 'founder', 'founder');`, and the existing `order_refund_requested` event.
   - Every other status (`quoted`, `rejected_at_desk`, `accepted`, `running`, `verifying`, `delivered`) is refused as today.
4. `web/src/OrderHero.tsx:68`: also show the button to the founder when `STALLED.has(order.status)` and the order has no task in `queued` or `claimed` (pass the order's tasks from `App.tsx`, which already subscribes to `task`). Label it `Stop and refund {usd(outstanding)} · TEST MODE`. The reducer stays the authority.
5. Docs: add the procedure to the runbook in §13.

**A-auto: requeue once, then fail and refund; time out stale runs; bound start failures.**

1. Add `settleUndecidedTask(tx, task, actor, why, final)` after `refreshCreaoRun`:
   - If `!final` and fewer than two CREAO runs with `taskId === task.id` and `status !== 'start_failed'` exist: set the task to `queued` and log `task_requeued` with `{ why, runs }`.
   - Otherwise: set the task to `failed`, log `task_ended_without_decision` with `{ why, runs }`. If `task.kind` is `coo_triage` (order `paid` or `triaging`), `research_gate` (`researching`) or `audit` (`auditing`) and the order is still in that state: `setOrder(..., { status: 'failed', decisionReason: `The ${task.role} agent did not reach a decision (${why}).` }, 'rules', 'order_failed', ...)` and `refundOrder(tx, failed, 'treasurer', 'agent_no_decision')`. For `audit_challenge`, `cfo_compile` and `audit_compile`, only fail the task (no money is held); leave the challenge as is and note it in the event.
2. `refreshCreaoRun` `:1385-1389`: replace the direct update with `settleUndecidedTask(tx, task, actor, `run ${status}`, false)`.
3. `dispatch`, inside the first `withTx` before `inFlight` (`:2356`): for each CREAO run in `pending`, `running` or `queued` that started more than `CREAO_RUN_TIMEOUT_MS` ago, set `timed_out` and `endedAt`, log `creao_run_timed_out`, and call `settleUndecidedTask(tx, task, 'dispatch', 'run timed out', false)` for its `dispatched` task. (The orphan-recovery loop at `:2348-2355` already iterates and updates runs the same way.)
4. `dispatch` start failure (`:2402-2405`): if the oldest `start_failed` run for this task started more than 5 minutes ago, call `settleUndecidedTask(tx, cur, 'dispatch', `CREAO did not start the run (http ${status})`, true)`; otherwise requeue as today. Optional backoff: skip a requeued task whose latest start failure is under 30 s old.
5. `web/src/feedText.ts:203`: render `task_ended_without_decision` as "A CREAO run ended without a decision ({why}); task #N failed", add `task_requeued` ("…; task #N gets one more run") and `creao_run_timed_out` ("A CREAO run timed out after 15 min"). Keep all three in the failure set at `:39`.
6. Docs: `docs/paid-failure-spec.md:193`, `docs/dashboard-redesign-spec.md:338`, `docs/creao/README.md:38`.
7. Optional: `enqueue_task` binds `orderId` from `input.orderId` when present, and `forge.mjs:370` uses `||` (P-3).

**Acceptance tests (new file `module/test/stalls.test.mjs`)**

- **TA1 (no vendors).** Pay an order; its `coo_triage` task is `queued` (no CREAO app ids on the database, so it is never dispatched). `refund_order` → 530 mentioning "in flight". `cancel_task(taskId, "test")`, then `refund_order` → 200. Assert: order `failed`; exactly one refund row, `issued`, amount = price, `challenge_id` 0; `customer:<id>` = 0; events `order_failed`, `order_refunded` (cause `founder`), `order_refund_requested`; `coo_decide` afterwards → 530 "is failed; nothing to decide"; a second `refund_order` → "nothing left to refund"; the books sum to 0.
- **TA2 (no vendors).** An order in `researching` whose admission job is `pending` or whose `research_gate` task is `queued` → `refund_order` refused. After `cancel_task` on the queued `research_gate` task (and once the admission job is no longer pending) → `failed` plus refund. Confirm the path in `startAdmission` (`index.ts:2062-2069`) first.
- **TA3 (real Apify and Bright Data, like probe-real P1).** Reach `auditing`; `cancel_task` the queued `audit` task; `refund_order` → `failed`, one refund, balance 0; `audit_verdict` afterwards → 530.
- **TA4 (A-auto, no spend).** Publish with `CREAO_API_KEY=invalid` and `CREAO_APP_ID_COO=invalid` (CREAO answers 401) and a shortened give-up window for the test. Pay an order. Assert the `creao_run_start_failed` events stop after the window; the task is `failed`; `task_ended_without_decision`; the order is `failed`; one refund `issued` with cause `agent_no_decision`; the books sum to 0; the CREAO run rows for the task are bounded.
- **TA5 (A-auto, small real CREAO spend).** `CREAO_APP_ID_COO=<FORGE Probe app id>` (confirm first that the probe agent never calls forge reducers and holds no seat token), a real `CREAO_API_KEY`, no `PUBLIC_ROUTE_BASE`. Pay an order; wait for `creao_run_started`; after the probe finishes (about 30 s) call `creao_poll(runRef)` as the founder → `task_requeued` and a second dispatch; after the second run, `creao_poll` → `task_ended_without_decision`, order `failed`, one refund `issued` (cause `agent_no_decision`), `customer:<id>` 0, and no CREAO run left in flight.
- **TA6 (timeout).** As TA5 but never poll, with the timeout shortened for the test: the run becomes `timed_out` and the task is requeued; a later `creao_poll` on the timed-out run changes nothing (status stays `timed_out`, no second `task_requeued`).

### Fix B (F2, F3, F9). Say exactly what moved

1. `fetch-agents/front_desk/status.py`:
   - `:26` → `"counteroffered": "counteroffered by the COO: ask for the smaller scope and we'll quote it"` (the refund line below states the money).
   - `:97` → `f"Refund booked: ${x:.2f} back to you in FORGE's ledger (TEST MODE). The test payment itself is not reversed."`
   - `:99` → `f"Refund of ${x:.2f} is waiting for the founder's approval (TEST MODE ledger)."`
2. `fetch-agents/front_desk/challenge.py:90-92`: "issued" → "booked in FORGE's ledger (TEST MODE)".
3. `web/src/OrderHero.tsx:89` → `Refunded {usd(refunded)} · ledger` plus the TEST MODE badge, with `title="Booked treasury → customer in FORGE's ledger. Test payments (Stripe test card, FET testnet) are not reversed."`.
4. `web/src/feedText.ts:145` → `Refunded {usd} to the customer in the ledger` (keep the pending suffix).
5. `web/src/Header.tsx:22-25`, `:45`: keep the number; add `title="Payments minus ledger refunds on the visible orders, including orders still in progress. TEST MODE."`; compute the share from orders whose `stripeSessionId` starts with `demo-simulated:` and render `incl. {usd} SIMULATED` next to it when it is above 0.

Tests:
- **TB1** (`test_status.py`): a `counteroffered` order with `refunds=[]` produces text without "refund".
- **TB2**: an `issued` refund line contains "FORGE's ledger", "TEST MODE" and "not reversed".
- **TB3**: a `pending_approval` line contains "waiting for the founder's approval".
- **TB4** (agent-browser on a local database, screenshot): the badge reads "Refunded $1.00 · ledger TEST MODE"; the feed row says "in the ledger"; the header tooltip is present; an order paid with `demo-simulated:` adds "incl. $1.00 SIMULATED".

### Fix C (F4). The order feed shows refund decisions

1. `index.ts` `decide_approval` refund branch (`:1169-1172`): after updating the refund row, `logEvent(ctx, 'founder', approve ? 'order_refund_approved' : 'order_refund_declined', 'order', r.orderId, { refundId: r.id.toString(), amountCents: r.amountCents, challengeId: r.challengeId.toString() })`. Keep the existing `approval_*` event, which the founder-approval count uses (`feedText.ts:52`).
2. `feedText.ts`: story rows with the Founder avatar: `order_refund_approved` → "Founder approved the refund of {usd}"; `order_refund_declined` → "Founder declined the refund of {usd}". Change `:147` to "Refunded by the founder:" only when `p.status === 'issued'`, else "Founder asked for a refund (waiting for approval):", followed by the quoted reason.

Tests: **TC1** (module, no vendors, the refunds.test T5 shape): after a decline, one event `order_refund_declined` with `ref_type = 'order'` and `ref_id` = the order id. **TC2** (browser): "This order" shows the decline row after the pending row.

### Fix D (F5). Re-request a declined challenge refund

`refund_order`: allow `delivered` only when the order has a refund row with `status === 'rejected'` and `challengeId !== 0n`, and no `issued` or `pending_approval` row covers the remainder. Then `refundOrder(ctx, o, 'founder', 'founder', declined.challengeId)`.

Tests: **TD1** (real Apify and Bright Data, the probe-real P2 shape): delivered; UPHELD 600 above the limit; decline; `refund_order` → a new `pending_approval` 600 whose `challenge_id` is the challenge and whose approval cause is `founder`; approve → `customer:<id>` 0. **TD2**: a delivered order without a declined challenge refund is still refused with the current message.

### Fix E (F6). Refunds for older orders in the status reply

`stdb.py`: add `refunds_for_orders(order_ids) -> dict[int, list[dict]]` (one SQL read of `refund`, filtered in Python like `refunds_for_order` at `:136`). `agent.py:84-93`: pass the map. `status.py:112-121`: render `#12 rejected (refunded $1.00)`, `(refund pending)` or `(refund declined)`. Test **TE1** in `test_status.py`.

### Fix F (F7). Floor caption while CREAO works

`web/src/scene.ts:65` → `new Set(['queued', 'claimed', 'dispatched'])`; `:151` and `:213` → `['claimed', 'dispatched'].includes(t.status)`.

Test **TF1** (agent-browser against Maincloud as a viewer, during a real order): within 5 s of `task_dispatched`, the COO station caption is "CREAO run deciding…" and later the Auditor's is "CREAO run inspecting…". Save a screenshot.

### Fix G (F8). Deterministic floor for Auditor ACCEPT

`audit_verdict`, before `setOrder(... 'delivered' ...)` at `:1011`: `const vals = currentValues(ctx, orderId).filter((r) => r.metric !== '_page'); if (!vals.some((r) => r.status === 'verified')) throw new SenderError(`order ${orderId} has no verified values; REJECT it (the customer is refunded)`);` (`currentValues` is declared at `:1035`; move it above `audit_verdict` if needed). Update "What the reducer enforces" in `docs/creao/auditor.md:94`.

Tests: **TG1**: an order whose only source fails to load (only `_page` rows) reaches `auditing`; ACCEPT → 530; REJECT → `audit_rejected` plus refund. **TG2**: the probe-real P2 order still delivers.

### Fix H (F10). Tests to add to `module/test/refunds.test.mjs`

- **TH1, ingest `FAILED` twice.** Create a Task of `forge-extract` with `options.timeoutSecs: 1` directly through the Apify API and register it with `create_api(spec, <taskId>, 'task')`. Pay and ACCEPT; nudge with `apify_poll`. After the first run: order `accepted`, one `order_run_retried` (attempt 2), a new run row. After the second: `failed`, the reason ends with "(after a retry)", refund `issued`, books 0.
- **TH2, fail once then succeed.** A normal API. When `api_run_started` appears, abort that run through Apify (`POST /v2/actor-runs/{id}/abort`); `apify_poll` → `order_run_retried`; the second run succeeds → `verifying` → `auditing`. Assert no refund row and `customer:<id>` = −price.
- **TH3, Auditor REJECT refunds** (spec §4 test 3): the probe-real P1 sequence as a committed test.
- **TH4, `refund_order` on a delivered order → 530** (spec §4 test 7).

### Fix I (F11). Local publishes never carry CREAO settings

`module/package.json` `publish:local` → `env -u CREAO_API_KEY -u CREAO_APP_ID_COO -u CREAO_APP_ID_RESEARCH -u CREAO_APP_ID_CFO -u CREAO_APP_ID_AUDITOR -u PUBLIC_ROUTE_BASE spacetime publish -s local -p . --delete-data=always -y forge-test`.

Test **TI1**: with those variables exported, run it; the publish output lists no `Environment CREAO_…` line; paying an order creates no `run` row with provider `creao`.

### Fix J (F12). Live orders before back-office work

`dispatch` (`:2359-2363`): sort by a kind priority, then id: `coo_triage`, `audit`, `audit_challenge` and `research_gate` before `cfo_compile` and `audit_compile`. For the demo alone, `set_config creao_max_concurrency 3` is a zero-code alternative.

Test **TJ1** (invalid CREAO key, concurrency 1): queue a `cfo_compile` task, then pay an order; the first `task_dispatched` event after the payment belongs to the `coo_triage` task.

### Fix K (P3)

- `index.ts:1171`: include "challenge N" in the memo only when `r.challengeId !== 0n`.
- `status.py:96-101`: when the issued total covers the price, print only the issued line.
- `status.py:27`: `"rejected": "rejected"` (the reason line says by whom).
- `OrderHero.tsx:63`: during REPLAY count only refunds created before the cursor, or hide the badge.
- The docs listed in F19.

---

## 12. Minimal regression test plan

Run after any fix above, and before every publish.

```bash
cd /Users/anmolhurkat/Developer/Calhacks_Forge
env | grep -E '^(SPACETIME_HOST|CREAO_|PUBLIC_ROUTE_BASE)'   # must print nothing
spacetime start                                              # if no local server is listening on 3000

pnpm -C module typecheck && pnpm -C web typecheck && pnpm -C web build
(cd fetch-agents && uv run pytest tests)

# No-vendor module suites on a scratch database
spacetime publish -s local -p module --delete-data=always -y forge-reg
SPACETIME_DB=forge-reg node --test module/test/unit.test.mjs module/test/research-unit.test.mjs \
  module/test/compile_unit.test.mjs module/test/api.test.mjs module/test/orders.test.mjs \
  module/test/refunds.test.mjs          # plus stalls.test.mjs once Fix A lands

# Vendor-backed suites (export APIFY_TOKEN, BRIGHTDATA_API_KEY, BRIGHTDATA_UNLOCKER_ZONE individually; do not source .env)
spacetime publish -s local -p module --delete-data=always -y forge-reg-live
SPACETIME_DB=forge-reg-live node --test module/test/challenge.test.mjs
```

Upgrade check before publishing to Maincloud: publish the currently deployed commit to a scratch database without vendor keys, create one `rejected`, one `failed` and one `quoted` paid order, publish HEAD **without** `--delete-data`, and assert an empty migration plan, unchanged statuses, no new refund rows, and that `refund_order` refunds the dead orders and refuses the `quoted` one. (`/tmp/forge-final-audit/upgrade-before.mjs` and `upgrade-after.mjs` did exactly this; `/tmp` may be cleared, so commit an equivalent `module/test/upgrade.test.mjs` if this becomes routine.)

Browser check after any `web/` change: agent-browser at 1920×1080 against a local database: the order headline badge, the feed rows, the founder button (founder token) and the Needs-you card; save a screenshot under `docs/proof/`.

---

## 13. Demo smoke-test checklist

**Before judges arrive (after the §14 publish)**

1. `git log -1` shows the commit you published. `spacetime describe --json -s maincloud forge` lists a reducer named `refund_order`.
2. Read-only SQL on Maincloud: no CREAO run in `pending`/`running` older than 10 minutes; no queued CREAO task older than 2 minutes; no non-terminal Apify run; no unexpected pending approval; the `books` rows sum to 0.
3. The canary passes on each seeded API.
4. The Front Desk process is restarted on this code; a "status" message in ASI:One answers.
5. #199 is repaired (§14.4): its headline shows "Refunded $1.00 TEST MODE" and the real-scope header shows $4.00.
6. Dashboard open on the laptop and the phone, both `LIVE`.

**Run-through (about 30 minutes before)**

7. ASI:One: ask for an existing API (open-roles for a public board), accept the quote, pay with 4242 4242 4242 4242. Status reads "paid, waiting for the COO to review it"; the order appears on both screens.
8. Within a few minutes: `delivered`, the table and the dataset link in the status reply.
9. Challenge one row: the fresh quote arrives within seconds; the ruling within minutes.
10. Ask for engineers' emails: instant desk rejection, no charge.
11. Refresh the dashboard during step 7 on one device; both devices show the same state.
12. The budget-cut moment works.

**During the demo**

- If the COO or Auditor station shows work for more than 5 minutes: find the run (`SELECT * FROM run WHERE provider = 'creao'`) and run `spacetime call -s maincloud forge creao_poll <runRef>`. If the task ends `failed` (`task_ended_without_decision`), the order cannot be rescued on this code (F1): say so, and switch to the delivered seeded order. With Fix A-min deployed, press "Stop and refund" instead.
- If two CREAO runs are in flight and nothing moves, poll both to free the slots.
- If an order sits in `running` for more than 10 minutes, `spacetime call -s maincloud forge apify_poll <runRef>`.
- Do not trigger compiles (`compile_min_buyers`) right before a live order: CREAO concurrency is 2 and shared (F12).
- If asked whether a refund returned money to the card: no; it is booked in FORGE's ledger in test mode (F2).

---

## 14. Maincloud deployment risks and verification procedure

### 14.1 Current Maincloud state (read-only snapshot, 00:32 PT Oct 25)

- 205 orders, 105 customers, 59 canary orders, 242 tasks, 87 runs. `creao_max_concurrency` = 2, `refund_limit_cents` = 500.
- Real-scope header revenue: 500 cents over 9 real orders: #131, #196, #202, #205 `delivered`; #199 `audit_rejected`; 4 `quoted`. #205 was paid with `demo-simulated:`.
- #199: `audit_rejected`, price 100, Stripe test session, `customer:199` = −100, no refund row.
- 54 dead orders hold $1.00 each (53 test traffic plus #199). 26 canary orders sit in `auditing` or `paid` at price 0 (by design or harmless).
- 0 CREAO runs in flight; 0 non-terminal Apify runs; 0 `task_ended_without_decision` events ever; 9 `creao_run_start_failed`; 6 refund rows; no pending approvals; the books sum to 0; `treasury` = 5918.

### 14.2 Compatibility evidence

- Schema: 40/40 tables identical (index order only), reducers 34 → 35 (`refund_order`). The change is additive.
- Two local upgrades (HEAD published over `9da0a92` data without `--delete-data`) showed an empty migration plan, kept statuses, refunded nothing, and preserved the module env (`APIFY_TOKEN`).
- The #199 repair was replayed on a replica built from a real run (15/15).

### 14.3 Risks

| Risk | Consequence | Control |
|---|---|---|
| Publishing with `--delete-data` or to the wrong target | wipes 205 orders and the module env, or publishes elsewhere (`module/spacetime.json` defaults to Maincloud) | Use exactly the command below; always pass `-s maincloud` or `-s local` explicitly |
| Module env | `spacetime publish` reads declared names from the shell (`index.ts:612-620`) | Source `.env` as below so every value is present; I verified only that a publish without `APIFY_TOKEN` in the shell kept it locally, not what an empty shell value does |
| Deploy order | the new Front Desk and dashboard assume the new module (R-2) | Publish the module, then restart the Front Desk, then reload dashboards |
| Old orders are not repaired | #199 and the 53 test orders keep their debits | The founder repairs #199 (14.4); test orders are optional (`refund_order` per order) |
| In-flight orders during publish | none in the real scope; canary orders unaffected | Re-check 14.1 numbers right before publishing |
| Rollback | republishing `9da0a92` removes `refund_order`; refund rows stay | Untested; try it on a scratch database first if it is ever needed |

### 14.4 Procedure (founder only; not executed by this audit)

1. **Pre-check (read-only).** Repeat the 14.1 SQL: refund rows (6), `SELECT * FROM books WHERE account = 'customer:199'` (−100), `SELECT * FROM books WHERE account = 'treasury'` (5918), the books sum (0), in-flight CREAO and Apify runs (0), pending approvals (none).
2. **Publish.**
   ```bash
   cd /Users/anmolhurkat/Developer/Calhacks_Forge
   git rev-parse HEAD                       # the commit you reviewed
   set -a; source .env; set +a
   spacetime publish -s maincloud -p module forge     # never --delete-data
   ```
   Proceed only if the migration plan is empty or additive.
3. **Post-check (read-only).** `spacetime describe --json -s maincloud forge` lists `refund_order`. Order counts by status, refund rows (6), `customer:199` (−100), `treasury` (5918) and the books sum (0) are unchanged.
4. **Repair #199** (the only intended Maincloud mutation), from the dashboard button on #199 or:
   ```bash
   spacetime call -s maincloud forge refund_order 199 '"audit rejected before the refund rule existed"'
   ```
   Verify: `SELECT * FROM refund WHERE order_id = 199` → one row, `issued`, 100, `challenge_id` 0; `customer:199` = 0; `treasury` = 5818; the books sum to 0; events `order_refunded` (actor founder, cause `founder`) and `order_refund_requested` (with the reason); the #199 headline shows "Refunded $1.00 TEST MODE"; the real-scope header goes from $5.00 to $4.00, of which $1.00 is the SIMULATED payment on #205.
5. Restart the Front Desk on this code; reload the dashboards on both devices; run §13.

---

## 15. Final go/no-go recommendation

- **Push the four commits: GO.** All gate conditions hold: the full diff was inspected, the spec is met, there is no P0, the refund and challenge tests pass, no regression was found, ancestry is a fast-forward, and only the 16 expected files are included. This audit file and the other untracked files are not part of the push. **Done:** `origin/main` is now `214932c80af9ad40ebb3064040f6a1006b53cdd5` (fast-forward from `9da0a92`).
- **Publish to Maincloud: GO**, by the founder, following §14.4, before restarting the Front Desk or reloading dashboards. Pushing does not deploy anything.
- **Live paid demo: GO with one caveat.** The pre-existing F1 can still strand a paid order if CREAO misbehaves. Before the demo, if time allows: Fix A-min (about 1 h), Fix B (about 45 min) and Fix F (10 min), each with its acceptance tests and the §12 regression run. If not, use the §13 runbook and do not describe ledger refunds as card refunds.
