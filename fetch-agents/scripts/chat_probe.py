"""Live probe: a throwaway uAgent talks to the Front Desk through Agentverse like a customer would.

Checks: chat reply with a quote, the unprompted follow-up ~60s later, and a Stripe RequestPayment
after "pay". Usage: uv run --env-file ../.env python scripts/chat_probe.py <front-desk-address>
"""

import json
import os
import secrets
import sys
import time
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, TextContent, chat_protocol_spec
from uagents_core.contrib.protocols.payment import (
    CancelPayment, CompletePayment, RejectPayment, RequestPayment, payment_protocol_spec)

FRONT_DESK = sys.argv[1]
REQUEST = "RTX GPU listings from Newegg: price, stock, link"
DEADLINE_S = 180

probe = Agent(name="forge-chat-probe", seed=secrets.token_hex(32), port=8012,
              endpoint=["http://127.0.0.1:8012/submit"])
chat = Protocol(spec=chat_protocol_spec)
pay = Protocol(spec=payment_protocol_spec, role="buyer")
seen: dict = {"replies": [], "acks": 0, "payment": None, "t0": time.time()}


def msg(text: str) -> ChatMessage:
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(type="text", text=text)])


def finish(ok: bool, why: str) -> None:
    print(json.dumps({"ok": ok, "why": why, **{k: v for k, v in seen.items() if k != "t0"}}, default=str, indent=2))
    sys.stdout.flush()
    os._exit(0 if ok else 1)  # sys.exit inside a uAgents handler leaves the event loop spewing shutdown errors


@probe.on_event("startup")
async def start(ctx: Context) -> None:
    await ctx.send(FRONT_DESK, msg(REQUEST))


@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, m: ChatMessage) -> None:
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=m.msg_id))
    text = " ".join(c.text for c in m.content if isinstance(c, TextContent))
    seen["replies"].append({"s": round(time.time() - seen["t0"]), "text": text[:300]})
    if "Reply **pay**" in text and not any("pay" == r.get("sent") for r in seen["replies"]):
        seen["replies"].append({"sent": "pay"})
        await ctx.send(FRONT_DESK, msg("pay"))


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, m: ChatAcknowledgement) -> None:
    seen["acks"] += 1


@pay.on_message(RequestPayment)
async def on_request(ctx: Context, sender: str, m: RequestPayment) -> None:
    stripe = (m.metadata or {}).get("stripe", {})
    seen["payment"] = {"funds": [f.model_dump() for f in m.accepted_funds], "has_client_secret": bool(stripe.get("client_secret")),
                       "session": str(stripe.get("checkout_session_id", ""))[:12], "has_secret_key": any(str(v).startswith("sk_") for v in stripe.values())}
    await ctx.send(sender, RejectPayment(reason="probe does not pay"))


@pay.on_message(CompletePayment)
async def on_complete(ctx: Context, sender: str, m: CompletePayment) -> None:
    pass


@pay.on_message(CancelPayment)
async def on_cancel(ctx: Context, sender: str, m: CancelPayment) -> None:
    pass


@probe.on_interval(period=5.0)
async def check(ctx: Context) -> None:
    unprompted = any("sent on my own" in r.get("text", "") for r in seen["replies"])
    rejected_ack = any("Payment cancelled" in r.get("text", "") for r in seen["replies"])
    if seen["payment"] and unprompted and rejected_ack:
        finish(True, "quote, payment request, reject acknowledgement and unprompted follow-up all arrived")
    if time.time() - seen["t0"] > DEADLINE_S:
        finish(False, "timed out")


probe.include(chat)
probe.include(pay)
probe.run()
