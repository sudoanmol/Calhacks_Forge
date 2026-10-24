"""FORGE buyer agent: one script run that discovers FORGE on Agentverse, buys a named API and logs the purchase.

It is a separate customer: its own seed (BUYER_AGENT_SEED), its own testnet wallet, no FORGE keys or seat tokens.
Usage (from fetch-agents/): uv run --env-file ../.env python -m buyer.agent ["request text"]
"""

import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, TextContent, chat_protocol_spec
from uagents_core.contrib.protocols.payment import (
    CancelPayment, CommitPayment, CompletePayment, Funds, RejectPayment, RequestPayment, payment_protocol_spec)

from buyer import wallet as fet
from buyer.discovery import discover
from buyer.offer import parse_offer, parse_quote, parse_status

REQUEST = sys.argv[1] if len(sys.argv) > 1 else (
    "I'd like to buy gpu-listings: RTX 5080 listings on Newegg with price and stock")
PORT = int(os.environ.get("BUYER_PORT", "8013"))
DEADLINE_S = int(os.environ.get("BUYER_DEADLINE_S", "1500"))
STATUS_EVERY_S = int(os.environ.get("BUYER_STATUS_EVERY_S", "30"))
MAX_FET = Decimal(os.environ.get("BUYER_MAX_FET", "5"))
LOG_DIR = Path(__file__).parent / "logs"

seed = os.environ.get("BUYER_AGENT_SEED")
if not seed:
    raise SystemExit("BUYER_AGENT_SEED is not set")
# A local endpoint, like scripts/chat_probe.py: the Front Desk resolves it through the Almanac and replies directly.
buyer = Agent(name="forge-buyer", seed=seed, port=PORT, endpoint=[f"http://127.0.0.1:{PORT}/submit"])
chat = Protocol(spec=chat_protocol_spec)
pay = Protocol(spec=payment_protocol_spec, role="buyer")

started = datetime.now(timezone.utc)
log_path = LOG_DIR / f"{started.strftime('%Y%m%dT%H%M%SZ')}.json"
state: dict = {"seller": None, "order_id": None, "paid": False, "last_status": 0.0, "t0": time.time(), "done": False}
record: dict = {
    "started_at": started.isoformat(), "mode": "TEST MODE",
    "buyer": {"agent_address": buyer.address, "wallet": str(buyer.wallet.address())},
    "request": REQUEST, "discovery": None, "messages": [], "quote": None, "payment_offer": None,
    "payment": None, "status_replies": [], "delivered": None, "outcome": None,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def save() -> None:
    LOG_DIR.mkdir(exist_ok=True)
    log_path.write_text(json.dumps(record, indent=2, default=str))


def note(direction: str, kind: str, **fields) -> None:
    record["messages"].append({"at": _now().isoformat(), "s": round(time.time() - state["t0"], 1),
                               "dir": direction, "type": kind, **fields})
    print(f"[{direction}] {kind} {json.dumps(fields, default=str)[:400]}", flush=True)
    save()


def finish(outcome: str, why: str) -> None:
    if state["done"]:
        return
    state["done"] = True
    record["outcome"] = {"result": outcome, "why": why, "elapsed_s": round(time.time() - state["t0"], 1)}
    record["finished_at"] = _now().isoformat()
    save()
    print(json.dumps({"outcome": record["outcome"], "log": str(log_path)}, indent=2), flush=True)
    os._exit(0 if outcome in ("delivered", "payment_rejected_stripe_only") else 1)  # sys.exit inside a handler hangs the loop


async def say(ctx: Context, text: str) -> None:
    note("out", "ChatMessage", text=text)
    await ctx.send(state["seller"], ChatMessage(timestamp=_now(), msg_id=uuid4(),
                                                content=[TextContent(type="text", text=text)]))


@buyer.on_event("startup")
async def start(ctx: Context) -> None:
    record["discovery"] = await asyncio.to_thread(discover)
    picked = record["discovery"]["picked"]
    state["seller"] = picked["address"]
    note("info", "discovery", picked=picked)
    await say(ctx, REQUEST)


@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, m: ChatMessage) -> None:
    await ctx.send(sender, ChatAcknowledgement(timestamp=_now(), acknowledged_msg_id=m.msg_id))
    if sender != state["seller"]:
        note("in", "ChatMessage(ignored, not the seller)", sender=sender)
        return
    text = " ".join(c.text for c in m.content if isinstance(c, TextContent))
    note("in", "ChatMessage", text=text)
    if "Rejected at the desk" in text:
        finish("rejected_at_desk", text)
    if (quote := parse_quote(text)) and not record["quote"]:
        record["quote"] = {**quote, "text": text}
        state["order_id"] = quote["order_id"]
        await say(ctx, "pay")
        return
    if (status := parse_status(text, state["order_id"])) is not None:
        record["status_replies"].append({"at": _now().isoformat(), **{k: status[k] for k in ("state", "value_count")}})
        if status["delivered"]:
            record["delivered"] = {**status, "text": text}
            finish("delivered", f"order #{status['order_id']} delivered: {status['value_count']} values, "
                                f"{len(status['rows'])} rows shown, dataset {status['dataset_url']}")
        elif status["terminal"]:
            finish("order_" + status["state"].split()[0], text)
        elif record["payment"] and record["payment"].get("rejected"):
            finish("payment_rejected_stripe_only", "seller offered no FET option; order left unpaid: " + status["state"])
        save()


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, m: ChatAcknowledgement) -> None:
    pass


