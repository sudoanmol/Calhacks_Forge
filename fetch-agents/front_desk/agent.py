"""FORGE Front Desk: the customer's whole journey in ASI:One.

Chat text -> ASI-1 intent parse -> layer-2 gate -> an order in SpacetimeDB (quoted or rejected_at_desk)
-> TEST MODE Stripe payment -> record_payment, after which the module drives the order. ASI:One doesn't
show agent-initiated messages, so progress is a `status` reply the customer asks for.
"""

import asyncio
import json
import os
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.contrib.protocols.payment import (
    CommitPayment,
    CompletePayment,
    Funds,
    RejectPayment,
    RequestPayment,
    payment_protocol_spec,
)

from front_desk import stdb
from front_desk.gate import run_layer2
from front_desk.intent import NotARequest, parse_intent, strip_mentions
from front_desk.payments import create_checkout, is_paid
from front_desk.status import format_status, is_status_request

QUOTE_CENTS = 100  # Flat test price until the COO prices orders.
PAY_WORDS = {"pay", "buy", "yes", "accept", "ok"}

agent = Agent(
    name="forge-front-desk",
    seed=os.environ["FRONT_DESK_SEED"],
    port=int(os.environ.get("FRONT_DESK_PORT", "8001")),
    mailbox=True,
    publish_agent_details=True,
)
chat = Protocol(spec=chat_protocol_spec)
pay = Protocol(spec=payment_protocol_spec, role="seller")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _text(body: str, end: bool = False) -> ChatMessage:
    content = [TextContent(type="text", text=body)]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=_now(), msg_id=uuid4(), content=content)


def _log(ctx: Context, direction: str, peer: str, what: str) -> None:
    ctx.logger.info(f"{_now().isoformat(timespec='seconds')} {direction} {peer[:16]} {what[:80]!r}")


async def send(ctx: Context, to: str, message, what: str) -> None:
    status = await ctx.send(to, message)
    _log(ctx, f"OUT[{getattr(status, 'status', status)}]", to, what)


async def reply(ctx: Context, to: str, body: str) -> None:
    await send(ctx, to, _text(body), body)


def _status_text(sender: str) -> str:
    orders = stdb.orders_for_sender(sender)
    if not orders:
        return format_status([])
    latest = orders[0]
    values = stdb.value_records(latest["id"])
    api = stdb.api_name(latest["api_id"]) if latest["api_id"] is not None else None
    return format_status(orders, values, api)


async def reply_status(ctx: Context, sender: str) -> None:
    try:
        body = await asyncio.to_thread(_status_text, sender)
    except Exception as err:  # noqa: BLE001
        ctx.logger.exception("status read failed")
        body = f"Sorry, I couldn't read your orders right now ({type(err).__name__}). Please try again."
    await reply(ctx, sender, body)


@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(sender, ChatAcknowledgement(timestamp=_now(), acknowledged_msg_id=msg.msg_id))
    text = strip_mentions(" ".join(c.text for c in msg.content if isinstance(c, TextContent)))
    _log(ctx, "IN", sender, text)
    if not text:
        return
    if is_status_request(text):
        await reply_status(ctx, sender)
        return
    pending = ctx.storage.get(f"quote:{sender}")
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
        await reply(ctx, sender, f"Sorry, I couldn't read that request right now ({type(err).__name__}). Please try again.")
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
        await asyncio.to_thread(stdb.create_order, ref, sender, text, intent_json, QUOTE_CENTS)
        order = await asyncio.to_thread(stdb.order_by_ref, ref)
        if order is None:
            raise RuntimeError(f"order {ref} not found after create_order")
    except Exception as err:  # noqa: BLE001
        ctx.logger.exception("create_order failed")
        await reply(ctx, sender, f"Sorry, I couldn't open an order right now ({type(err).__name__}). Please try again.")
        return
    scope = f"top {result.counteroffer_pages} pages" if result.counteroffer_pages else f"{intent.estimated_pages} page(s)"
    quote = {"ref": ref, "order_id": order["id"], "summary": intent.summary, "sources": intent.sources,
             "fields": intent.fields, "pages": intent_json["pages"], "cents": QUOTE_CENTS}
    ctx.storage.set(f"quote:{sender}", quote)
    lines = [
        f"**Order #{order['id']}: {intent.summary}**",
        f"Sources: {', '.join(intent.sources) or 'to be researched'} · Fields: {', '.join(intent.fields) or 'to be confirmed'}",
        f"Scope: {scope}." + (f" {result.reason}" if result.counteroffer_pages else ""),
        "Every value will come with a verbatim quote from the source page.",
        f"Quote: ${QUOTE_CENTS / 100:.2f} (TEST MODE). Reply **pay** to accept.",
    ]
    await reply(ctx, sender, "\n\n".join(lines))


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    pass  # The chat protocol requires a handler for every message type it defines.


