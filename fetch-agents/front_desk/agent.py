"""FORGE Front Desk: the customer's whole journey in ASI:One.

Chat text -> ASI-1 intent parse -> layer-2 gate -> an order in SpacetimeDB (quoted or rejected_at_desk)
-> TEST MODE payment (Stripe test card, or FET on the Fetch stable testnet) -> record_payment, after which
the module drives the order. ASI:One doesn't show agent-initiated messages, so progress is a `status` reply the customer asks for.
"""

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    MetadataContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.contrib.protocols.payment import (
    CancelPayment,
    CommitPayment,
    CompletePayment,
    RejectPayment,
    payment_protocol_spec,
)

from front_desk import fet, stdb
from front_desk.cards import catalog_card, challenge_form, order_card, parse_challenge_fields, parse_selection, quote_card, quote_is_fresh
from front_desk.challenge import Challenge, format_challenge, parse_challenge, pick_metric
from front_desk.gate import run_layer2
from front_desk.intent import NotARequest, parse_intent, strip_mentions
from front_desk.params import Resolution, resolve as resolve_params
from front_desk.payments import create_checkout, demo_pay_enabled, is_paid, payment_request
from front_desk.status import format_status, is_status_request

QUOTE_CENTS = 100  # Flat test price until the COO prices orders.
PAY_WORDS = {"pay", "pay now"}
CONFIRM_WORDS = {"yes", "ok", "okay", "accept", "buy", "sure"}
RECHECK_WAIT_S = 45  # the recheck is one saved-page read plus one Bright Data fetch
SHOWN_CHALLENGES = 3

agent = Agent(
    name="forge-front-desk",
    seed=os.environ["FRONT_DESK_SEED"],
    port=int(os.environ.get("FRONT_DESK_PORT", "8001")),
    mailbox=True,
    publish_agent_details=True,
    readme_path=str(Path(__file__).with_name("README.md")),
)
# ctx.agent in a handler is an AgentRepresentation, which has no wallet.
WALLET = str(agent.wallet.address())
chat = Protocol(spec=chat_protocol_spec)
pay = Protocol(spec=payment_protocol_spec, role="seller")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _text(body: str, end: bool = False, card: dict[str, str] | None = None) -> ChatMessage:
    content = [TextContent(type="text", text=body)]
    if card:
        content.append(MetadataContent(type="metadata", metadata=card))
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=_now(), msg_id=uuid4(), content=content)


def _log(ctx: Context, direction: str, peer: str, what: str) -> None:
    ctx.logger.info(f"{_now().isoformat(timespec='seconds')} {direction} {peer[:16]} {what[:80]!r}")


async def send(ctx: Context, to: str, message, what: str) -> None:
    status = await ctx.send(to, message)
    _log(ctx, f"OUT[{getattr(status, 'status', status)}]", to, what)


async def reply(ctx: Context, to: str, body: str, card: dict[str, str] | None = None) -> None:
    await send(ctx, to, _text(body, card=card), body)


def _challenge_text(c: dict) -> str:
    return format_challenge(c, stdb.challenge_check(c["id"]), stdb.refunds_for_challenge(c["id"]))


def _status_data(sender: str) -> tuple[str, dict[str, str] | None]:
    orders = stdb.orders_for_sender(sender)
    if not orders:
        return format_status([]), None
    latest = orders[0]
    values = stdb.value_records(latest["id"])
    api = stdb.api_name(latest["api_id"]) if latest["api_id"] is not None else None
    refunds = stdb.refunds_for_order(latest["id"])
    out = format_status(orders, values, api, refunds)
    challenges = stdb.challenges_for_orders([latest["id"]])[:SHOWN_CHALLENGES]
    if challenges:
        out += "\n\n" + " · ".join(f"Challenge #{c['id']}: {c['status']}" for c in challenges)
        out += ". Reply **challenge details** for the saved quote, fresh fetch, and ruling."
    return out, order_card(latest, values, api, refunds)