@pay.on_message(RequestPayment)
async def on_request(ctx: Context, sender: str, m: RequestPayment) -> None:
    offer = parse_offer(m, MAX_FET)
    record["payment_offer"] = offer
    note("in", "RequestPayment", options=offer["options"], recipient=m.recipient, reference=m.reference,
         metadata_keys=offer["metadata_keys"])
    if offer["reject"]:
        record["payment"] = {"rejected": True, "reason": offer["reject"]}
        note("out", "RejectPayment", reason=offer["reject"])
        await ctx.send(sender, RejectPayment(reason=offer["reject"]))
        return
    plan = offer["plan"]
    me = str(buyer.wallet.address())
    try:
        funding = await asyncio.to_thread(fet.ensure_funds, me, plan["atestfet"])
        note("info", "wallet", **funding)
        tx = await asyncio.to_thread(fet.pay, buyer.wallet, plan["recipient"], plan["atestfet"], m.reference)
    except Exception as err:  # noqa: BLE001 - the seller is told, the log keeps the cause
        record["payment"] = {"rejected": True, "reason": f"transfer failed: {type(err).__name__}: {err}"}
        note("out", "RejectPayment", reason=record["payment"]["reason"])
        await ctx.send(sender, RejectPayment(reason="buyer could not complete the FET transfer"))
        finish("payment_failed", record["payment"]["reason"])
        return
    record["payment"] = {"rejected": False, "network": plan["network"], **tx}
    note("info", "fet_transfer", **tx)
    commit = CommitPayment(funds=Funds(**plan["funds"]), recipient=plan["recipient"], transaction_id=tx["tx_hash"],
                           reference=m.reference, description=f"FORGE buyer agent: {REQUEST[:80]}",
                           metadata={"buyer_fet_wallet": me, "fet_network": plan["network"]})
    note("out", "CommitPayment", transaction_id=tx["tx_hash"], funds=plan["funds"], recipient=plan["recipient"])
    await ctx.send(sender, commit)


@pay.on_message(CompletePayment)
async def on_complete(ctx: Context, sender: str, m: CompletePayment) -> None:
    note("in", "CompletePayment", transaction_id=m.transaction_id)
    state["paid"] = True
    if record["payment"]:
        record["payment"]["completed"] = True


@pay.on_message(CancelPayment)
async def on_cancel(ctx: Context, sender: str, m: CancelPayment) -> None:
    note("in", "CancelPayment", transaction_id=m.transaction_id, reason=m.reason)
    finish("payment_cancelled_by_seller", m.reason or "")


@buyer.on_interval(period=5.0)
async def tick(ctx: Context) -> None:
    if time.time() - state["t0"] > DEADLINE_S:
        finish("timeout", f"no delivery within {DEADLINE_S}s")
    # The Front Desk answers `status` on demand; its unprompted messages may never arrive.
    rejected = bool(record["payment"] and record["payment"].get("rejected"))
    due = time.time() - state["last_status"] > (10 if rejected else STATUS_EVERY_S)
    if state["seller"] and (state["paid"] or rejected) and due:
        state["last_status"] = time.time()
        await say(ctx, "status")


buyer.include(chat)
buyer.include(pay)

if __name__ == "__main__":
    buyer.run()
