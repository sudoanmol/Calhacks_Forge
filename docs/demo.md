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

The laptop dashboard is `http://localhost:5180`. A second device on the tailnet can use `http://100.70.205.123:5180`. The user confirmed a live budget update on a physical phone without refreshing.

## Recorded evidence

- [Compiled API and measured savings](compile-proof.md).
- [Real ASI:One delivery](proof/asi-delivered-202.png).
- [Simulated-payment order 205 with real verified delivery](proof/demo-payment-205.json), [dashboard screenshot](proof/demo-payment-dashboard.png).
- [Real customer payment, delivery and challenge record](proof/asi-challenge-202.json).
- [Real Research, Task creation and honest QA rejection](proof/research-live-199.json).

The first researched Wikipedia API omitted an opening-year field. The real Auditor rejected it and it was retired. Its history remains intact; do not present it as a successful delivery.
