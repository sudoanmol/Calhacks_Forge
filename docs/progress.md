# In-progress work

This log tracks the work authorized after the CREAO setup. All money and payments are **TEST MODE**.

| Work | Status | Completion check |
|---|---|---|
| Commit the compile worker's existing changes | Done | Typecheck, module and web builds, workspace tests, 19 module unit tests, and 3 live compile CLI tests passed |
| Clean live test fixtures and stuck jobs | Done | Both `cmp-test` listings retired with orders, versions, and books unchanged; YC ticket 1 closed from the founder dashboard; isolated compile suite 8/8 |
| Founder controls and approvals | Done | Budget changes enforced live; real ship approval #10 approved through the dashboard; other identities read-only |
| Engineering view | Done | Real failed attempt, Auditor rejection, resumed session, accepted tests, approval and shipped state rendered in Brave |
| Automated Tier 1 compile | Done | Ticket 6 shipped through real Droid, Auditor and dashboard approval; two canaries passed; independent buyer order 196 paid and received version 20 |
| Research admission gate | In progress | Mechanical checks precede Research; a real dispatched Research run returns a cited report and COO decision |
| Customer challenge | In progress | A customer request reaches recheck and the real Auditor; saved and fresh evidence appear in chat and dashboard |
| ASI:One and two-device validation | In progress | Phone live updates confirmed through Tailscale; ASI:One order 199 paid via Stripe test checkout, awaiting Research and delivery |

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
