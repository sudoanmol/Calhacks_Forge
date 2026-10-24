"""Real Stripe test-mode calls: the checkout metadata ASI:One renders, and the paid check."""

import os

import pytest

from front_desk.payments import create_checkout, is_paid

pytestmark = pytest.mark.skipif(not os.environ.get("STRIPE_SECRET_KEY"), reason="needs Stripe test keys")


def test_checkout_metadata_has_what_the_card_needs_and_no_secret():
    meta = create_checkout(amount_cents=100, description="pytest", reference="pytest-ref", customer="agent1qtest")
    assert meta["checkout_session_id"].startswith("cs_test_")
    assert meta["client_secret"] and meta["publishable_key"].startswith("pk_test_")
    assert meta["ui_mode"] == "embedded"
    assert not any(str(v).startswith("sk_") for v in meta.values()), "secret key must never reach metadata"


def test_an_unpaid_session_is_not_paid():
    meta = create_checkout(amount_cents=100, description="pytest", reference="pytest-ref", customer="agent1qtest")
    assert is_paid(meta["checkout_session_id"]) is False


def test_a_live_key_is_refused(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_notreal")
    with pytest.raises(RuntimeError, match="TEST MODE"):
        create_checkout(amount_cents=100, description="x", reference="x", customer="x")
