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

The hackathon audit §0 explicitly reserves Maincloud publishing, repository visibility/push, hosting, public CREAO shares, ASI:One registration and videos for the founder. All changes and commands will be prepared first. Refund approvals continue exclusively through the dashboard founder identity, per AGENTS.md §2.7. No audit checkbox counts as a live proof without a recorded check.


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

## Remaining founder release tasks

These are open tasks, not completed checkboxes. The original hackathon audit §0.4 says, "Prepare the commands and verify afterwards; do not perform them yourself." AGENTS.md §2.7 requires founder approvals through the dashboard identity.

1. Check current Maincloud state and vendor balances. The original audits' order counts, run counts, prices and snapshot ages are historical.
2. With no runs or claimed/dispatched tasks in flight, publish this branch without deleting data: `spacetime publish -s maincloud -p module forge`. Supply the existing module environment privately. Confirm the migration is empty/additive and books/counts stay unchanged.
3. Restart Front Desk, reload both dashboards, verify the Agentverse README/badges, and complete a real ASI:One quote → Pay → status card → delivery → challenge form. Check the actual inbound card envelope and one Pay request per quote. Do not treat unit-model validation as phone rendering proof.
4. If #199 remains unrefunded, refund it from the founder dashboard. Verify one issued 100-cent ledger credit and zero customer balance. Do not issue it twice or claim a payment-rail reversal.
5. Create public CREAO shares for COO, Research and Auditor. Match the historical runs to tasks/orders before sharing; then call `set_run_share_url` as founder and add verified links to the README decision table. The existing CFO link is in `creao/deployment.md` and expires November 23, 2026.
6. Push this branch after reviewing the commits; make the repository public only after the final full-history secret scan. No push or visibility change was performed here. The exact false-positive fingerprints are in `.gitleaksignore`; public Apify run IDs, an environment-variable expression and the public Cloudflare beacon are not project credentials. Public-file export triage used the same file/line matches in a temporary ignore file; only historical commit fingerprints are committed.
7. Host `web/dist` as a public read-only dashboard. Inspect it logged out, confirm Viewer/disabled approvals, add the real URL to README/demo, and generate its QR code. No host or URL was invented.
8. Confirm Agentverse discovery without an @mention; register with the ASI:One Submission Agent; save the actual shared chat link. Record the Devpost and Fetch videos and add their URLs. Verify eligibility and final submission checkboxes.
9. Optionally rehearse a second real compile only if genuine stored demand triggers it and the CFO approves the economics. No compile or denied Droid action was staged. Keep the founder-fixed test-harness story explicit.

## Deferred as both audits direct

Browser API live rollout, retained CREAO threads, iteration/warranty orchestration, pricing/classification thresholds, CI canaries, actor-identity schema additions, scoped subscriptions, daily CFO reports and x402 remain in [after-hackathon.md](after-hackathon.md). The build contract's stale future requirements were not silently rewritten as completed work.
