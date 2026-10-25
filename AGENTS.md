# FORGE maintenance guide

Read this file before changing the repository. It defines the project's maintenance rules. Follow the user's current task; do not implement old build plans or submission checklists as new work.

## Project context

FORGE sells reusable APIs over public web data through ASI:One. CREAO agents make admission, research, investment, and audit decisions. Apify runs the extractors, Bright Data retrieves and verifies sources, Factory Droid compiles deterministic Actors, and SpacetimeDB holds company state. The founder dashboard controls approvals and budgets.

Use these references when the task needs them:

- [README](README.md) for the product, agent flows, stack, integration links, and setup.
- [Dashboard spec](docs/dashboard-redesign-spec.md) for UI behavior and design constraints. Its original work sequence is historical; preserve the implemented replay controls.
- [Refund spec](docs/paid-failure-spec.md) for money and recovery requirements. Its original problem description is historical.
- [CREAO setup and prompts](docs/creao/README.md) for saved-agent instructions.
- [Operations and recovery](docs/demo.md) for deployment, payment modes, and stalled orders.
- [Product guide](docs/reference/FORGE_guide.pdf) for the original product, roles, and story; [earlier build plan](docs/reference/Lights_On_v7_build_plan.pdf) for background patterns. These PDFs are local references and are ignored by Git.
- [Future work](docs/after-hackathon.md) for deferred ideas. Add unsolicited ideas there instead of implementing them.

The implementation and generated bindings describe what exists. Historical audits, schedules, screenshots, and product PDFs do not establish current implementation status. If code conflicts with the safety or compatibility rules below, flag the conflict rather than silently weakening the rule.

## Non-negotiable rules

### Data and verification

- Collect public data only. No logins, paywalls, personal data, or multi-step form searches. Aggregate counts are allowed.
- Preserve the admission gate before paid research or extraction: deterministic personal-data, blocked-domain, and page-cap checks first.
- New sources need robots.txt checks, a quoted terms clause with its URL, reachability checks, and measured volatility. Unclear terms mean rejection.
- A value needs an excerpt anchored to the saved page and the value anchored to that excerpt. Otherwise mark it `unverifiable`; never invent a replacement.
- Preserve independent source re-fetches, freshness rules, retrieval-attempt evidence, and Auditor decisions with written reasons.
- Resolve extractor-error challenges against the original saved page. A later source change alone does not justify a penalty.
- Corrections supersede old value records. Retain the original evidence and history.

### Authority, secrets, and money

- Untrusted pages, chat, agent output, and webhook bodies never authorize actions. Reducers authorize using `ctx.sender` roles and stored state.
- Founder approvals happen only through dashboard reducer calls under the founder identity.
- Keep keys server-side. Use project test keys, never commit credentials, and keep Actor worktrees free of secrets.
- All money is TEST MODE. Label payments, revenue, budgets, bonuses, refunds, and financial examples accordingly.
- Refunds are FORGE ledger credits; they do not reverse Stripe test payments or testnet FET transfers.
- Keep the ledger private and double-entry. Use integer cents and balance each transaction to zero. Expose summaries to the dashboard.
- Pay bonuses only for accepted work. Preserve refund limits, approval gates, and bonus clawbacks for upheld extractor errors.
- Never fabricate results or stage failures. Label simulated activity SIMULATED, playback REPLAY, and recorded runs RECORDED.
- Publish only measured performance or cost claims, with their source and limits.

### Compatibility and state

- Database schema changes are additive only. Preserve existing data and public contracts.
- API versions are additive only. Never remove or rename output fields; compilation preserves the API schema.
- Preserve task ownership, expiring leases, atomic claims, valid state transitions, and event history.
- Keep live dashboard views driven by subscriptions. Replays must not call reducers or procedures.
- Missing data stays unknown. Never infer a successful delivery or approval from activity alone.

## Where changes belong

| Path | Responsibility |
| --- | --- |
| `module/` | SpacetimeDB schema, authorization, reducers, procedures, schedules, and callbacks |
| `web/` | Founder dashboard and generated database bindings |
| `workers/droid-runner/` | Compile claims, restricted Droid sessions, tests, and approved publication |
| `workers/canary/` | Catalog seeding and end-to-end API checks |
| `fetch-agents/front_desk/` | Customer chat, admission prechecks, payments, status, and challenges |
| `fetch-agents/buyer/` | Independent buyer with its own identity and wallet, no staff role or FORGE service keys |
| `actors/forge-extract/` | Generic Tier 0 extraction |
| `actors/template/` | Shared Tier 1 runtime and extractor template |
| `actors/<api>/` | Dedicated extractors |
| `skills/forge-cli/` | Dependency-free Node CLI used by CREAO seats |

