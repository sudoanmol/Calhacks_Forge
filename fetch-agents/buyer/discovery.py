"""Find a data seller on Agentverse through the public search API (`POST /v1/search/agents`)."""

import os

import httpx
from uagents import Protocol
from uagents_core.contrib.protocols.chat import chat_protocol_spec
from uagents_core.contrib.protocols.payment import payment_protocol_spec

SEARCH_URL = "https://agentverse.ai/v1/search/agents"
QUERIES = ["public web data API verified", "FORGE public data APIs"]
# A seller must speak chat (to take the request) and the payment protocol as seller (to take money).
CHAT_DIGEST = Protocol(spec=chat_protocol_spec).digest
PAY_SELLER_DIGEST = Protocol(spec=payment_protocol_spec, role="seller").digest
KEYWORDS = ("forge", "public web data", "public data", "verified", "data api")
KNOWN_FRONT_DESK = "agent1qwxszhvaegkq6lsu8n0aks5sqz0l4h63janfx0xgrgcnvxgkl6n6uafetjq"


def search(query: str, limit: int = 30) -> dict:
    headers = {"Content-Type": "application/json"}
    if key := os.environ.get("AGENTVERSE_API_KEY"):
        headers["Authorization"] = f"Bearer {key}"
    r = httpx.post(SEARCH_URL, json={"search_text": query, "offset": 0, "limit": limit}, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()


def score(agent: dict) -> tuple[int, list[str]]:
    """Returns (score, reasons). Score 0 means the agent can't sell to us at all."""
    digests = {p.get("digest") for p in agent.get("protocols") or []}
    if agent.get("status") != "active" or CHAT_DIGEST not in digests or PAY_SELLER_DIGEST not in digests:
        return 0, []
    reasons = ["active", "speaks AgentChatProtocol", "sells via AgentPaymentProtocol"]
    text = " ".join(str(agent.get(k) or "") for k in ("name", "description", "readme")).lower()
    hits = [k for k in KEYWORDS if k in text]
    reasons += [f"mentions {k!r}" for k in hits]
    return 1 + len(hits) + (5 if "forge" in text else 0), reasons


def summarize(agent: dict) -> dict:
    return {"address": agent.get("address"), "name": agent.get("name"), "type": agent.get("type"),
            "status": agent.get("status"), "protocols": [p.get("name") for p in agent.get("protocols") or []],
            "has_readme": bool(agent.get("readme")), "total_interactions": agent.get("total_interactions")}


def pick(results: dict[str, dict]) -> dict:
    """`results` maps query -> search response. Picks the best-scoring seller across all queries."""
    best, best_score, best_reasons, best_query, best_rank = None, 0, [], None, None
    for query, resp in results.items():
        for rank, agent in enumerate(resp.get("agents") or []):
            s, reasons = score(agent)
            if s > best_score:
                best, best_score, best_reasons, best_query, best_rank = agent, s, reasons, query, rank
    if best is None:
        return {"address": KNOWN_FRONT_DESK, "fallback": True,
                "why": "no active search result speaks chat + payment (seller); using the known FORGE Front Desk address"}
    return {"address": best["address"], "name": best.get("name"), "fallback": False, "score": best_score,
            "query": best_query, "rank": best_rank, "why": ", ".join(best_reasons)}


def discover(queries: list[str] | None = None) -> dict:
    queries = queries or QUERIES
    results, log = {}, []
    for q in queries:
        try:
            resp = search(q)
        except httpx.HTTPError as err:
            log.append({"query": q, "error": f"{type(err).__name__}: {err}"})
            continue
        results[q] = resp
        agents = resp.get("agents") or []
        log.append({"query": q, "total": resp.get("total"), "search_id": resp.get("search_id"),
                    "returned": len(agents), "top": [summarize(a) for a in agents[:10]],
                    "eligible": [{**summarize(a), "rank": i, "score": score(a)[0]}
                                 for i, a in enumerate(agents) if score(a)[0]]})
    return {"queries": log, "picked": pick(results)}
