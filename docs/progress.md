# In-progress work

This log tracks the work authorized after the CREAO setup. All money and payments are **TEST MODE**.

| Work | Status | Completion check |
|---|---|---|
| Commit the compile worker's existing changes | Done | Typecheck, module and web builds, workspace tests, 19 module unit tests, and 3 live compile CLI tests passed |
| Clean live test fixtures and stuck jobs | Done | Both `cmp-test` listings retired with orders, versions, and books unchanged; YC ticket 1 closed from the founder dashboard; isolated compile suite 8/8 |
| Founder controls and approvals | In progress | Dashboard founder can change the budget and decide approvals; other identities cannot |
| Engineering view | In progress | View implemented and browser checked; real Droid trace and ship state remain to be exercised |
| Automated Tier 1 compile | In progress | `open-roles` ticket 6 completes Droid, Auditor, dashboard ship approval, deployment, and a measured rerun |
| Research admission gate | In progress | Mechanical checks precede Research; a real dispatched Research run returns a cited report and COO decision |
| Customer challenge | In progress | A customer request reaches recheck and the real Auditor; saved and fresh evidence appear in chat and dashboard |
| ASI:One and two-device validation | Pending | Human purchase, delivery, and challenge are checked with synchronized laptop and phone |

## Current evidence

- CREAO agents and the real CFO decision are recorded in [deployment.md](creao/deployment.md).
- The buyer purchased `open-roles` through the real FET testnet Payment Protocol and received 21 verified values. Log: `fetch-agents/buyer/logs/20261024T222758Z.json`.
- The three seeded APIs are still Tier 0. The two `cmp-test` Tier 1 records are simulated integration-test outputs, now retired from the catalog.
- The founder dashboard lowered the budget cap from 2000 to 40 cents: ticket 6 became ineligible and its reservation was released. Restoring the cap requeued it. Both changes are recorded in live reducer events.

## Validation constraints

- Compile integration tests must not claim the live `open-roles` worker task. Run them in an isolated database.
- Founder approvals use the dashboard's founder identity and reducer calls.
- Replay, iteration routing, Books, optional extras, and submission materials remain outside this in-progress batch unless needed to complete one of the rows above.
