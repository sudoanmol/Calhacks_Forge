"""ASI:One cards. Full text accompanies each card as the protocol's fallback."""

import json
import re
from datetime import datetime, timezone

from front_desk.status import PLAIN, _shown_value

TOKEN = re.compile(r"(?<![\w:])forge:(?:(pay|cancel|challenge|api|recheck):(\d+)|status)(?![\w:])")


def card_metadata(kind: str, payload: dict, *, terminal: bool = False, width: int | None = None) -> dict[str, str]:
    encoded = json.dumps(payload, separators=(",", ":"))
    if len(encoded.encode()) > 60_000:
        raise ValueError("card payload exceeds 60000 bytes")
    metadata = {"card_protocol_version": "1", "requires_card_interaction": "true",
                "card_kind": kind, "card_payload": encoded}
    if terminal:
        metadata["is_terminal"] = "true"
    if width is not None:
        if not 320 <= width <= 800:
            raise ValueError("drawer width must be 320–800")
        metadata["preferred_drawer_width_px"] = str(width)
    return metadata


def parse_selection(text: str) -> tuple[str, int | None] | None:
    def tokens(value):
        if isinstance(value, str):
            return TOKEN.findall(value)
        if isinstance(value, dict):
            return [t for v in value.values() for t in tokens(v)]
        if isinstance(value, list):
            return [t for v in value for t in tokens(v)]
        return []
    try:
        found = tokens(json.loads(text))
    except ValueError:
        found = TOKEN.findall(text)
    found = set(found)
    if len(found) != 1:
        return None
    action, order_id = found.pop()
    return action or "status", int(order_id) if order_id else None


def quote_is_fresh(quote: dict, now: datetime | None = None) -> bool:
    try:
        age = ((now or datetime.now(timezone.utc)) - datetime.fromisoformat(quote["quoted_at"])).total_seconds()
        return 0 <= age < 30 * 60
    except (KeyError, ValueError, TypeError):
        return False


def quote_card(quote: dict, scope: str, simulated: bool) -> dict[str, str]:
    price = f"${quote['cents'] / 100:.2f} TEST MODE" + (" · SIMULATED PAYMENT" if simulated else "")
    return card_metadata("review", {
        "title": f"Order #{quote['order_id']} · {quote['summary'][:200]}",
        "summary_rows": [{"label": "Sources", "value": ", ".join(quote['sources'])[:1500]},
                         {"label": "Fields", "value": ", ".join(quote['fields'])[:1500]},
                         {"label": "Scope", "value": scope}, {"label": "Price", "value": price},
                         {"label": "Proof", "value": "Every value has a verbatim quote from the saved source page"}],
        "approve_cta": {"label": "Run demo" if simulated else "Pay", "selection": {"action": f"forge:pay:{quote['order_id']}"}},
        "reject_cta": {"label": "Cancel", "selection": {"action": f"forge:cancel:{quote['order_id']}"}},
    })


def order_card(order: dict, values: list[dict], api: str | None, refunds: list[dict]) -> dict[str, str]:
    facts = [v for v in values if v['metric'] != '_page']
    rows = [{"label": "Status", "value": PLAIN.get(order['status'], order['status'])},
            {"label": "Price", "value": f"${order['price_cents'] / 100:.2f} TEST MODE"}]
    if order.get('stripe_session_id', '').startswith('demo-simulated:'):
        rows.append({"label": "Payment", "value": "SIMULATED PAYMENT · TEST MODE"})
    if order['status'] == 'delivered':
        rows.append({"label": "Verified", "value": f"{sum(v['status'] == 'verified' for v in facts)}/{len(facts)} verified by independent Bright Data re-fetch"})
        preview_rows = list(dict.fromkeys(v['row'] for v in facts))[:3]
        for row in preview_rows:
            fields = [v for v in facts if v['row'] == row][:6]
            rows.append({"label": f"Row {row}", "value": " · ".join(f"{v['metric'][:40]}: {_shown_value(v)[:120]} ({v['status']})" for v in fields)})
        if order.get('dataset_url'):
            rows.append({"label": "Dataset", "value": order['dataset_url']})
    issued = sum(int(r['amount_cents']) for r in refunds if r['status'] == 'issued')
    if issued:
        rows.append({"label": "Refund", "value": f"${issued / 100:.2f} booked in FORGE's ledger, TEST MODE; test payment not reversed"})
    elif any(r['status'] == 'pending_approval' for r in refunds):
        rows.append({"label": "Refund", "value": "Waiting for founder approval, TEST MODE ledger"})
    ctas = [{"label": "Refresh status", "selection": {"action": "forge:status"}}]
    if order['status'] == 'delivered':
        ctas.insert(0, {"label": "Challenge a value", "selection": {"action": f"forge:challenge:{order['id']}"}})
    return card_metadata("detail", {"title": f"Order #{order['id']} · {api or 'public data'}", "summary_rows": rows, "ctas": ctas})


def catalog_card(apis: list[dict]) -> dict[str, str]:
    return card_metadata('carousel', {'title': 'FORGE public-data APIs · TEST MODE', 'items': [
        {'id': str(a['id']), 'title': a['name'], 'subtitle': a['description'][:200],
         'secondary_text': f"Tier {a['tier']} · ask for a quote",
         'primary_cta': {'label': 'Ask about this API', 'selection': {'action': f"forge:api:{a['id']}"}}}
        for a in apis[:20]
    ]})


def challenge_form(order_id: int, fields: list[str]) -> dict[str, str]:
    return card_metadata('form', {'title': f'Challenge order #{order_id}', 'fields': [
        {'name': 'row', 'kind': 'number', 'label': 'Row number', 'required': True},
        {'name': 'metric', 'kind': 'select', 'label': 'Field', 'required': True,
         'options': [{'value': f, 'label': f} for f in fields]},
        {'name': 'reason', 'kind': 'text', 'label': 'Why is this value wrong?', 'required': True},
    ], 'submit_cta': {'label': 'Recheck this value', 'selection': {'action': f'forge:recheck:{order_id}'}}})


def parse_challenge_fields(text: str) -> tuple[int, str, str] | None:
    try:
        data = json.loads(text)
        if not isinstance(data, dict):
            return None
        row = data.get('row')
        if isinstance(row, bool) or str(row) != str(int(row)) or not 0 <= int(row) <= 0xffff_ffff:
            return None
        metric, reason = data.get('metric'), data.get('reason')
        if not isinstance(metric, str) or not isinstance(reason, str) or not metric.strip() or not 1 <= len(reason.strip()) <= 2000:
            return None
        return int(row), metric, reason.strip()
    except (ValueError, TypeError, OverflowError):
        return None