async def request_payment(ctx: Context, sender: str, quote: dict) -> None:
    reference = quote["ref"]
    checkout = await asyncio.to_thread(
        create_checkout, amount_cents=quote["cents"], description=quote["summary"], reference=reference, customer=sender)
    ctx.storage.set(f"checkout:{checkout['checkout_session_id']}", {"sender": sender, "quote": quote, "reference": reference})
    # ASI:One renders the card from RequestPayment, so it goes before the chat text.
    await send(ctx, sender, RequestPayment(
        accepted_funds=[Funds(currency="USD", amount=f"{quote['cents'] / 100:.2f}", payment_method="stripe")],
        recipient=str(ctx.agent.address),
        deadline_seconds=300,
        reference=reference,
        description=f"FORGE (TEST MODE): order #{quote['order_id']} {quote['summary']}",
        metadata={"stripe": checkout, "service": "forge_data_api"},
    ), "RequestPayment")
    await reply(ctx, sender, "TEST MODE payment card above. Use card 4242 4242 4242 4242, any future date, any CVC.")


async def _record_payment(ref: str, session_id: str) -> None:
    try:
        await asyncio.to_thread(stdb.record_payment, ref, session_id)
    except stdb.StdbError:
        # A retried CommitPayment for an order already recorded as paid with this session is fine.
        order = await asyncio.to_thread(stdb.order_by_ref, ref)
        if not order or order["stripe_session_id"] != session_id:
            raise


@pay.on_message(CommitPayment)
async def on_commit(ctx: Context, sender: str, msg: CommitPayment) -> None:
    session_id = msg.transaction_id
    _log(ctx, "IN", sender, f"CommitPayment {str(session_id)[:14]}")
    record = ctx.storage.get(f"checkout:{session_id}") if session_id else None
    if not record or record["sender"] != sender:
        await ctx.send(sender, RejectPayment(reason="Unknown payment session."))
        return
    if not await asyncio.to_thread(is_paid, session_id):
        await ctx.send(sender, RejectPayment(reason="Stripe has not marked this checkout as paid yet."))
        return
    quote = record["quote"]
    try:
        await _record_payment(record["reference"], session_id)
    except Exception:  # noqa: BLE001 - Stripe has the money, so complete the payment and say what went wrong
        ctx.logger.exception(f"record_payment failed for {record['reference']}")
        await send(ctx, sender, CompletePayment(transaction_id=session_id), "CompletePayment")
        await reply(ctx, sender, f"Payment received (TEST MODE), but recording order #{quote['order_id']} failed. "
                                 f"Please pass this reference to the FORGE founder: {record['reference']}.")
        return
    await send(ctx, sender, CompletePayment(transaction_id=session_id), "CompletePayment")
    ctx.storage.remove(f"quote:{sender}")
    await reply(ctx, sender, f"Payment confirmed (TEST MODE). **Order #{quote['order_id']}** ({quote['summary']}) is queued "
                             "for the COO. Reply **status** any time to see where it is.")


@pay.on_message(RejectPayment)
async def on_reject(ctx: Context, sender: str, msg: RejectPayment) -> None:
    _log(ctx, "IN", sender, f"RejectPayment {msg.reason or ''}")
    await reply(ctx, sender, f"Payment cancelled{f': {msg.reason}' if msg.reason else ''}. Reply **pay** to try again.")


agent.include(chat, publish_manifest=True)
agent.include(pay, publish_manifest=True)

if __name__ == "__main__":
    agent.run()
