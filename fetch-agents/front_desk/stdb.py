"""SpacetimeDB access for the Front Desk: reads over anonymous SQL, writes through front_desk reducers."""

import json
import os

import httpx


class StdbError(RuntimeError):
    """A non-200 from SpacetimeDB. A reducer's SenderError arrives as HTTP 530 with the message as the body."""

    def __init__(self, what: str, status: int, body: str):
        super().__init__(f"{what}: HTTP {status}: {body[:300]}")
        self.status, self.body = status, body


def _base() -> str:
    return f"{os.environ['SPACETIME_HOST']}/v1/database/{os.environ['SPACETIME_DB']}"


def _sql(query: str) -> list[dict]:
    r = httpx.post(f"{_base()}/sql", content=query, timeout=10)
    if r.status_code != 200:
        raise StdbError("sql", r.status_code, r.text)
    [res] = r.json()
    names = [e["name"]["some"] for e in res["schema"]["elements"]]
    return [dict(zip(names, row)) for row in res["rows"]]


def _call(reducer: str, *args) -> None:
    r = httpx.post(f"{_base()}/call/{reducer}", json=list(args), timeout=15,
                   headers={"Authorization": f"Bearer {os.environ['SPACETIME_TOKEN_FRONT_DESK']}"})
    if r.status_code != 200:
        raise StdbError(reducer, r.status_code, r.text)


def _q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


# SATS-JSON: an option is [0, value] (some) or [1, []] (none); a timestamp is [micros].
def _opt(v):
    return v[1] if isinstance(v, list) and len(v) == 2 and v[0] == 0 else None


def _ts(v) -> int:
    return v[0] if isinstance(v, list) else int(v)


def _order(row: dict) -> dict:
    return {**row, "api_id": _opt(row["api_id"]), "api_version_id": _opt(row["api_version_id"]),
            "created_at": _ts(row["created_at"]), "updated_at": _ts(row["updated_at"])}


def gate_config() -> tuple[list[str], int]:
    """The founder's levers the layer-2 gate depends on: blocked_domains and page_cap."""
    cfg = {r["key"]: r["value"] for r in _sql("SELECT * FROM config")}
    return json.loads(cfg["blocked_domains"]), int(cfg["page_cap"])


def create_order(ref: str, asi_sender: str, request_text: str, intent: dict, price_cents: int) -> None:
    _call("create_order", ref, asi_sender, request_text, json.dumps(intent), price_cents)


def reject_at_desk(ref: str, asi_sender: str, request_text: str, intent: dict, check: str, reason: str) -> None:
    _call("reject_at_desk", ref, asi_sender, request_text, json.dumps(intent), check, reason)


def record_payment(ref: str, stripe_session_id: str) -> None:
    _call("record_payment", ref, stripe_session_id)


def order_by_ref(ref: str) -> dict | None:
    rows = _sql(f"SELECT * FROM orders WHERE ref = {_q(ref)}")
    return _order(rows[0]) if rows else None


def orders_for_sender(asi_sender: str) -> list[dict]:
    """The customer's orders, newest first."""
    customers = _sql(f"SELECT * FROM customer WHERE asi_sender = {_q(asi_sender)}")
    if not customers:
        return []
    rows = _sql(f"SELECT * FROM orders WHERE customer_id = {int(customers[0]['id'])}")
    return sorted((_order(r) for r in rows), key=lambda o: o["id"], reverse=True)


def value_records(order_id: int) -> list[dict]:
    """The order's current values in row order; a record another record supersedes is left out."""
    rows = [{**r, "supersedes_id": _opt(r["supersedes_id"])}
            for r in _sql(f"SELECT * FROM value_record WHERE order_id = {int(order_id)}")]
    superseded = {r["supersedes_id"] for r in rows if r["supersedes_id"] is not None}
    return sorted((r for r in rows if r["id"] not in superseded), key=lambda r: (r["row"], r["id"]))


def set_order_params(ref: str, params: dict[str, str]) -> None:
    _call("set_order_params", ref, json.dumps(params))


def catalog() -> list[dict]:
    """Non-retired APIs with `inputs` and `sources` parsed from JSON."""
    retired = {int(r["api_id"]) for r in _sql("SELECT * FROM api_retired")}
    return [{**r, "inputs": json.loads(r["inputs"] or "{}"), "sources": json.loads(r["sources"] or "[]")}
            for r in _sql("SELECT * FROM api") if int(r["id"]) not in retired]


def open_challenge(order_id: int, asi_sender: str, row: int, metric: str, reason: str) -> None:
    _call("open_challenge", int(order_id), asi_sender, int(row), metric, reason)


def challenges_for_orders(order_ids: list[int]) -> list[dict]:
    """Challenges on these orders, newest first."""
    ids = {int(i) for i in order_ids}
    rows = [r for r in _sql("SELECT * FROM challenge") if int(r["order_id"]) in ids]
    return sorted(rows, key=lambda r: r["id"], reverse=True)


def challenge_by_id(challenge_id: int) -> dict | None:
    rows = _sql(f"SELECT * FROM challenge WHERE id = {int(challenge_id)}")
    return rows[0] if rows else None


def challenge_check(challenge_id: int) -> dict | None:
    rows = _sql(f"SELECT * FROM challenge_check WHERE challenge_id = {int(challenge_id)}")
    return rows[0] if rows else None


def refunds_for_challenge(challenge_id: int) -> list[dict]:
    return [r for r in _sql("SELECT * FROM refund") if int(r["challenge_id"]) == int(challenge_id)]


def api_name(api_id: int) -> str | None:
    rows = _sql(f"SELECT * FROM api WHERE id = {int(api_id)}")
    return rows[0]["name"] if rows else None
