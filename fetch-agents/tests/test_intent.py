"""Real ASI-1 calls: the intent parse feeds the layer-2 gate, so check it on the AGENTS.md examples."""

import os

import pytest

from front_desk.gate import run_layer2
from front_desk.intent import NotARequest, parse_intent, strip_mentions

pytestmark = pytest.mark.skipif(not os.environ.get("ASI1_API_KEY"), reason="needs ASI1_API_KEY")

BLOCKED = ["linkedin.com", "facebook.com", "instagram.com"]


def gate(text: str):
    text = strip_mentions(text)
    i = parse_intent(text)
    return i, run_layer2(fields=i.fields, sources=i.sources, request_text=text,
                         estimated_pages=i.estimated_pages, blocked_domains=BLOCKED, page_cap=25)


def test_asi_one_mention_is_stripped():
    # The exact shape ASI:One forwarded when the customer replied "pay".
    addr = "agent1qwxszhvaegkq6lsu8n0aks5sqz0l4h63janfx0xgrgcnvxgkl6n6uafetjq"
    assert strip_mentions(f"@{addr} pay") == "pay"
    assert strip_mentions(f"@{addr}  RTX GPU listings from Newegg") == "RTX GPU listings from Newegg"


def test_mentioned_request_still_parses():
    intent, result = gate("@agent1qwxszhvaegkq6lsu8n0aks5sqz0l4h63janfx0xgrgcnvxgkl6n6uafetjq "
                          "Open roles at Anthropic by team and location from their public job board")
    assert intent.fields and result.passed, (intent, result)


@pytest.mark.parametrize("text", [
    # Real message ASI:One's assistant sent back to the Front Desk.
    "Same automated-looking message again — I'll keep ignoring it. There's no real request here.",
    "pay",
    "thanks!",
])
def test_chatter_is_not_a_request(text):
    with pytest.raises(NotARequest):
        parse_intent(text)


def test_public_listing_request_passes():
    intent, result = gate("RTX GPU listings from Newegg: price, stock, link")
    assert any("newegg" in s.lower() for s in intent.sources), intent
    assert {"price", "stock"} <= {f.lower() for f in intent.fields}, intent
    assert result.passed, result


def test_personal_data_request_is_rejected():
    _, result = gate("Emails of engineers at Stripe")
    assert not result.passed and result.check == "personal_data", result


def test_login_only_source_is_rejected():
    _, result = gate("Job titles of everyone at Acme from their LinkedIn page")
    assert not result.passed
    assert result.check in {"personal_data", "blocked_domain"}, result


def test_huge_scope_gets_a_counteroffer():
    _, result = gate("Every product listed anywhere on amazon.com with price")
    assert not result.passed and result.check == "page_cap", result
    assert result.counteroffer_pages == 25
