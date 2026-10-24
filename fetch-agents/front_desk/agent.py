"""FORGE Front Desk: the customer's whole journey in ASI:One.

Gate 0 scope: chat reply with the layer-2 gate decision, a TEST MODE Stripe payment card, and a
delayed agent-initiated message to check whether ASI:One shows messages the user didn't prompt.
"""

import asyncio
import os
import time
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

from front_desk.gate import run_layer2
from front_desk.intent import NotARequest, parse_intent, strip_mentions
from front_desk.payments import create_checkout, is_paid
from front_desk.stdb import gate_config

QUOTE_CENTS = 100  # Gate 0 flat test price; the COO prices real orders.
DELAYED_AFTER_S = 60
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


@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(sender, ChatAcknowledgement(timestamp=_now(), acknowledged_msg_id=msg.msg_id))
    text = strip_mentions(" ".join(c.text for c in msg.content if isinstance(c, TextContent)))
    _log(ctx, "IN", sender, text)
    if not text:
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
        blocked, cap = await asyncio.to_thread(gate_config)
    except NotARequest:
        ctx.logger.info(f"not a request {sender[:16]}: {text[:80]!r}")
        # ASI:One's own assistant answers our messages; replying every time would ping-pong forever.
        if ctx.storage.get(f"nudged:{sender}"):
            return
        ctx.storage.set(f"nudged:{sender}", True)
        await reply(ctx, sender, "I couldn't read that as a data request. Tell me which public site and which fields "
                                 "you want, e.g. \"open roles at Stripe by team and location\".")
        return
    except Exception as err:  # noqa: BLE001 - the customer gets a reply, the log gets the cause
        ctx.logger.exception("intent/gate failed")
        await reply(ctx, sender, f"Sorry, I couldn't read that request right now ({type(err).__name__}). Please try again.")
        return
    ctx.storage.remove(f"nudged:{sender}")
    result = run_layer2(fields=intent.fields, sources=intent.sources, request_text=text,
                        estimated_pages=intent.estimated_pages, blocked_domains=blocked, page_cap=cap)
    ctx.logger.info(f"gate {sender[:16]} {result.check} passed={result.passed}")
    if not result.passed and result.counteroffer_pages is None:
        await reply(ctx, sender, f"**Rejected at the desk.** {result.reason}")
        return

    scope = f"top {result.counteroffer_pages} pages" if result.counteroffer_pages else f"{intent.estimated_pages} page(s)"
    quote = {"summary": intent.summary, "sources": intent.sources, "fields": intent.fields,
             "pages": result.counteroffer_pages or intent.estimated_pages, "cents": QUOTE_CENTS}
    ctx.storage.set(f"quote:{sender}", quote)
    lines = [
        f"**{intent.summary}**",
        f"Sources: {', '.join(intent.sources) or 'to be researched'} · Fields: {', '.join(intent.fields) or 'to be confirmed'}",
        f"Scope: {scope}." + (f" {result.reason}" if result.counteroffer_pages else ""),
        "Every value will come with a verbatim quote from the source page.",
        f"Quote: ${QUOTE_CENTS / 100:.2f} (TEST MODE). Reply **pay** to accept.",
    ]
    await reply(ctx, sender, "\n\n".join(lines))
    schedule_followup(ctx, sender)


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    pass  # The chat protocol requires a handler for every message type it defines.


async def request_payment(ctx: Context, sender: str, quote: dict) -> None:
    reference = str(uuid4())
    checkout = await asyncio.to_thread(
        create_checkout, amount_cents=quote["cents"], description=quote["summary"], reference=reference, customer=sender)
    ctx.storage.set(f"checkout:{checkout['checkout_session_id']}", {"sender": sender, "quote": quote, "reference": reference})
    # ASI:One renders the card from RequestPayment, so it goes before the chat text.
    await send(ctx, sender, RequestPayment(
        accepted_funds=[Funds(currency="USD", amount=f"{quote['cents'] / 100:.2f}", payment_method="stripe")],
        recipient=str(ctx.agent.address),
        deadline_seconds=300,
        reference=reference,
        description=f"FORGE (TEST MODE): {quote['summary']}",
        metadata={"stripe": checkout, "service": "forge_data_api"},
    ), "RequestPayment")
    await reply(ctx, sender, "TEST MODE payment card above. Use card 4242 4242 4242 4242, any future date, any CVC.")


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
    await send(ctx, sender, CompletePayment(transaction_id=session_id), "CompletePayment")
    ctx.storage.remove(f"quote:{sender}")
    await reply(ctx, sender, f"Payment confirmed (TEST MODE). Order for **{record['quote']['summary']}** is queued.")


@pay.on_message(RejectPayment)
async def on_reject(ctx: Context, sender: str, msg: RejectPayment) -> None:
    _log(ctx, "IN", sender, f"RejectPayment {msg.reason or ''}")
    await reply(ctx, sender, f"Payment cancelled{f': {msg.reason}' if msg.reason else ''}. Reply **pay** to try again.")


# Delayed-message test (AGENTS.md §7 Fetch): does ASI:One show a message the agent sends
# on its own, a minute after the last exchange? Status updates for long orders depend on it.
def schedule_followup(ctx: Context, sender: str) -> None:
    if ctx.storage.get(f"followed_up:{sender}"):
        return
    due = ctx.storage.get("followups") or {}
    due[sender] = time.time() + DELAYED_AFTER_S
    ctx.storage.set("followups", due)


@agent.on_interval(period=10.0)
async def send_followups(ctx: Context) -> None:
    due = ctx.storage.get("followups") or {}
    now = time.time()
    ready = [s for s, at in due.items() if at <= now]
    for sender in ready:
        await reply(ctx, sender, f"Status check from the Front Desk, sent on my own {DELAYED_AFTER_S}s after your last message.")
        del due[sender]
        ctx.storage.set(f"followed_up:{sender}", True)
    if ready:
        ctx.storage.set("followups", due)


agent.include(chat, publish_manifest=True)
agent.include(pay, publish_manifest=True)

if __name__ == "__main__":
    agent.run()
