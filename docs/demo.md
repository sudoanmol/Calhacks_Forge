# Judge walkthrough

Show the founder dashboard on the laptop. Let the judge use ASI:One on the phone. The phone app or mobile website sends requests to the same Front Desk agent.

For the first order, ask: "Open roles at Lattice from its Greenhouse board: job title, team and location." This API has a deployed deterministic Tier 1 Actor. A real buyer received all 21 verified values after paying through the testnet Payment Protocol. A separate ASI:One customer paid through Stripe test checkout and received the same schema.

1. Keep the dashboard's Office tab open on the laptop. It follows the newest active customer order automatically.
2. Ask for the API in ASI:One. The quote names the order and scope.
3. Send **pay**. In demo mode this skips the payment card and checkout. The reply says **SIMULATED PAYMENT · TEST MODE**, and the dashboard and ledger carry the same label. No money is charged.
4. Send **status** to retrieve progress and delivery. ASI:One may not display later agent-initiated messages; status always reads the saved result.
5. Challenge one metric explicitly, for example "Row 0 team on order #N is wrong because Account Executive may be the role rather than the department." Send status to see saved and fresh quotes, then the real Auditor's ruling. A correct value produces a rejected challenge. Never promise an upheld challenge or stage incorrect data.

Only payment is simulated. Intent parsing, admission, Apify runs, Bright Data verification, CREAO decisions, and the challenge recheck remain real. A new source also requires the measured two-fetch admission check, at least 120 seconds apart.

## Payment switch

`FORGE_DEMO_PAY=true` in the ignored project `.env` enables the shortcut. Restart the Front Desk after changing it:

```sh
cd fetch-agents
uv run --env-file ../.env python -m front_desk.agent
```

The committed `.env.example` defaults to `false`. With the flag unset or false, the original Stripe test checkout and testnet FET Payment Protocol run as before. The demo shortcut does not send a Stripe RequestPayment card or a CompletePayment message for a transaction that never happened. Disable it when demonstrating the independent buyer's real Payment Protocol purchase.

The public dashboard is https://forge-calhacks.vercel.app. It connects to Maincloud and gives fresh visitors **Viewer · read-only** access. Keep the authorized local founder dashboard at `http://localhost:5180` for approvals. Judges can open the public URL on their phones; the user previously confirmed a live budget update on a physical phone without refreshing.

To publish a frontend update, run from the repository root:

```sh
pnpm --filter @forge/web build
vercel deploy web/dist --project forge-calhacks --scope anmol-hurkats-projects --prod --yes
```

This uploads only the built static frontend. No backend keys or founder identity are required. Deployments are manual; a GitHub push alone does not redeploy the site.

## Recorded evidence

- [Compiled API and measured savings](compile-proof.md).
- [Real ASI:One delivery and challenge](proof/asi-challenge-202.json).
- [Simulated-payment order 205 with real verified delivery](proof/demo-payment-205.json).
- [Real customer payment, delivery and challenge record](proof/asi-challenge-202.json).
- [Real Research, Task creation and honest QA rejection](proof/research-live-199.json).

The first researched Wikipedia API omitted an opening-year field. The real Auditor rejected it and it was retired. Its history remains intact; do not present it as a successful delivery.


## Recover a stalled order

All refunds below are TEST MODE ledger credits. They do not reverse a Stripe test payment or testnet FET transfer.

1. Find the run: `spacetime sql -s maincloud forge "SELECT id, task_id, status, started_at FROM run WHERE provider = 'creao'"`.
2. Re-fetch its trusted status: `spacetime call -s maincloud forge creao_poll <runId>`.
3. The dispatcher retries an undecided run once, then fails the eligible paid order and books its refund. Lost callbacks are checked by the dispatcher; runs expire after 15 minutes. A start failure stops retrying after five minutes.
4. For a stopped order with no queued/claimed task or active admission check, use **Stop and refund** on the founder dashboard. The reducer refuses a CREAO run younger than 15 minutes. Cancel queued work deliberately before requesting rescue. Never cancel an active run merely to demonstrate failure.
5. For a rejected or failed order, use **Refund**. Above the configured limit, approve the new refund card in **Needs you**. A decline stays visible in the order feed. A declined challenge refund can be requested again without changing the challenge ruling.

## Release checks

Use [unified-final-audit-tasks.md](unified-final-audit-tasks.md) for the code checklist and founder handoff. Before publishing: confirm no runs or claimed/dispatched tasks are in flight, build and test, publish without `--delete-data`, verify unchanged order/refund counts and balanced books, then restart Front Desk and reload dashboards. Run one real ASI:One order and challenge on both devices. Do not claim a historical audit snapshot is current production evidence.