def _challenge_details(sender: str, order_id: int | None) -> str:
    orders = stdb.orders_for_sender(sender)
    order = next((o for o in orders if order_id is None or o['id'] == order_id), None)
    if order is None:
        return "I can't find that order among your orders."
    challenges = stdb.challenges_for_orders([order['id']])[:SHOWN_CHALLENGES]
    return "\n\n".join(_challenge_text(c) for c in challenges) or f"No challenges on order #{order['id']}."


def _open_challenge(sender: str, ch: Challenge) -> tuple[str, int | None]:
    """Opens the challenge on the customer's order; returns the chat reply and the new challenge id."""
    orders = stdb.orders_for_sender(sender)
    if ch.order_id is not None:
        order = next((o for o in orders if o["id"] == ch.order_id), None)
        if order is None:
            return f"I can't find order #{ch.order_id} among your orders.", None
    else:
        order = next((o for o in orders if o["status"] == "delivered"), None)
        if order is None:
            return "You have no delivered order to challenge yet. Reply **status** to see your orders.", None
    in_row = [v for v in stdb.value_records(order["id"]) if v["row"] == ch.row and v["metric"] != "_page"]
    metric = ch.metric or pick_metric(ch.reason, [v["metric"] for v in in_row])
    before = {c["id"] for c in stdb.challenges_for_orders([order["id"]])}
    try:
        stdb.open_challenge(order["id"], sender, ch.row, metric, ch.reason)
    except stdb.StdbError as err:
        if err.status != 530:
            raise
        if "say which one is wrong" in err.body:
            options = ", ".join(f"`{v['metric']}`" for v in in_row)
            return (f"Row {ch.row} of order #{order['id']} has several values ({options}). Which one is wrong? "
                    f"For example: \"row {ch.row} {in_row[0]['metric']} is wrong because …\""), None
        return f"I couldn't open that challenge: {err.body}", None
    new = [c for c in stdb.challenges_for_orders([order["id"]]) if c["id"] not in before]
    what = f"row {ch.row}" + (f" `{metric}`" if metric else "")
    body = (f"Rechecking {what} of order #{order['id']}: I'm reading the page our extractor saved and fetching the source "
            "again now. Reply **status** in a few seconds for the result; the Auditor's ruling follows within minutes.")
    return body, (new[0]["id"] if new else None)


