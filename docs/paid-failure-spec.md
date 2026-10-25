# Spec: paid orders that end badly (refund, retry, founder rescue)

Binding for the worker that implements it. `AGENTS.md` wins where they conflict. Written Sat Oct 24, ~22:30 PT, from `module/src/index.ts` @ `c5c2957` and the live `forge` database.

## 0. Read first

- `AGENTS.md` §2 (rules 1–3, 6–8, 11, 13, 15, 16), §3 "Addition 2", §5 (Treasurer reducers, `refund`, `approval(refund_over_limit)`), §10.
- `module/src/index.ts`: `record_payment` (~L881), `coo_decide` (~L933), `audit_verdict` (~L963), the challenge refund block in `challenge_verdict` (~L1085–1105), `decide_approval` for `refund_over_limit` (~L1153), `failOrder` (~L1411) and its callers (`start_api_run` ~L1437–1476, `ingest` ~L1637, `create_apify_task` ~L2283), the admission catch block (~L2090), `setOrder`, `postTx`, `logEvent`, `cfgInt`.
- `module/test/challenge.test.mjs` (tests 145 and 181 exercise the refund path; copy their shape), `module/test/client.mjs`, `module/test/orders.test.mjs`.
- `fetch-agents/front_desk/status.py`, `fetch-agents/front_desk/stdb.py` (`refunds_for_challenge`), `fetch-agents/tests/test_status.py`.
- `web/src/OrderHero.tsx`, `web/src/feedText.ts` (sentence map), `web/src/NeedsYou.tsx` (`refund_over_limit` card), `docs/dashboard-redesign-spec.md` §6.2, §7, §10.
- `docs/order-states.html` (the current end-state map; the gap this spec closes).

## 1. The problem

A customer pays before the COO looks at the order. Five end states keep that payment with nothing delivered, and nothing in the module moves the money back:

| status | set by | today |
|---|---|---|
| `rejected` | `coo_decide(REJECT)`; admission check failure (`admission_rejected`) | reason in chat, payment kept |
| `counteroffered` | `coo_decide(COUNTEROFFER)` | waits forever; there is no reducer that accepts a counteroffer |
| `audit_rejected` | `audit_verdict(REJECT)` | reason in chat, payment kept. **Live case: order #199**, $1.00 Stripe test payment (`cs_test_a17y…`), `books.customer:199 = -100`, no `refund` row |
| `failed` | `failOrder` from `start_api_run` (no runnable version, no api, bad params, Apify start HTTP error), `ingest` (run not `SUCCEEDED`), `create_apify_task` (Task creation failed) | reason in chat, payment kept |

Refunds exist only on the challenge path (`challenge_verdict(UPHELD)`): amount = price − already refunded; at or under `config.refund_limit_cents` (500) it is issued and booked `treasury → customer:<id>`; above it a `refund` row in `pending_approval` and an `approval(kind=refund_over_limit)` the founder decides.

## 2. Rules

1. **A paid order that ends without a delivered deliverable is refunded in full, automatically, by the Treasurer (reducer code).** The only exception is one automatic re-run of a failed Apify run (§4). No LLM decides a refund.
2. Rescue before refund only where the failure is plausibly transient and the retry costs the customer nothing: the Apify run. Everything else refunds at once.
3. The refund limit and approval rule are the existing ones. Nothing about `refund_limit_cents` or `decide_approval` changes.
4. Additive only (`AGENTS.md` rule 13): no table or column changes. `refund.challengeId` is `0` for refunds that have no challenge. One new reducer (`refund_order`). New event kinds are fine.
5. Every refund writes an `event` the dashboard and the Front Desk can read. No money is implied anywhere without `TEST MODE` next to it.
6. Never create orders, payments or approvals on Maincloud to test this. Tests run against a local server (`spacetime start` + `pnpm -C module run publish:local`), the way `module/test/*.test.mjs` already do.
7. **The founder publishes to Maincloud**, not the worker. The worker's handback ends with "ready to publish" and the exact command.

## 3. Module changes (`module/src/index.ts`)

### 3.1 `refundOrder` helper (Treasurer)

Extract the challenge block into one function and call it from both places:

```ts
// Refunds what the customer still holds as a debit on this order. At or under refund_limit_cents the money
// moves now; above it the refund waits on a founder approval. Returns the refund row, or undefined when
// nothing is owed. challengeId is 0n when the refund has no challenge behind it.
function refundOrder(ctx: Ctx, o: Order, actor: string, cause: string, challengeId = 0n) {
  const refunded = [...ctx.db.refund.orderId.filter(o.id)].filter((r) => r.status !== 'rejected').reduce((s, r) => s + r.amountCents, 0);
  const amount = Math.max(0, o.priceCents - refunded);
  if (amount === 0) return undefined;
  const overLimit = amount > cfgInt(ctx, 'refund_limit_cents');
  const row = ctx.db.refund.insert({ id: 0n, orderId: o.id, challengeId, amountCents: amount,
    status: overLimit ? 'pending_approval' : 'issued', createdAt: ctx.timestamp, decidedAt: overLimit ? undefined : ctx.timestamp });
  if (overLimit) {
    const ap = ctx.db.approval.insert({ id: 0n, kind: 'refund_over_limit', refType: 'refund', refId: row.id, amountCents: amount,
      detail: JSON.stringify({ orderId: o.id.toString(), challengeId: challengeId.toString(), cause, limitCents: cfgInt(ctx, 'refund_limit_cents') }),
      status: 'pending', createdAt: ctx.timestamp, decidedAt: undefined });
    logEvent(ctx, 'treasurer', 'approval_requested', 'approval', ap.id, { kind: ap.kind, amountCents: amount, refundId: row.id.toString(), cause });
  } else {
    postTx(ctx, `refund order ${o.id} (${cause}, TEST MODE)`, [[`customer:${o.id}`, BigInt(amount)], ['treasury', -BigInt(amount)]]);
  }
  logEvent(ctx, actor, 'order_refunded', 'order', o.id, { amountCents: amount, status: row.status, cause, challengeId: challengeId.toString(), refundId: row.id.toString() });
  return row;
}
```

- `cause` is one of: `coo_rejected`, `coo_counteroffered`, `admission_rejected`, `audit_rejected`, `run_failed`, `founder`. It goes in the memo, the event and the approval detail.
- `challenge_verdict(UPHELD)` calls `refundOrder(ctx, o, 'treasurer', 'challenge_upheld', challengeId)` and keeps everything else it does (clawback, ticket, `challenge_upheld` payload with `refund`). The ledger memo for that path may change wording; the amounts and accounts do not.
- "Paid" means `o.priceCents > 0` and `o.status` was never `quoted`/`rejected_at_desk` at the time of the call. Every call site below runs after `record_payment`, so the amount check inside `refundOrder` is the only guard needed. Do not refund `quoted` or `rejected_at_desk` orders (nothing was paid); `refund_order` (§3.4) enforces that explicitly.

### 3.2 Call sites

| where | change |
|---|---|
| `coo_decide`, `REJECT` branch | after `setOrder(... 'rejected' ...)`: `refundOrder(ctx, o, 'treasurer', 'coo_rejected')` |
| `coo_decide`, `COUNTEROFFER` branch | after `setOrder(... 'counteroffered' ...)`: `refundOrder(ctx, o, 'treasurer', 'coo_counteroffered')`. The order stays `counteroffered` (the state means "the COO proposed a smaller scope"); the money goes back and the chat tells the customer to ask for the smaller scope (§5). |
| admission catch block (~L2097) | after `setOrder(... 'rejected' ...)`: `refundOrder(tx, o, 'treasurer', 'admission_rejected')` |
| `audit_verdict`, `REJECT` branch | after `setOrder(... 'audit_rejected' ...)` and before `checkCompileTriggers`: `refundOrder(ctx, o, 'treasurer', 'audit_rejected')` |
| `failOrder` | becomes: set `failed` as today, then `refundOrder(tx, o, 'treasurer', 'run_failed')`. Every existing caller keeps its reason. |

Use the `setOrder` return value (the updated row) where the function needs the current status; `refundOrder` only reads `o.id` and `o.priceCents`.

### 3.3 One automatic re-run of a failed Apify run (§4)

In `ingest` (~L1637) and in `start_api_run`'s Apify-start failure (~L1476), replace the direct `failOrder` with `retryOrFail(tx, o, actor, reason)`:

```ts
// A run that Apify failed to start or that ended FAILED/ABORTED/TIMED-OUT gets exactly one more try.
// Config and param problems do not come through here; they fail (and refund) at once.
function retryOrFail(tx: Ctx, o: Order, actor: string, reason: string) {
  const attempts = [...tx.db.run.iter()].filter((r) => r.provider === 'apify' && r.threadId === String(o.id)).length;
  if (attempts >= 2) { failOrder(tx, o.id, actor, `${reason} (after a retry)`); return; }
  setOrder(tx, o, { status: 'accepted', apifyRunId: '' }, actor, 'order_run_retried', { reason, attempt: attempts + 1 });
  tx.db.apiRunSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(tx.timestamp.microsSinceUnixEpoch + 5_000_000n), orderId: o.id });
}
```