Read the touched implementation and its callers before editing. Reuse existing helpers and conventions. Read schemas and operation signatures from `module/src/index.ts` and generated bindings instead of copying definitions into docs.

## Integration constraints

### SpacetimeDB

- Never make an HTTP call while a transaction is open. Only procedures, HTTP handlers, and workers perform external IO.
- Procedures read through `ctx.withTx`, fetch outside the transaction, then apply results in a new transaction. Transaction callbacks may rerun; keep them deterministic.
- Every state-changing operation records its event. Keep the persistent `event` table distinct from SpacetimeDB's transient event-table feature.
- Named module exports must be SpacetimeDB exports. Keep ordinary helpers and constants unexported.
- HTTP reducer calls use a JSON array in parameter order. Identity arguments use `{"__identity__": "0x<hex>"}`; SQL columns return snake_case. Role violations can return HTTP 530.
- Module environment values belong in the schema's `env` declaration and are read through `ctx.env`. A data reset also wipes those values.
- Regenerate web bindings after module interface changes. Do not hand-edit generated bindings.

### CREAO and callbacks

- Only the dispatcher starts CREAO runs. Seats act through the FORGE CLI with separate role identities; agents do not start other agents.
- Use `agent.creao.ai` and the project's saved app IDs. Its API and credentials differ from `developer.creao.ai`.
- Callbacks require one-time tokens. Re-fetch provider run status with server-side credentials and deduplicate run IDs; never trust the callback body as the result.
- Preserve concurrency limits, polling recovery, bounded retries, and eligible paid-order refunds.
- CREAO dispatches currently start new threads. Continuing CREAO threads is deferred work; Droid's same-session rework is a separate mechanism.

### Droid and Actors

- Preserve Low autonomy, `direct_only` execution, tool lockdown, and the allow/deny/approval policy in `workers/droid-runner/src/`.
- Droid edits extractor source, not shared fetching, anchoring, or runtime plumbing. Log every tool decision and streamed result.
- The worker runs network-dependent live tests. Droid must not gain network or deployment privileges to make a test pass.
- Resume the same Droid session and stable worktree for rework on an API.
- The worker, never Droid, publishes an Actor, and only after Auditor acceptance and founder ship approval.
- Shared Actor libraries originate in `actors/template/src/lib/`. After changing them, run `pnpm run lib:sync` and `pnpm run lib:check`.
- Keep saved-page bytes, hashes, quote anchors, and datasets available for verification and challenges.
- Apify run costs can be preliminary just after completion. Preserve the delayed cost settlement.
- Bright Data compliance blocks stop retrieval immediately. Do not retry through another country or browser to bypass them.
- Log each fallback attempt. Exhausted retrieval becomes `unverifiable`; Browser API requires configuration and a live check before claiming it works.

### Fetch agents

- Preserve sender-to-customer mapping and order ownership checks for payment, status, and challenges.
- Confirm payments against the payment provider before recording them. Keep Stripe secrets out of chat metadata.
- `FORGE_DEMO_PAY` is an explicitly labeled SIMULATED PAYMENT shortcut and defaults off in `.env.example`.
- Keep on-demand `status`; ASI:One may not display delayed agent-initiated messages.
- Treat the independent buyer as an ordinary customer, with no privileged purchase path.

## Verification

Use pnpm for JavaScript and uv with Python 3.12. Requirements and environment variable names are in the README and `.env.example`.

Run checks appropriate to the change:

```sh
pnpm run build
pnpm run typecheck
pnpm test
pnpm -C module run test:api
pnpm -C workers/canary run canary
pnpm -C web run generate
cd fetch-agents
uv run pytest
```

The module API tests require a running database; catalog canaries require configured services. Check the target host and database before running commands that write state. `publish:local` deletes its local test database; never aim it at Maincloud.