async def follow_up_challenge(ctx: Context, sender: str, challenge_id: int) -> None:
    """Posts the recheck result once it lands. ASI:One may not show a later message; `status` always does."""
    for _ in range(RECHECK_WAIT_S // 3):
        await asyncio.sleep(3)
        try:
            c = await asyncio.to_thread(stdb.challenge_by_id, challenge_id)
        except Exception:  # noqa: BLE001
            ctx.logger.exception("challenge poll failed")
            return
        if c and c["status"] != "rechecking":
            await reply(ctx, sender, await asyncio.to_thread(_challenge_text, c))
            return


async def handle_challenge(ctx: Context, sender: str, ch: Challenge) -> None:
    try:
        body, challenge_id = await asyncio.to_thread(_open_challenge, sender, ch)
    except Exception as err:  # noqa: BLE001
        ctx.logger.exception("open_challenge failed")
        await reply(ctx, sender, f"Sorry, I couldn't open that challenge right now. Please try again.")
        return
    await reply(ctx, sender, body)
    if challenge_id is not None:
        asyncio.create_task(follow_up_challenge(ctx, sender, challenge_id))


def _resolve_params(text: str) -> Resolution:
    return resolve_params(text, stdb.catalog())


async def reply_status(ctx: Context, sender: str) -> None:
    try:
        body, card = await asyncio.to_thread(_status_data, sender)
    except Exception as err:  # noqa: BLE001
        ctx.logger.exception("status read failed")
        body = f"Sorry, I couldn't read your orders right now. Please try again."
        card = None
    await reply(ctx, sender, body, card)


async def handle_selection(ctx: Context, sender: str, selection: tuple[str, int | None], text: str = "") -> None:
    action, order_id = selection
    pending = ctx.storage.get(f"quote:{sender}")
    if action == "status":
        await reply_status(ctx, sender)
    elif action in ("pay", "cancel"):
        if not pending or pending["order_id"] != order_id or not quote_is_fresh(pending):
            await reply(ctx, sender, "That quote is no longer open. Ask for a fresh quote.")
        elif action == "cancel" and ctx.storage.get(f"payreq:{pending['ref']}"):
            await reply(ctx, sender, "A payment request is already open for this quote. Cancel it in checkout.")
        elif action == "cancel":
            ctx.storage.remove(f"quote:{sender}")
            await reply(ctx, sender, "Quote cancelled. No payment was requested.")
        else:
            await request_payment(ctx, sender, pending)
    elif action == "api":
        apis = await asyncio.to_thread(stdb.catalog)
        api = next((a for a in apis if a['id'] == order_id), None)
        await reply(ctx, sender, f"{api['name']}: {api['description']} Ask for this API and the scope you want; I will quote it before payment." if api else "That API is no longer for sale.")
    elif action in ("challenge", "recheck"):
        orders = await asyncio.to_thread(stdb.orders_for_sender, sender)
        order = next((o for o in orders if o["id"] == order_id and o["status"] == "delivered"), None)
        if not order:
            await reply(ctx, sender, "There is no delivered order with that number among your orders.")
            return
        values = await asyncio.to_thread(stdb.value_records, order_id)
        fields = sorted({v["metric"] for v in values if v["metric"] != "_page"})
        submitted = parse_challenge_fields(text) if action == 'recheck' else None
        if submitted:
            row, metric, reason = submitted
            if metric not in fields:
                await reply(ctx, sender, "Choose a field from this order.")
                return
            await handle_challenge(ctx, sender, Challenge(row=row, order_id=order_id, reason=reason, metric=metric))
            return
        await reply(ctx, sender, f'Reply "order #{order_id} row 3 team is wrong because …". Fields: {", ".join(fields)}.', challenge_form(order_id, fields) if fields else None)


@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(sender, ChatAcknowledgement(timestamp=_now(), acknowledged_msg_id=msg.msg_id))
    text = strip_mentions(" ".join(c.text for c in msg.content if isinstance(c, TextContent)))
    _log(ctx, "IN", sender, text)
    if not text:
        return
    if selection := parse_selection(text):
        try:
            await handle_selection(ctx, sender, selection, text)
        except Exception:
            ctx.logger.exception("card action failed")
            await reply(ctx, sender, "I couldn't complete that action right now. Reply **status** or try again.")
        return
    if text.lower().strip(" ?.! ") in {"catalog", "what can you sell me", "what do you sell", "list apis"}:
        try:
            apis = await asyncio.to_thread(stdb.catalog)
            await reply(ctx, sender, "APIs for sale: " + ", ".join(a['name'] for a in apis) + ". Ask for a quote. All money is TEST MODE.", catalog_card(apis) if apis else None)
        except Exception:
            ctx.logger.exception("catalog read failed")
            await reply(ctx, sender, "I couldn't read the catalog right now. Please try again.")
        return
    if is_status_request(text):
        await reply_status(ctx, sender)
        return
    if details := re.fullmatch(r"challenge details(?: (?:for )?order #?(\d+))?[?.! ]*", text, re.IGNORECASE):
        try:
            await reply(ctx, sender, await asyncio.to_thread(_challenge_details, sender, int(details[1]) if details[1] else None))
        except Exception:
            ctx.logger.exception("challenge details read failed")
            await reply(ctx, sender, "I couldn't read the challenge details right now. Please try again.")
        return
    if challenge := parse_challenge(text):
        await handle_challenge(ctx, sender, challenge)
        return
    pending = ctx.storage.get(f"quote:{sender}")
    if text.lower().strip(" .!") in CONFIRM_WORDS:
        await reply(ctx, sender, f"To pay for order #{pending['order_id']} (${pending['cents'] / 100:.2f} TEST MODE), tap Pay or reply **pay**." if pending else "There is no open quote. Tell me what public data you need first.")
        return
    if text.lower().strip(" .!") in PAY_WORDS:
        if pending:
            await request_payment(ctx, sender, pending)
        else:
            await reply(ctx, sender, "There's no open quote to pay yet. Tell me what public data you need first.")
        return

    try:
        intent = await asyncio.to_thread(parse_intent, text)
        blocked, cap = await asyncio.to_thread(stdb.gate_config)
    except NotARequest:
        ctx.logger.info(f"not a request {sender[:16]}: {text[:80]!r}")
        # ASI:One's own assistant answers our messages; replying every time would ping-pong forever.
        if ctx.storage.get(f"nudged:{sender}"):
            return
        ctx.storage.set(f"nudged:{sender}", True)
        await reply(ctx, sender, "I couldn't read that as a data request. Tell me which public site and which fields "
                                 "you want, e.g. \"open roles at Stripe by team and location\". Reply **status** for your orders.")
        return
    except Exception as err:  # noqa: BLE001 - the customer gets a reply, the log gets the cause
        ctx.logger.exception("intent/gate failed")
        await reply(ctx, sender, f"Sorry, I couldn't read that request right now. Please try again.")
        return
    ctx.storage.remove(f"nudged:{sender}")
    result = run_layer2(fields=intent.fields, sources=intent.sources, request_text=text,
                        estimated_pages=intent.estimated_pages, blocked_domains=blocked, page_cap=cap)
    ctx.logger.info(f"gate {sender[:16]} {result.check} passed={result.passed}")
    ref = str(uuid4())
    intent_json = {"summary": intent.summary, "sources": intent.sources, "fields": intent.fields,
                   "estimated_pages": intent.estimated_pages,
                   "pages": result.counteroffer_pages or intent.estimated_pages}
    if not result.passed and result.counteroffer_pages is None:
        try:
            await asyncio.to_thread(stdb.reject_at_desk, ref, sender, text, intent_json, result.check, result.reason)
        except Exception:  # noqa: BLE001 - the customer still gets the reason
            ctx.logger.exception("reject_at_desk failed")
        await reply(ctx, sender, f"**Rejected at the desk.** {result.reason}")
        return

    try:
        resolved = await asyncio.to_thread(_resolve_params, text)
    except Exception:  # noqa: BLE001 - without params the COO still decides on the order
        ctx.logger.exception("param resolution failed")
        resolved = Resolution()
    ctx.logger.info(f"params {sender[:16]} api={resolved.api} params={resolved.params}")

    try:
        await asyncio.to_thread(stdb.create_order, ref, sender, text, intent_json, QUOTE_CENTS)
        order = await asyncio.to_thread(stdb.order_by_ref, ref)
        if order is None:
            raise RuntimeError(f"order {ref} not found after create_order")
    except Exception as err:  # noqa: BLE001
        ctx.logger.exception("create_order failed")
        await reply(ctx, sender, f"Sorry, I couldn't open an order right now. Please try again.")
        return
    if resolved.params:
        try:
            await asyncio.to_thread(stdb.set_order_params, ref, resolved.params)
        except Exception:  # noqa: BLE001 - the quote must not claim a source the order doesn't carry
            ctx.logger.exception("set_order_params failed")
            resolved = Resolution()
    scope = f"top {result.counteroffer_pages} pages" if result.counteroffer_pages else f"{intent.estimated_pages} page(s)"
    quote = {"ref": ref, "order_id": order["id"], "summary": intent.summary, "sources": intent.sources,
             "fields": intent.fields, "pages": intent_json["pages"], "cents": QUOTE_CENTS, "params": resolved.params, "quoted_at": _now().isoformat()}
    ctx.storage.set(f"quote:{sender}", quote)
    lines = [
        f"**Order #{order['id']}: {intent.summary}**",
        f"Sources: {', '.join(intent.sources) or 'to be researched'} · Fields: {', '.join(intent.fields) or 'to be confirmed'}",
        *([resolved.note] if resolved.note else []),
        f"Scope: {scope}." + (f" {result.reason}" if result.counteroffer_pages else ""),
        "Every value will come with a verbatim quote from the source page.",
        f"Quote: ${QUOTE_CENTS / 100:.2f} (TEST MODE). Reply **pay** to accept."
        + (" **SIMULATED PAYMENT:** demo mode skips checkout; no money is charged." if demo_pay_enabled() else ""),
    ]
    await reply(ctx, sender, "\n\n".join(lines), quote_card(quote, scope, demo_pay_enabled()))


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    pass  # The chat protocol requires a handler for every message type it defines.


_payment_requests: set[str] = set()


async def request_payment(ctx: Context, sender: str, quote: dict) -> None:
    if not quote_is_fresh(quote):
        ctx.storage.remove(f"quote:{sender}")
        await reply(ctx, sender, "That quote expired. Ask for a fresh quote before paying.")
        return
    if sender in _payment_requests:
        return
    _payment_requests.add(sender)
    try:
        await _request_payment(ctx, sender, quote)
    except Exception:
        ctx.logger.exception("payment request failed")
        await reply(ctx, sender, "I couldn't open checkout right now. Please try again.")
    finally:
        _payment_requests.discard(sender)


async def _request_payment(ctx: Context, sender: str, quote: dict) -> None:
    reference = quote["ref"]
    if demo_pay_enabled():
        await _record_payment(reference, f"demo-simulated:{reference}")
        ctx.storage.remove(f"quote:{sender}")
        await reply(ctx, sender, f"**SIMULATED PAYMENT · TEST MODE.** No money was charged. "
                                 f"**Order #{quote['order_id']}** ({quote['summary']}) is queued for the COO. "
                                 "Reply **status** to follow the real extraction and verification.")
        return
    existing = ctx.storage.get(f"payreq:{reference}")
    if existing:
        await reply(ctx, sender, "A TEST MODE payment request is already open for this quote. Use its payment card.")
        return
    checkout = await asyncio.to_thread(
        create_checkout, amount_cents=quote["cents"], description=quote["summary"], reference=reference, customer=sender)
    record = {"sender": sender, "quote": quote, "reference": reference,
              "fet_amount": fet.PRICE_FET, "fet_atestfet": fet.to_atestfet(fet.PRICE_FET)}
    ctx.storage.set(f"checkout:{checkout['checkout_session_id']}", record)
    ctx.storage.set(f"payreq:{reference}", record)
    # ASI:One renders the card from RequestPayment, so it goes before the chat text.
    await send(ctx, sender, payment_request(quote=quote, checkout=checkout, wallet=WALLET), "RequestPayment")
    await reply(ctx, sender, "TEST MODE payment card above. Use card 4242 4242 4242 4242, any future date, any CVC. "
                             f"Agents can pay {fet.PRICE_FET} testnet FET ({fet.NETWORK}) to {WALLET} instead.")


async def _record_payment(ref: str, session_id: str) -> None:
    try:
        await asyncio.to_thread(stdb.record_payment, ref, session_id)
    except stdb.StdbError:
        # A retried CommitPayment for an order already recorded as paid with this session is fine.
        order = await asyncio.to_thread(stdb.order_by_ref, ref)
        if not order or order["stripe_session_id"] != session_id:
            raise


async def _settle(ctx: Context, sender: str, record: dict, payment_id: str, how: str) -> None:
    """The payment is proven: record it on the order exactly once, complete it, and tell the customer."""
    quote = record["quote"]
    try:
        await _record_payment(record["reference"], payment_id)
    except Exception:  # noqa: BLE001 - the money has moved, so complete the payment and say what went wrong
        ctx.logger.exception(f"record_payment failed for {record['reference']}")
        await send(ctx, sender, CompletePayment(transaction_id=payment_id), "CompletePayment")
        await reply(ctx, sender, f"Payment received ({how}), but recording order #{quote['order_id']} failed. "
                                 f"Please pass this reference to the FORGE founder: {record['reference']}.")
        return
    await send(ctx, sender, CompletePayment(transaction_id=payment_id), "CompletePayment")
    ctx.storage.remove(f"quote:{sender}")
    await reply(ctx, sender, f"Payment confirmed ({how}). **Order #{quote['order_id']}** ({quote['summary']}) is queued "
                             "for the COO. Reply **status** any time to see where it is.")


@pay.on_message(CommitPayment)
async def on_commit(ctx: Context, sender: str, msg: CommitPayment) -> None:
    if msg.funds.payment_method == fet.METHOD:
        await on_commit_fet(ctx, sender, msg)
        return
    session_id = msg.transaction_id
    _log(ctx, "IN", sender, f"CommitPayment {str(session_id)[:14]}")
    record = ctx.storage.get(f"checkout:{session_id}") if session_id else None
    if not record or record["sender"] != sender:
        await ctx.send(sender, RejectPayment(reason="Unknown payment session."))
        return
    if not await asyncio.to_thread(is_paid, session_id):
        await ctx.send(sender, RejectPayment(reason="Stripe has not marked this checkout as paid yet."))
        return
    await _settle(ctx, sender, record, session_id, "TEST MODE")


# Tx hashes being checked or already accepted in this process; ctx.storage and the orders table cover restarts.
_fet_claims: set[str] = set()


async def _fet_tx(tx_hash: str) -> dict | None:
    # The buyer commits after its transfer is in a block, but a node can lag behind the one it broadcast to.
    for wait in (0, 3, 6):
        await asyncio.sleep(wait)
        if (tx := await asyncio.to_thread(fet.fetch_tx, tx_hash)) is not None:
            return tx
    return None


async def on_commit_fet(ctx: Context, sender: str, msg: CommitPayment) -> None:
    tx_hash = fet.normalize_hash(msg.transaction_id)
    _log(ctx, "IN", sender, f"CommitPayment fet_direct {str(msg.transaction_id)[:14]}")

    async def cancel(reason: str) -> None:
        ctx.logger.info(f"fet payment cancelled {sender[:16]} {msg.transaction_id}: {reason}")
        await send(ctx, sender, CancelPayment(transaction_id=msg.transaction_id, reason=reason), f"CancelPayment {reason}")

    record = ctx.storage.get(f"payreq:{msg.reference}") if msg.reference else None
    if tx_hash is None:
        await cancel("transaction_id is not a testnet transaction hash.")
        return
    if problem := fet.commit_problem(msg, record, sender):
        await cancel(problem)
        return
    reference = record["reference"]
    used_for = ctx.storage.get(f"fet_tx:{tx_hash}")
    if used_for == reference:  # a retried CommitPayment for a transfer already accepted for this order
        await send(ctx, sender, CompletePayment(transaction_id=tx_hash), "CompletePayment (retry)")
        return
    if tx_hash in _fet_claims or used_for:
        await cancel("This transaction has already paid for an order.")
        return
    _fet_claims.add(tx_hash)
    try:
        orders = await asyncio.to_thread(stdb.orders_for_payment, tx_hash)
        if any(o["ref"] != reference for o in orders):
            await cancel("This transaction has already paid for an order.")
            return
        buyer_wallet = str(msg.metadata["buyer_fet_wallet"])
        tx = await _fet_tx(tx_hash)
        reason = fet.check_transfer(tx, recipient=WALLET, sender=buyer_wallet,
                                    min_atestfet=int(record["fet_atestfet"]))
    except Exception as err:  # noqa: BLE001 - the buyer is told; the log keeps the cause
        _fet_claims.discard(tx_hash)
        ctx.logger.exception(f"fet verification failed for {tx_hash}")
        await cancel(f"FORGE could not check the transaction right now.")
        return
    if reason:
        _fet_claims.discard(tx_hash)
        await cancel(reason)
        return
    ctx.storage.set(f"fet_tx:{tx_hash}", reference)
    ctx.logger.info(f"fet payment verified {tx_hash} height={tx['height']} from={buyer_wallet} ref={reference}")
    await _settle(ctx, sender, record, tx_hash, f"TEST MODE, {record['fet_amount']} testnet FET, tx {tx_hash}")


@pay.on_message(RejectPayment)
async def on_reject(ctx: Context, sender: str, msg: RejectPayment) -> None:
    _log(ctx, "IN", sender, f"RejectPayment {msg.reason or ''}")
    await reply(ctx, sender, f"Payment cancelled{f': {msg.reason}' if msg.reason else ''}. Reply **pay** to try again.")


agent.include(chat, publish_manifest=True)
agent.include(pay, publish_manifest=True)

if __name__ == "__main__":
    agent.run()
