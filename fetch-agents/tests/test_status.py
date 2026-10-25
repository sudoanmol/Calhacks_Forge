"""Status replies: the cheap intent match and the chat formatting (pure, no network)."""

import json

import pytest

from front_desk.status import MAX_ROWS, format_order, format_status, is_status_request


@pytest.mark.parametrize("text", [
    "status", "Status?", "order status", "any update?", "Any updates yet?", "update", "where is my order",
    "where's my data", "is it done yet?", "how's my order going", "check my order", "progress",
])
def test_status_variants_match(text):
    assert is_status_request(text)


@pytest.mark.parametrize("text", [
    "RTX GPU listings from Newegg: price, stock, link", "pay", "thanks!",
    "status of open roles at Stripe by team", "update the price field to include tax",
])
def test_requests_and_chatter_are_not_status(text):
    assert not is_status_request(text)


def order(**kw):
    base = {"id": 12, "status": "quoted", "price_cents": 100, "intent": json.dumps({"summary": "Open roles at Stripe"}),
            "request_text": "open roles at stripe", "decision_reason": "", "dataset_url": "", "api_id": None}
    return {**base, **kw}


def value(row, status="verified", **kw):
    return {"row": row, "entity": "Airbnb", "metric": "name", "value": "Airbnb", "fresh_value": "", "status": status, **kw}


def test_no_orders():
    assert "no orders yet" in format_status([])


def test_quoted_order_names_the_order_and_test_mode_price():
    out = format_status([order()])
    assert "Order #12" in out and "Open roles at Stripe" in out
    assert "waiting for payment" in out and "$1.00 (TEST MODE)" in out


def test_rejection_shows_the_reason():
    out = format_order(order(status="rejected", decision_reason="Terms forbid scraping: https://x/terms"))
    assert "rejected by the COO" in out and "Terms forbid scraping" in out


def test_desk_rejection_has_no_price():
    out = format_order(order(status="rejected_at_desk", price_cents=0, decision_reason="personal data"))
    assert "TEST MODE" not in out and "personal data" in out


def test_auditing_shows_counts_but_no_table():
    out = format_order(order(status="auditing"), [value(0), value(1, "unverifiable")])
    assert "2 (1 unverifiable, 1 verified)" in out
    assert "| entity |" not in out


def test_delivered_shows_table_link_and_counts():
    vals = [value(i) for i in range(MAX_ROWS + 3)] + [value(99, "unverifiable", value="made up")]
    out = format_order(order(status="delivered", dataset_url="https://api.apify.com/v2/datasets/x/items"), vals, "yc-directory")
    assert "| # | entity | metric | value | status |" in out
    assert out.count("| Airbnb | name | Airbnb | verified |") == MAX_ROWS
    assert "…and 4 more rows" in out
    assert "13 verified, 1 unverifiable" in out
    assert "https://api.apify.com/v2/datasets/x/items" in out and "`yc-directory`" in out
    assert "made up" not in out  # an unverifiable value is never stated as a fact


def test_stale_value_shows_fresh_value_and_cells_are_chat_safe():
    vals = [value(0, "stale", value="$499", fresh_value="$479", entity="RTX | 4070\nSuper")]
    out = format_order(order(status="delivered"), vals)
    assert "$499 (now $479)" in out and "RTX / 4070 Super" in out


def refund(status, amount_cents=100):
    return {"order_id": 12, "challenge_id": 0, "amount_cents": amount_cents, "status": status}


def test_refund_lines():
    issued = format_order(order(status="rejected", decision_reason="Terms forbid it."), [], None, [refund("issued")])
    assert "Refunded $1.00 (TEST MODE)." in issued
    pending = format_order(order(status="failed", decision_reason="Apify failed."), [], None, [refund("pending_approval")])
    assert "Refund of $1.00 is waiting for the founder's approval (TEST MODE)." in pending
    declined = format_order(order(status="audit_rejected", decision_reason="Values mismatch."), [], None, [refund("rejected")])
    assert "The founder declined the refund of $1.00 (TEST MODE)." in declined


def test_counteroffer_says_what_to_do_next():
    out = format_order(order(status="counteroffered", decision_reason="Too broad; top 25 pages."), [], None, [refund("issued")])
    assert "your payment was refunded; ask for the smaller scope" in out
    assert "Refunded $1.00 (TEST MODE)." in out


def test_older_orders_are_listed_briefly():
    out = format_status([order(id=3, status="paid"), order(id=2, status="delivered"), order(id=1, status="rejected_at_desk")])
    assert out.startswith("**Order #3**") and "Earlier: #2 delivered · #1 rejected at desk" in out
