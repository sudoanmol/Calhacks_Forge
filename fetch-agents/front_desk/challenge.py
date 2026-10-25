"""Customer challenges (AGENTS.md §3 Addition 2): spotting "row 4 is wrong because ..." and the chat replies."""

import re
from dataclasses import dataclass
from datetime import datetime, timezone

_ROW = re.compile(r"\brow\s*#?\s*(\d+)\b", re.IGNORECASE)
_ORDER = re.compile(r"\border\s*#?\s*(\d+)\b", re.IGNORECASE)
_WRONG = re.compile(
    r"\b(wrong|incorrect|inaccurate|not (right|correct|true|accurate)|isn'?t (right|correct|true|accurate)|mistaken?|"
    r"error|bad|outdated|out of date|false|challenge|dispute)\b",
    re.IGNORECASE,
)

PLAIN = {
    "rechecking": "rechecking the source now",
    "auditing": "recheck done; the Auditor is reviewing it (this takes a few minutes)",
    "upheld": "upheld by the Auditor",
    "rejected": "rejected by the Auditor",
}
RESULT = {
    "match": "matches what we delivered",
    "changed": "shows a different value",
    "missing": "no longer shows this quote",
    "unavailable": "could not be loaded",
}


@dataclass
class Challenge:
    row: int
    order_id: int | None
    reason: str
    metric: str | None = None


def parse_challenge(text: str) -> Challenge | None:
    """A message that names a row and says it is wrong. Deterministic, so it never costs an ASI-1 call."""
    row = _ROW.search(text)
    if not row or not _WRONG.search(text):
        return None
    order = _ORDER.search(text)
    return Challenge(row=int(row.group(1)), order_id=int(order.group(1)) if order else None, reason=text.strip())


def _key(s: str) -> str:
    return re.sub(r"[\s_-]+", " ", s.lower()).strip()


def pick_metric(text: str, metrics: list[str]) -> str:
    """The one metric of the row the customer names ("row 0 batch is wrong"), or '' when none or several match."""
    said = f" {_key(text)} "
    named = {m for m in metrics if f" {_key(m)} " in said}
    return named.pop() if len(named) == 1 else ""


def _when(micros) -> str:
    us = micros[0] if isinstance(micros, list) else micros
    return datetime.fromtimestamp(int(us) / 1e6, timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _q(s: str, width: int = 160) -> str:
    s = " ".join(str(s).split())
    return f'"{s if len(s) <= width else s[: width - 1] + "…"}"'


def _side(label: str, when: str, result: str, value: str, quote: str, delivered: str, reason: str) -> str:
    line = f"{label} ({when}): {RESULT.get(result, result)}"
    if result in ("match", "changed") and quote:
        line += f": {_q(quote)}"
    if result == "changed" and value and value != delivered:
        line += f" (value {_q(value, 60)})"
    if result == "unavailable" and reason:
        line += f" ({reason})"
    return line + "."


def format_challenge(c: dict, check: dict | None, refunds: list[dict] | None = None) -> str:
    """One challenge for chat: what was challenged, the saved page vs the fresh fetch, and the Auditor's verdict."""
    head = f"**Challenge #{c['id']}** on order #{c['order_id']}"
    if check:
        head += f", row {check['row']} `{check['metric']}` (delivered {_q(check['value'], 60)})"
    parts = [head + f": {PLAIN.get(c['status'], c['status'])}."]
    if check:
        parts.append(_side("Saved page the extractor read", _when(check["observed_at"]), check["saved_result"],
                           check["saved_value"], check["saved_quote"], check["value"], check["saved_reason"]))
        parts.append(_side("Fresh fetch", _when(check["fresh_fetched_at"]), check["fresh_result"],
                           check["fresh_value"], check["fresh_quote"], check["value"], check["fresh_reason"]))
    if c["status"] in ("upheld", "rejected") and c.get("auditor_reason"):
        parts.append(f"Auditor: {c['auditor_reason']}")
    for r in refunds or []:
        state = {"issued": "booked in FORGE's ledger; the test payment itself is not reversed", "pending_approval": "waiting for the founder's approval", "rejected": "declined"}.get(r["status"], r["status"])
        parts.append(f"Refund: ${r['amount_cents'] / 100:.2f} (TEST MODE) {state}.")
    return "\n\n".join(parts)