- `run.threadId === String(orderId)` is how Apify runs are tied to orders today (see `ingest`, `Feed.tsx`). Confirm the `start_failed` run row also carries `threadId` (it is inserted before the HTTP call; check and keep it).
- The 5-second delay avoids hammering Apify on an outage; `start_api_run` already ignores orders that are not `accepted`.
- `failOrder` callers for `api has no runnable version`, `order has no api`, `params: …`, `the API's Apify Task could not be created` stay as they are (no retry).
- A retried order shows `Retrying the run (attempt 2)` in the feed (§6).

### 3.4 Founder rescue: `refund_order`

```ts
// Founder: refund a paid order that ended without a deliverable before this rule existed, or that the
// Treasurer could not refund for any reason. Same limit and approval rule as every other refund.
export const refund_order = spacetimedb.reducer(
  { orderId: t.u64(), reason: t.string() },
  (ctx, { orderId, reason }) => {
    requireRole(ctx, 'founder');
    if (!reason.trim()) throw new SenderError('a reason is required');
    const o = findOrder(ctx, orderId);
    if (!DEAD_PAID.has(o.status)) throw new SenderError(`order ${orderId} is ${o.status}; only rejected, counteroffered, audit_rejected or failed orders can be refunded by hand`);
    if (o.priceCents === 0) throw new SenderError(`order ${orderId} was never paid`);
    const row = refundOrder(ctx, o, 'founder', 'founder');
    if (!row) throw new SenderError(`order ${orderId} has nothing left to refund`);
    logEvent(ctx, 'founder', 'order_refund_requested', 'order', o.id, { reason, refundId: row.id.toString(), amountCents: row.amountCents, status: row.status });
  },
);
const DEAD_PAID = new Set(['rejected', 'counteroffered', 'audit_rejected', 'failed']);
```

`delivered` orders are refunded only through a challenge; keep that boundary.

### 3.5 Bindings

Regenerate `web/src/module_bindings` (`spacetime generate --lang typescript --out-dir web/src/module_bindings -p module`) so `reducers.refundOrder` exists. Commit the regenerated files with the module change.

## 4. Tests (`module/test/`)

New file `refunds.test.mjs`, same harness as `challenge.test.mjs` (local server, `publish:local`, seats created through `client.mjs`). Each test creates its own order through the real reducers (`create_order` → `record_payment` with a `demo-simulated:` session id) and reads `refund`, `books`, `event` by SQL.

1. `coo_decide REJECT on a paid order refunds it`: `refund` row `issued`, amount = price, `books.customer:<id>` = 0, `treasury` down by the price, event `order_refunded` with `cause: coo_rejected`.
2. `coo_decide COUNTEROFFER refunds and leaves the order counteroffered`.
3. `audit_verdict REJECT refunds`: drive an order to `auditing` the way `orders.test.mjs` does (or set up through the existing helpers), then REJECT. Books back to 0.
4. `an Apify run failure retries once, then fails and refunds`: call the ingest path with a non-`SUCCEEDED` run twice (the tests already stub Apify; follow `orders.test.mjs`). After the first: order `accepted`, event `order_run_retried`, a new `api_run_schedule` row. After the second: `failed`, refunded.
5. `config failures refund without a retry`: `api has no runnable version` path → `failed` + refund, no `order_run_retried`.
6. `a refund over refund_limit_cents waits on the founder` (set the limit to 50 with `set_config`, price 100): `pending_approval` + `approval(refund_over_limit)`; `decide_approval(true)` issues it and the books move. Restore the limit to 500.
7. `refund_order`: non-founder → 530; on a `delivered` order → 530; on a `quoted` order → 530 (`never paid`); on a `rejected` paid order → refund; second call → `nothing left to refund`.
8. `challenge UPHELD still refunds through the shared helper` (run the existing test 145 in `challenge.test.mjs`; it must still pass unchanged apart from the memo text if asserted).

Also run the whole module suite (`pnpm -C module run test:api`) and `pnpm -C module typecheck`.

## 5. Front Desk (`fetch-agents/front_desk/`)

- `stdb.py`: add `refunds_for_order(order_id) -> list[dict]` next to `refunds_for_challenge` (one SQL read of `refund`, filtered in Python like the existing one).
- `status.py` `format_order`: accept `refunds: list[dict] | None = None`. After the reason line, when any refund exists:
  - `issued`: `Refunded $1.00 (TEST MODE).`
  - `pending_approval`: `Refund of $1.00 is waiting for the founder's approval (TEST MODE).`
  - `rejected`: `The founder declined the refund of $1.00 (TEST MODE).`
