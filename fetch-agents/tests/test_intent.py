"""Real ASI-1 calls: the intent parse feeds the layer-2 gate, so check it on the AGENTS.md examples."""

import os

import pytest

from front_desk.gate import run_layer2
from front_desk.intent import parse_intent

pytestmark = pytest.mark.skipif(not os.environ.get("ASI1_API_KEY"), reason="needs ASI1_API_KEY")

BLOCKED = ["linkedin.com", "facebook.com", "instagram.com"]


def gate(text: str):
    i = parse_intent(text)
    return i, run_layer2(fields=i.fields, sources=i.sources, request_text=text,
                         estimated_pages=i.estimated_pages, blocked_domains=BLOCKED, page_cap=25)


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
