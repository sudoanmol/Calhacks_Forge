# Unified final audit task

Branch: `fix/unified-final-audits`. Sources: [adversarial audit](final-adversarial-audit.md) and [hackathon audit](final-hackathon-winning-audit.md). Historical observations in those reports are not current production verification.

Finish the shared findings without inventing evidence, spending from local databases against Maincloud agents, or bypassing founder approvals. Code, generated bindings, callers, tests and documentation ship together. Schema changes stay additive.

| Task | Source findings | Completion evidence |
|---|---|---|
| Bound CREAO retries, recover lost callbacks, refund dead paid orders, guard founder rescue | F1, W7, P2-1, P-7/8 | Done: dispatch watchdog, bounded retries and guarded founder rescue; 55 local checks and a real CREAO 401 recovery test |
| Make refund and revenue language match ledger state; show older refunds and approval decisions; retry declined challenge refunds | F2–F6, F9, F14–F17 | Done: module, chat, dashboard; real Actor/Bright Data workflow tests and browser refund |
| Enforce a deterministic Auditor floor; prioritize customer orders; isolate local CREAO configuration; clean admission errors | F8, F11–F13 | Done: reducer floor, customer priority, retryable fetch policy and isolated local publishing |
| Correct active floor captions, connection/replay labels, duplicate compile text and inactive controls | F7, F18, W6/W11, P1-2/P2-5 | Done: real browser interactions, screenshots below; active CREAO caption code changed, live in-progress run not captured |
| Add strict, expiring payment intent and review/status cards; clean customer error messages; publish agent README badges | W4/W5/W8, P1-1/P0-4/P2-4 | Done: see verification below |
| Add founder-only public CREAO run links and generated client binding | W3, P1-4 | Done: founder role, URL validation and stored share link checked through real reducers |
| Connect org-chart edge selection to company feed | P2-3 | Done: see verification below |
| Correct claims and runbooks; curate proof screenshots; add judge tour and safe denial script | F19/F20, W9/W10/W12–W15, P0-5/6, P1-5/P2-8 | Done: see verification below |
| Run builds, type checks, Python/JS suites, local HTTP integration and browser interaction checks | F10, audit acceptance tests | Done: see verification below |
| Prepare founder deployment and submission handoff | P0-1–4, P1-3, P2-2, U1–U8 | Prepared; founder account actions and live approvals remain open |

## Scope decisions

Catalog carousel and challenge form are implemented with bounded payloads, sender-order ownership checks and validated form fields. The optional second compile requires a genuine trigger and a founder-run rehearsal. No staged compile, denial or failure will be created as demo evidence. After-hackathon features remain in `after-hackathon.md`, as both audits recommend. Historical contract requirements are not silently rewritten to match implementation gaps.

## Founder actions

