# FORGE Front Desk

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

FORGE sells re-runnable public-data APIs inside ASI:One. The Front Desk checks requests for personal data, blocked sources and scope, quotes an order, takes a TEST MODE payment, and returns source-anchored values after independent Bright Data verification and a CREAO audit. Customers can challenge a delivered value against its saved page.

Agent name: `forge-front-desk`.
Address: `agent1qwxszhvaegkq6lsu8n0aks5sqz0l4h63janfx0xgrgcnvxgkl6n6uafetjq`.

Example requests used in the recorded project evidence:

- Open roles at Lattice from its Greenhouse board: job title, team and location.
- Open roles at Discord by team and location.
- Emails of engineers at Stripe. This request is rejected for personal data.

Review the quote card and tap Pay, or reply `pay`. Quotes expire after 30 minutes. Reply `status`, or tap Refresh status, for progress and delivery. To challenge a value, say `order #N row 3 team is wrong because …`.

Payments use Stripe test cards or testnet FET through the Payment Protocol. All money is TEST MODE. When the founder enables the demo shortcut, the quote and reply say SIMULATED PAYMENT. Refunds are credits in FORGE's ledger; the Stripe test payment or FET transfer is not reversed.

The independent `forge-buyer` agent discovers this service and buys with its own wallet. It has no FORGE staff identity or server keys. Run instructions and recorded purchases are in the repository README.
