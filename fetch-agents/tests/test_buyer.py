import os
from decimal import Decimal

import httpx
import pytest
from uagents_core.contrib.protocols.payment import Funds, RequestPayment

from buyer.discovery import KNOWN_FRONT_DESK, discover, pick, score, CHAT_DIGEST, PAY_SELLER_DIGEST
from buyer.offer import parse_offer, parse_quote, parse_status
from front_desk.status import format_order

FD_WALLET = "fetch1ykd2jf7xn7cfel24w4tavfrpu4w697fwm6nkqh"


def stripe_offer() -> RequestPayment:
    return RequestPayment(accepted_funds=[Funds(currency="USD", amount="1.00", payment_method="stripe")],
                          recipient="agent1qwxszh", deadline_seconds=300, reference="ref-1",
                          metadata={"stripe": {"client_secret": "x"}, "service": "forge_data_api"})


def fet_offer(**meta) -> RequestPayment:
    return RequestPayment(
        accepted_funds=[Funds(currency="USD", amount="1.00", payment_method="stripe"),
                        Funds(currency="FET", amount="0.5", payment_method="fet_direct")],
        recipient=FD_WALLET, deadline_seconds=300, reference="ref-2",
        metadata={"fet_network": "stable-testnet", "mainnet": "false", "provider_agent_wallet": FD_WALLET, **meta})


def test_stripe_only_offer_is_rejected():
    out = parse_offer(stripe_offer(), Decimal("5"))
    assert out["plan"] is None and out["reject"] == "buyer agent pays in FET only"
    assert out["options"][0]["payment_method"] == "stripe"


def test_fet_offer_becomes_a_testnet_transfer_plan():
    out = parse_offer(fet_offer(), Decimal("5"))
    assert out["reject"] is None
    assert out["plan"] == {"funds": {"amount": "0.5", "currency": "FET", "payment_method": "fet_direct"},
                           "recipient": FD_WALLET, "network": "stable-testnet", "atestfet": 5 * 10**17}


def test_fet_offer_with_agent_address_recipient_uses_the_wallet_from_metadata():
    req = fet_offer()
    req.recipient = "agent1qwxszh"
    assert parse_offer(req, Decimal("5"))["plan"]["recipient"] == FD_WALLET


@pytest.mark.parametrize("meta,reason", [
    ({"fet_network": "mainnet", "mainnet": "true"}, "stable-testnet only"),
    ({"provider_agent_wallet": "fetch1other"}, "no single fetch1 recipient"),
])
def test_unsafe_fet_offers_are_rejected(meta, reason):
    assert reason in parse_offer(fet_offer(**meta), Decimal("5"))["reject"]


def test_fet_amount_over_the_limit_is_rejected():
    assert "outside the buyer's limit" in parse_offer(fet_offer(), Decimal("0.1"))["reject"]


def test_quote_parse():
    text = ("**Order #42: RTX 5080 listings on Newegg**\n\nSources: newegg.com · Fields: price, stock\n\n"
            "Quote: $1.00 (TEST MODE). Reply **pay** to accept.")
    assert parse_quote(text) == {"order_id": 42, "price_usd": "1.00"}
    assert parse_quote("Payment confirmed (TEST MODE).") is None


def _values(n):
    return [{"row": i, "entity": f"RTX 5080 card {i}", "metric": "price", "value": f"${999 + i}.99",
             "status": "verified" if i % 2 else "stale", "fresh_value": "$1,049.99"} for i in range(1, n + 1)]


def test_delivered_status_from_the_real_front_desk_formatter():
    order = {"id": 42, "status": "delivered", "price_cents": 100, "intent": '{"summary": "RTX 5080 on Newegg"}',
             "dataset_url": "https://api.apify.com/v2/datasets/abc/items?clean=1"}
    out = parse_status(format_order(order, _values(12), "gpu-listings"), 42)
    assert out["delivered"] and out["terminal"] and out["api"] == "gpu-listings"
    assert out["value_count"] == 12 and "verified" in out["value_statuses"]
    assert len(out["rows"]) == 10 and out["more_rows"] == 2
    assert out["rows"][0] == {"#": "1", "entity": "RTX 5080 card 1", "metric": "price", "value": "$1000.99",
                              "status": "verified"}
    assert out["dataset_url"] == "https://api.apify.com/v2/datasets/abc/items?clean=1"


@pytest.mark.parametrize("st,terminal", [("quoted", False), ("researching", False), ("verifying", False),
                                         ("rejected", True), ("audit_rejected", True), ("failed", True)])
def test_in_flight_and_terminal_states(st, terminal):
    out = parse_status(format_order({"id": 7, "status": st, "price_cents": 100, "decision_reason": "x"}), 7)
    assert out["terminal"] is terminal and not out["delivered"]


def test_status_for_another_order_is_ignored():
    assert parse_status(format_order({"id": 7, "status": "paid"}), 8) is None


def _agent(addr, name, digests, status="active", readme=""):
    return {"address": addr, "name": name, "status": status, "readme": readme,
            "protocols": [{"name": "p", "digest": d} for d in digests]}


def test_pick_prefers_an_active_forge_seller_and_skips_non_sellers():
    results = {"q": {"agents": [
        _agent("agent1chatonly", "Forge chat", [CHAT_DIGEST]),
        _agent("agent1other", "Data seller", [CHAT_DIGEST, PAY_SELLER_DIGEST], readme="public data"),
        _agent("agent1forge", "forge-front-desk", [CHAT_DIGEST, PAY_SELLER_DIGEST]),
        _agent("agent1off", "forge-old", [CHAT_DIGEST, PAY_SELLER_DIGEST], status="inactive"),
    ]}}
    assert score(results["q"]["agents"][0])[0] == 0
    picked = pick(results)
    assert picked["address"] == "agent1forge" and not picked["fallback"] and picked["rank"] == 2


def test_pick_falls_back_to_the_known_address_and_says_so():
    picked = pick({"q": {"agents": [_agent("agent1x", "x", [CHAT_DIGEST])]}})
    assert picked["fallback"] and picked["address"] == KNOWN_FRONT_DESK


@pytest.mark.skipif(os.environ.get("FORGE_LIVE") != "1", reason="live Agentverse search; set FORGE_LIVE=1")
def test_live_discovery_finds_the_front_desk():
    try:
        out = discover()
    except httpx.HTTPError as err:
        pytest.skip(f"network: {err}")
    assert out["picked"]["address"] == KNOWN_FRONT_DESK and not out["picked"]["fallback"]
