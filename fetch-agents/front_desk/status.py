"""The customer's `status` reply: plain-word order state, and the delivered values as a short table."""

import json
import re
from collections import Counter

# Cheap match for "where's my order"-type messages, so status never costs an ASI-1 call.
_STATUS_RE = re.compile(
    r"^(order )?status( please| pls)?$"
    r"|^(any|an|got (an|any)|what'?s the) updates?( yet)?$"
    r"|^updates?( please| pls)?$"
    r"|^(where('?s| is) my (order|data|dataset|results?))$"
    r"|^(how('?s| is) my (order|request) (going|doing))$"
    r"|^(is it|is my order|are you) (done|ready|finished)( yet)?$"
    r"|^(check|show)( my)? (order|status|progress)$"
    r"|^progress$",
    re.IGNORECASE,
)

PLAIN = {
    "quoted": "quoted, waiting for payment (reply **pay**)",
    "rejected_at_desk": "rejected at the desk",
    "paid": "paid, waiting for the COO to review it",
    "triaging": "with the COO for review",
    "accepted": "accepted by the COO, about to run",
    "counteroffered": "counteroffered by the COO",
    "rejected": "rejected by the COO",
    "researching": "being checked by Research (terms, robots.txt, reachability)",
    "running": "collecting data from the source pages",
    "verifying": "re-checking every value against the source (independent fetch)",
    "auditing": "values collected and checked; the Auditor is reviewing them",
    "delivered": "delivered",
    "audit_rejected": "rejected by the Auditor",
    "failed": "failed",
}
REASON_STATUSES = {"rejected_at_desk", "counteroffered", "rejected", "audit_rejected", "failed"}
VALUE_STATUSES = {"verifying", "auditing", "delivered", "audit_rejected"}
MAX_ROWS = 10
CELL = 40


def is_status_request(text: str) -> bool:
    return bool(_STATUS_RE.match(" ".join(text.lower().strip(" ?.!").split())))


def _cell(s: str, width: int = CELL) -> str:
    s = " ".join(str(s).split()).replace("|", "/")
    return s if len(s) <= width else s[: width - 1] + "…"


def _shown_value(r: dict) -> str:
    # Only values with a verbatim quote that the re-fetch confirmed are stated as facts.
    if r["status"] in ("verified", "corrected"):
        return r["value"]
    if r["status"] == "stale":
        return f"{r['value']} (now {r['fresh_value']})" if r.get("fresh_value") else r["value"]
    return "-"


def _counts(values: list[dict]) -> str:
    c = Counter(r["status"] for r in values)
    return ", ".join(f"{n} {s}" for s, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0])))


def _table(values: list[dict]) -> str:
    lines = ["| # | entity | metric | value | status |", "|---|---|---|---|---|"]
    for r in values[:MAX_ROWS]:
        lines.append(f"| {r['row']} | {_cell(r['entity'])} | {_cell(r['metric'])} | {_cell(_shown_value(r))} | {r['status']} |")
    if len(values) > MAX_ROWS:
        lines.append(f"\n…and {len(values) - MAX_ROWS} more rows in the dataset.")
    return "\n".join(lines)


def _title(o: dict) -> str:
    try:
        summary = json.loads(o.get("intent") or "{}").get("summary")
    except (ValueError, AttributeError):
        summary = None
    return summary or o.get("request_text") or "your request"


def format_order(o: dict, values: list[dict] | None = None, api: str | None = None) -> str:
    st = o["status"]
    head = f"**Order #{o['id']}**: {_cell(_title(o), 90)}" + (f" · API `{api}`" if api else "")
    parts = [head, f"Status: {PLAIN.get(st, st)}."]
    if o.get("price_cents"):
        parts[-1] += f" Price ${o['price_cents'] / 100:.2f} (TEST MODE)."
    if st in REASON_STATUSES and o.get("decision_reason"):
        parts.append(f"Reason: {o['decision_reason']}")
    values = values or []
    if st in VALUE_STATUSES and values:
        parts.append(f"Values: {len(values)} ({_counts(values)}).")
        if st == "delivered":
            parts.append(_table(values))
    if st == "delivered" and o.get("dataset_url"):
        parts.append(f"Dataset: {o['dataset_url']}")
    return "\n\n".join(parts)


def format_status(orders: list[dict], latest_values: list[dict] | None = None, latest_api: str | None = None) -> str:
    """`orders` newest first; the newest one is shown in full, up to three older ones in one line each."""
    if not orders:
        return "You have no orders yet. Tell me which public site and which fields you want."
    out = format_order(orders[0], latest_values, latest_api)
    older = orders[1:4]
    if older:
        out += "\n\nEarlier: " + " · ".join(f"#{o['id']} {o['status'].replace('_', ' ')}" for o in older)
    return out
