"""The checkout shortcut is opt-in and remains visibly simulated in customer status."""

import pytest

from front_desk.payments import demo_pay_enabled
from front_desk.status import format_order


@pytest.mark.parametrize("setting,enabled", [(None, False), ("false", False), ("1", False), ("true", True), ("TRUE", True)])
def test_demo_pay_is_explicitly_enabled(monkeypatch, setting, enabled):
    monkeypatch.delenv("FORGE_DEMO_PAY", raising=False)
    if setting is not None:
        monkeypatch.setenv("FORGE_DEMO_PAY", setting)
    assert demo_pay_enabled() is enabled


def test_simulated_payment_is_labeled_in_later_status_replies():
    order = {"id": 1, "status": "paid", "request_text": "public data", "price_cents": 100,
             "stripe_session_id": "demo-simulated:example-ref"}
    out = format_order(order)
    assert "SIMULATED PAYMENT · TEST MODE" in out
    assert "No money was charged" in out
    assert "real services" in out
    order["stripe_session_id"] = "cs_test_example"
    assert "SIMULATED" not in format_order(order)
