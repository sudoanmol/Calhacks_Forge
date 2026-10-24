"""Read-only SpacetimeDB access for the Front Desk. Writes go through reducers (added with orders)."""

import json
import os

import httpx


def _sql(query: str) -> list[dict]:
    host, db = os.environ["SPACETIME_HOST"], os.environ["SPACETIME_DB"]
    r = httpx.post(f"{host}/v1/database/{db}/sql", content=query, timeout=10)
    r.raise_for_status()
    [res] = r.json()
    names = [e["name"]["some"] for e in res["schema"]["elements"]]
    return [dict(zip(names, row)) for row in res["rows"]]


def gate_config() -> tuple[list[str], int]:
    """The founder's levers the layer-2 gate depends on: blocked_domains and page_cap."""
    cfg = {r["key"]: r["value"] for r in _sql("SELECT * FROM config")}
    return json.loads(cfg["blocked_domains"]), int(cfg["page_cap"])