- `PLAIN['counteroffered']` becomes `"counteroffered by the COO: your payment was refunded; ask for the smaller scope and we'll quote it"`. `PLAIN['rejected']`, `['audit_rejected']`, `['failed']` are unchanged (the refund line follows).
- Add `Retrying the run (attempt 2)` only if the status map needs it: a retried order is `accepted` again, so `PLAIN['accepted']` already covers it. No change.
- `agent.py` `reply_status`: pass `stdb.refunds_for_order(o["id"])` for the order shown in full.
- Tests in `fetch-agents/tests/test_status.py`: the three refund lines, the counteroffer sentence, and that a desk rejection (price 0) still has no `TEST MODE`. Run `uv run pytest fetch-agents/tests` (from the fetch-agents dir, as its README says).

## 6. Dashboard (`web/src/`)

- `feedText.ts` (§7 of the redesign spec): new kinds
  - `order_refunded` (actor Treasurer): `Refunded {usd} to the customer · TEST MODE` + ` (waiting for the founder's approval)` when `status === 'pending_approval'`; cause in the expander only.
  - `order_run_retried` (actor Warehouse): `The run {reason}; retrying (attempt {attempt})`.
  - `order_refund_requested` (actor Founder): `Refunded by the founder:{quoted reason}`.
  Both are **story** rows (`classOf` → `story`), not plumbing.
- `OrderHero.tsx`: when the order has a non-rejected `refund` row, add a badge after the price: `Refunded $1.00 · TEST MODE` (or `Refund pending approval`). Founder only, on `DEAD_PAID` orders with money outstanding (price − issued/pending refunds > 0): a small button `Refund $1.00 · TEST MODE` that prompts for a one-line reason and calls `reducers.refundOrder`; errors render under the headline like approval errors do. Viewers see nothing.
- `NeedsYou.tsx` `refund_over_limit` card: the body currently says `Challenge #N was upheld`. Use `detail.cause`: `challenge_upheld` → current text; otherwise `Order #N ended as {status} and the refund is above the limit.`
- `docs/order-states.html`: update the callout to describe the new rule; it is not committed (untracked) so edit it only if it still exists.

## 7. Verification protocol

1. Local: `spacetime start` in one terminal, `pnpm -C module run publish:local`, `pnpm -C module run test:api` all green; `pnpm -C module typecheck`; `pnpm -C web typecheck && pnpm -C web build`; Front Desk pytest green.
2. Browser (`agent-browser`, a dev server on a free port, viewer identity, 1920×1080): on #199 the headline shows no refund badge yet (nothing has run on Maincloud until the founder publishes); the feed renders existing events unchanged. The point of this check is "nothing broke"; the refund UI is checked after the publish (step 4).
3. Handback: `docs/progress.md` row + this spec's §8 checklist ticked; one commit per layer is fine (`feat(module): refund paid orders that end without a deliverable`, `feat(web): refund badge and founder refund on dead-end orders`, `feat(front-desk): report refunds in the status reply`), or one commit. Do not push. End the report with:
   ```
   set -a; source .env; set +a
   spacetime publish -s maincloud -p module forge
   ```
   and the note that the founder then refunds #199 from the dashboard (or `spacetime call forge refund_order 199 '"audit rejected before the refund rule existed"'`) and verifies by SQL: `SELECT * FROM refund WHERE order_id = 199`, `SELECT account, balance_cents FROM books WHERE account = 'customer:199'` (expect 0).
4. After publish (founder or reviewer): refund #199 live, confirm the badge, the feed sentence on both devices, `books.customer:199 = 0`, `treasury` down by 100, header revenue $5.00 → $4.00 in the real scope.

## 8. Acceptance

- [ ] Every `failOrder`, COO REJECT/COUNTEROFFER, admission rejection and Auditor REJECT on a paid order writes a `refund` row and an `order_refunded` event; the books for that customer account return to 0 (or an approval is pending).
- [ ] A failed Apify run is retried exactly once; the second failure refunds.
- [ ] `refund_order` is founder-only and refuses `delivered`, `quoted`, `rejected_at_desk` and already-refunded orders with a clear `SenderError`.
- [ ] Challenge refunds behave exactly as before (test 145/181 pass).
- [ ] Front Desk `status` shows the refund line with `TEST MODE`; counteroffers tell the customer what to do next.
- [ ] Dashboard: badge, feed sentences, founder button, Needs-you card text. No `$` without `TEST MODE` on the same card.
- [ ] No schema change beyond one new reducer; `spacetime generate` output committed.
- [ ] Nothing was published, created or refunded on Maincloud by the worker.

## 9. Out of scope

Accepting a counteroffer in chat (new reducer + Front Desk flow); partial refunds; refunding `delivered` orders outside a challenge; retrying CREAO runs (the lease sweep already requeues them); any change to `refund_limit_cents` semantics.