The hackathon audit §0 explicitly reserves Maincloud publishing, repository visibility/push, hosting, public CREAO shares, ASI:One registration and videos for the founder. All changes and commands will be prepared first. Refund approvals continue exclusively through the dashboard founder identity, per the [founder approval rules](../AGENTS.md#authority-secrets-and-money). No audit checkbox counts as a live proof without a recorded check.


## Verification on this branch

All database writes in this implementation session targeted scratch databases on `http://127.0.0.1:3019`. No Maincloud module, order, refund, staff or configuration was changed. Apify and Bright Data tests used real services; forced audit decisions and provider aborts/timeouts were explicitly SIMULATED QA. Those runs are regression evidence, not demo stories.

| Check | Result |
|---|---|
| `pnpm run build`, `pnpm run typecheck`, `pnpm test` | Passed; Vite retains its existing bundle-size warning |
| `UV_CACHE_DIR=/tmp/forge-uv-cache uv run pytest -q` in `fetch-agents` | 130 passed, 24 credential-dependent tests skipped |
| `SPACETIME_HOST=http://127.0.0.1:3019 SPACETIME_DB=forge-audit-isolation node module/test/run-local.mjs` | 55 passed; real HTTP reducer/procedure calls and SQL |
| `module/test/creao-recovery.test.mjs` with opt-in flag | Passed in 345.8 s; real unauthorized CREAO responses, bounded starts, refund and stopped retries |
| `module/test/audit-live.test.mjs` with opt-in flag | 3 passed; real deployed Actor + Bright Data; delivery/refund guards, declined challenge refund re-request, zero-verified rejection, stopped audit rescue |
| `module/test/apify-retry.test.mjs` with opt-in flag and Apify credentials | 2 passed; actual timed-out runs refund after one retry; actual aborted run retries successfully with no refund |
| `module/test/upgrade.test.mjs` over a scratch copy of `main` | Passed; no-reset publish preserved orders, books and refunds |
| `publish:local` environment isolation | Passed with all CREAO variables and callback base set to invalid values in the parent environment; none reached the scratch module |
| CLI task commands | New empty-order-id fallback test and 3 existing task-formatting checks passed |
| Safe denial script | Scratch identity received HTTP 530; budget did not change |
| Gitleaks 8.30.1 full history | 84 commits in the initial scan; 10 false positives reviewed and fingerprinted; subsequent history rescans clean |
| Gitleaks public file export | Clean after the same exact-fingerprint triage; ignored `.env` excluded from the export |

The broader historical CLI suite expects specific Maincloud catalog, challenge and shipped-ticket fixtures. On the empty local database, 8 checks passed and 8 failed for missing historical fixtures/vendor configuration. It was not run against Maincloud to avoid creating production test work. The changed task commands have separate passing coverage. Fifteen-minute CREAO timeouts, malformed provider bodies and successful no-decision CREAO runs were inspected and have policy coverage where applicable; their full remote lifecycle was not exercised. A full ASI:One phone card round trip is still a founder release check. Do not call those paths live-verified.

The ASI card builders follow [Agentverse predefined schemas](https://docs.agentverse.ai/documentation/advanced-usages/predefined-card-schemas). The ASI card playground required sign-in, so payloads were checked through the installed ChatMessage/MetadataContent models and tests. Invalid cards retain the complete text fallback.

## Curated browser proof

These images show SIMULATED QA on a local scratch database, not real customer orders or fresh production demo evidence.

- [Org-chart edge filters the company feed](proof/audit-org-feed.png). A new matching payment event also appeared under the active filter without reload.
- [REPLAY header](proof/audit-replay.png), with return to LIVE also checked.
- [OFFLINE header](proof/audit-offline.png).
- [Disabled viewer controls](proof/audit-viewer-controls.png); unused pricing/confidence controls are absent.
- [Refund decline in the order feed](proof/audit-refund-declined.png).
- [Founder-issued ledger refund](proof/audit-refund-issued.png).
- [Phone layout](proof/audit-phone.png). Catalog → Office preserved the selected order; the reported persistent loading state did not reproduce.

## Founder release tasks

The user subsequently authorized deployment, Front Desk restart and dashboard reload. Those steps are complete below; other account and submission tasks remain open. The [founder approval rules](../AGENTS.md#authority-secrets-and-money) still require dashboard approval under the founder identity.

1. Check current Maincloud state and vendor balances. The original audits' order counts, run counts, prices and snapshot ages are historical.
2. DONE: published source commit `8bb3ef4` to Maincloud `forge` on October 25 at approximately 02:35 PDT, without a reset. The migration plan was empty. All 205 orders and the orders/books/refund/API/version/config rows were unchanged; books sum stayed zero. The schema remains 40 tables, with reducers increasing from 34 to 36. [Release evidence](proof/maincloud-release-20261025.json).
3. Front Desk STARTED from the published branch; it had not been running. Both protocol manifests published, Agentverse API registration is active and `/agent_info` returns 200 for the expected address. A reload was broadcast to connected dashboards, and the laptop dashboard was verified LIVE. The physical phone was not observable. Still verify the Agentverse README/badges and complete a real ASI:One quote → Pay → status card → delivery → challenge form. Check the actual inbound card envelope and one Pay request per quote. Do not treat unit-model validation as phone rendering proof.
4. DONE: the user manually refunded #199 through the founder dashboard. Do not issue it twice or claim a payment-rail reversal.
5. Create public CREAO shares for COO, Research and Auditor. Match the historical runs to tasks/orders before sharing; then call `set_run_share_url` as founder and add verified links to the README decision table. The existing CFO link is in `creao/deployment.md` and expires November 23, 2026.
6. The first release commits were pushed to `fix/unified-final-audits` at the user's request. Repository visibility is unchanged. Make the repository public only after the final full-history secret scan. The exact false-positive fingerprints are in `.gitleaksignore`; public Apify run IDs, an environment-variable expression and the public Cloudflare beacon are not project credentials. Public-file export triage used the same file/line matches in a temporary ignore file; only historical commit fingerprints are committed.
7. DONE: deployed `web/dist` to https://forge-calhacks.vercel.app through the logged-in Vercel CLI. Anonymous access returned 200; a fresh browser loaded Maincloud order #206, showed **Viewer · read-only**, and disabled founder controls. Desktop and 390px phone layouts, replay/return-to-live, and completion timing passed browser checks. [Deployment evidence](proof/vercel-release-20261025.json). README/demo now contain the URL and redeployment command. A QR code remains optional demo preparation.
8. Confirm Agentverse discovery without an @mention; register with the ASI:One Submission Agent; save the actual shared chat link. Record the Devpost and Fetch videos and add their URLs. Verify eligibility and final submission checkboxes.
9. Optionally rehearse a second real compile only if genuine stored demand triggers it and the CFO approves the economics. No compile or denied Droid action was staged. Keep the founder-fixed test-harness story explicit.

## Deferred as both audits direct

Browser API live rollout, retained CREAO threads, iteration/warranty orchestration, pricing/classification thresholds, CI canaries, actor-identity schema additions, scoped subscriptions, daily CFO reports and x402 remain in [after-hackathon.md](after-hackathon.md). The build contract's stale future requirements were not silently rewritten as completed work.


## Production release follow-up

The user authorized task 1 after the implementation handoff. [Maincloud release evidence](proof/maincloud-release-20261025.json) and the [refreshed laptop dashboard](proof/release-maincloud-dashboard.png) record the result. No new customer order, refund, config change or approval was issued as part of this release. The observed order #205 is the existing SIMULATED PAYMENT order, not a new transaction.

Automatic approval review initially refused a publish while the callback URL was unverified locally. The deployed `PUBLIC_ROUTE_BASE` was then read through owner-authenticated `st_env`, validated against Maincloud's forge route, and supplied unchanged. The subsequent publish succeeded. No credentials are included in this proof.

The Front Desk log warns that its wallet lacks funds for on-chain Almanac contract registration. Its Agentverse API registration succeeded and its mailbox started. No funds were transferred or network settings changed. The detached process state and private log path are recorded locally in `/tmp/forge-front-desk-release.json`; a full ASI:One customer round trip remains task 2.

## ASI:One follow-up and sponsor check, October 25

The user confirmed the manual refund and supplied a successful Safari ASI:One run: order #206 delivered 21 independently verified values. The native mobile app reported that the agent was unavailable; Safari worked. The shared chat was inspected directly. Native app availability remains unverified.

The follow-up fixes shorten the simulated-payment button to `Run demo`, keep status on the current order, group preview fields by record, and move full challenge evidence to `challenge details`, optionally `challenge details for order #202`. Dataset delivery now uses Apify's signed `itemsPublicUrl`; no account API token is sent to customers and dataset permissions stay unchanged. An explicit `apify_poll` refreshes an existing run's sharing link without ingesting or billing it again.

Deployed commit `543510e` without a reset at approximately 03:19 PDT, restarted Front Desk, and repaired only order #206's export URL. Anonymous retrieval returned 200 with 21 records. Orders/books/refunds/APIs/versions/config were unchanged by the publish; the link repair left values, books and refunds unchanged. Python checks: 132 passed, 24 credential skips. The real local Apify/Bright Data workflow verified signed exports and idempotent refresh. Module typecheck/build and 55 existing local reducer checks passed. [Follow-up evidence](proof/asi-chat-followup-206.json), [live dashboard screenshot](proof/audit-dataset-206.png). New card rendering on the physical phone remains unchecked; existing chat messages retain their original contents.

Vercel's public Greenhouse board returned 200, but its departments feed measured 68,828 characters during this check. The current Front Desk resolver caps pages at 60,000 characters and returns a counteroffer with no attached board parameter. This is a current limitation, including for the compiled API. No Vercel order was placed or paid. A request for an unsupported source still needs Research and the COO; it must not be presented as a successful Vercel extraction.

All six sponsor channels were read, including relevant threads. The useful final changes are submission packaging and proof, rather than additional features:

- [Apify, October 24 at 21:12](https://cal-hacks-13-0.slack.com/archives/C0C7TGUC924/p1792901574919199): show the product in the first ten seconds, record the demo early, name Apify in the submission, and include the Actor link and ID. The Actor does **not** need to be public. [Sponsor clarification](https://cal-hacks-13-0.slack.com/archives/C0C7TGUC924/p1792872808555309). The observed run used `forge-open-roles`, Actor `RdQhIe6Jj6mE2qT4L`, build `1.0.1`. The uploaded `src/extract.js`, `src/main.js` and `src/jsonspan.js` match the repository files.
- [CREAO qualification](https://cal-hacks-13-0.slack.com/archives/C0C71495G5P/p1792652472670929): the Devpost README needs an agent ID and a run share link, and the CREAO track must be selected. Latest API speed/rate-limit questions had no sponsor answer in their thread; do not infer a new API limit or workaround.
- [Fetch requirements](https://cal-hacks-13-0.slack.com/archives/C0C6SUJUKEF/p1792770712228019): Agentverse registration, Agent Chat Protocol, discovery and direct use through ASI:One remain the requirements. The latest support thread has no public resolution or documented mobile fix. Keep the working Safari chat as evidence and verify submission registration separately.
- [Bright Data judging](https://cal-hacks-13-0.slack.com/archives/C0C6SULMV2P/p1792778412337339): demonstrate live results, real access failures and useful output in a clear two-minute story. Latest messages concern credit redemption and booth hours, with no new product requirement.
- [Factory, October 24](https://cal-hacks-13-0.slack.com/archives/C0C6X7ADPRU/p1792872006674189): SDK/API-key resources and credit top-ups. Later threads concern missing vouchers; no new judging requirement was found.
- [SpacetimeDB latest announcement](https://cal-hacks-13-0.slack.com/archives/C0C72R7C6J0/p1792911132903939): the reported performance fix applies to the separate ScrabbleBot site. It is not a FORGE migration or a reason to change this project.
