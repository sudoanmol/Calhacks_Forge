"""Pure parsing of what the Front Desk sends: the quote, the payment offer, and status/delivery replies."""

import re
from decimal import Decimal, InvalidOperation

from uagents_core.contrib.protocols.payment import RequestPayment

FET_METHOD = "fet_direct"
TESTNET = "stable-testnet"
ATESTFET_PER_FET = 10**18
TERMINAL_PREFIXES = ("delivered", "rejected", "counteroffered", "failed")


def parse_quote(text: str) -> dict | None:
    """The Front Desk's quote: '**Order #12: …**' … 'Quote: $1.00 (TEST MODE). Reply **pay** to accept.'"""
    if "Reply **pay**" not in text:
        return None
    order = re.search(r"Order #(\d+)", text)
    price = re.search(r"Quote: \$(\d+(?:\.\d+)?)", text)
    return {"order_id": int(order.group(1)) if order else None, "price_usd": price.group(1) if price else None}


def parse_offer(req: RequestPayment, max_fet: Decimal) -> dict:
    """Decides how to answer a RequestPayment. Returns the offered options and either a FET plan or a reject reason.

    The buyer only pays FET on the Fetch stable testnet, to a fetch1 wallet, up to `max_fet`.
    """
    meta = req.metadata or {}
    options = [f.model_dump() for f in req.accepted_funds]
    out = {"options": options, "recipient": req.recipient, "reference": req.reference,
           "deadline_seconds": req.deadline_seconds, "description": req.description,
           "metadata_keys": sorted(meta.keys()), "plan": None, "reject": None}
    fet = next((f for f in req.accepted_funds
                if f.currency.upper() == "FET" and f.payment_method == FET_METHOD), None)
    if fet is None:
        out["reject"] = "buyer agent pays in FET only"
        return out
    network = meta.get("fet_network")
    if network != TESTNET or meta.get("mainnet") not in (None, "false"):
        out["reject"] = f"buyer agent pays on {TESTNET} only (offer says fet_network={network!r})"
        return out
    wallet = meta.get("provider_agent_wallet") if isinstance(meta.get("provider_agent_wallet"), str) else None
    recipient = req.recipient if req.recipient.startswith("fetch1") else wallet
    if not recipient or not recipient.startswith("fetch1") or (wallet and wallet != recipient):
        out["reject"] = "FET offer has no single fetch1 recipient wallet"
        return out
    try:
        amount = Decimal(fet.amount)
    except InvalidOperation:
        out["reject"] = f"unreadable FET amount {fet.amount!r}"
        return out
    if amount <= 0 or amount > max_fet:
        out["reject"] = f"FET amount {fet.amount} is outside the buyer's limit (0, {max_fet}]"
        return out
    out["plan"] = {"funds": fet.model_dump(), "recipient": recipient, "network": TESTNET,
                   "atestfet": int(amount * ATESTFET_PER_FET)}
    return out


def _row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse_status(text: str, order_id: int | None = None) -> dict | None:
    """A `status` reply for one order: state, value counts, the delivered table and the dataset link."""
    head = re.search(r"\*\*Order #(\d+)\*\*", text)
    if not head or (order_id is not None and int(head.group(1)) != order_id):
        return None
    state = re.search(r"Status: (.+?)\.(?: Price| *$|\n)", text, re.MULTILINE)
    phrase = state.group(1).strip() if state else ""
    api = re.search(r"API `([^`]+)`", text)
    counts = re.search(r"Values: (\d+) \(([^)]*)\)", text)
    dataset = re.search(r"Dataset: (\S+)", text)
    rows = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("| # |"):
            header = _row(line)
            for body in lines[i + 2:]:
                if not body.startswith("|"):
                    break
                rows.append(dict(zip(header, _row(body))))
            break
    more = re.search(r"…and (\d+) more rows", text)
    return {"order_id": int(head.group(1)), "state": phrase, "api": api.group(1) if api else None,
            "terminal": phrase.startswith(TERMINAL_PREFIXES), "delivered": phrase == "delivered",
            "value_count": int(counts.group(1)) if counts else None, "value_statuses": counts.group(2) if counts else None,
            "rows": rows, "more_rows": int(more.group(1)) if more else 0, "dataset_url": dataset.group(1) if dataset else None}