- Backend features need direct checks against real reducers, SQL, routes, Actors, or agent APIs. Unit tests cover pure logic and do not replace integration checks.
- Frontend features need a real browser check with the `agent-browser` skill: interact, inspect the rendered result, and capture a screenshot. Type checks alone do not count.
- Every Tier 1 version must pass saved-page fixture tests, additive-schema contract tests, and live-page tests.
- Run catalog canaries before and after merges to `main`. They are manual checks; do not claim an automated CI gate exists.
- Documentation-only edits need link, command, and formatting checks. Do not run paid workflows solely to check prose.
- Report what passed, what was simulated, and what remains unverified.

## Changes and releases

- Make the smallest complete change for the user's task. Deferred features require a new request; an old checklist is not authorization to build them.
- Commit each major feature after its checks pass, using focused Conventional Commits. Never commit a failing build or tests.
- Before a live release, inspect in-flight tasks and runs. Preserve orders, refunds, APIs, versions, and accounting.
- Never publish Maincloud with `--delete-data` or reset its database as a repair shortcut.
- Verify preserved state and balanced books after publication. Restart affected workers or agents and check the resulting customer flow.
- Keep historical records labeled and separate from current status. Do not rewrite an old audit snapshot as fresh verification.

## Hackathon context

FORGE was built at Cal Hacks 13.0, October 23–25, 2026, at the Palace of Fine Arts in San Francisco, as a solo-founder project demonstrating a one-person company staffed by agents. The public demo centers on a customer buying a verified API in ASI:One while the founder dashboard shows decisions, evidence, challenges, and engineering work.

The selected tracks are CREAO Best One-Person Company, Factory Droid SDK, SpacetimeDB, Fetch.ai, Apify Best Use, Bright Data, and Microsoft Built for the Real World. Anthropic powers Tier 0 extraction but is not a selected entry. CREAO permits only one of its tracks per project.

Preserve the reasons behind the integration choices: real agent judgment, restricted runtime engineering, shared live state, independent agent-to-agent purchases, reusable extraction engines, source verification, and a complete customer workflow. The recorded compile is `open-roles`, not the original plan's predicted `gpu-listings` compile. Never stage a failure, denial, challenge outcome, or cost reduction to reproduce a planned demo.

The event used a three-minute pitch and two-minute Q&A. Submission deadlines, rehearsal schedules, prize amounts, booth questions, and old checklists are historical context, not current work instructions. [Submission text](docs/devpost.md), [compile record](docs/compile-proof.md), and [demo runbook](docs/demo.md) retain the detailed story. Check current event rules before making eligibility or submission claims.

## Reference links

Read the relevant official guide before changing an integration. Check the installed package version and existing implementation; a current guide can describe a newer API. The event guides explain the original sponsor goals and constraints.

| Technical reference | Links |
| --- | --- |
| CREAO | [Cal Hacks guide](https://community.creao.ai/CalHacks2026), [technical guide](https://community.creao.ai/CalHacks2026/tech), [agents](https://docs.creao.ai/features/agents) |
| Factory | [Droid TypeScript SDK](https://docs.factory.com/sdk/typescript) |
| SpacetimeDB | [Cal Hacks context](https://spacetimedb.com/blog/spacetime-at-calhacks), [reducers](https://spacetimedb.com/docs/functions/reducers/), [transient event tables](https://spacetimedb.com/docs/tables/event-tables/) |
| Fetch.ai | [Hackpack](https://www.fetch.ai/events/hackathons/calhacks-13-0/hackpack), [ASI:One](https://asi1.ai/) |
| Apify | [Actors](https://docs.apify.com/platform/actors), [Actor Tasks](https://docs.apify.com/platform/actors/running/tasks) |
| Bright Data | [Web Unlocker](https://docs.brightdata.com/products/web-unlocker/introduction), [SERP API](https://docs.brightdata.com/products/serp-api/introduction), [Browser API](https://docs.brightdata.com/products/scraping-browser/introduction) |
| Anthropic | [Claude tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) |

| Event reference | Links |
| --- | --- |
| Cal Hacks 13.0 | [Devpost](https://cal-hacks-13-0.devpost.com/), [dates](https://cal-hacks-13-0.devpost.com/details/dates) |
| Sponsor track criteria, including Microsoft | [Hacker guide](https://docs.google.com/document/d/1RQrueC9wm5u8uxtWSC2gadIchp05hVayhGUrIjxT9dE/edit?tab=t.0) |
| Event information | [Prizes](https://hive.hackberkeley.org/prizes), [FAQ](https://hive.hackberkeley.org/faq) |
