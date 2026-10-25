"""Challenge detection and the chat replies for a challenge (pure, no network)."""

import pytest

from front_desk.challenge import format_challenge, parse_challenge, pick_metric
from front_desk.status import is_status_request


@pytest.mark.parametrize("text, row, order", [
    ("row 4 is wrong because the price changed", 4, None),
    ("Row #0 batch is incorrect, Airbnb was W09", 0, None),
    ("order #85 row 2 website isn't right", 2, 85),
    ("I want to challenge row 12", 12, None),
    ("row 3 looks outdated", 3, None),
])
def test_challenges_are_spotted(text, row, order):
    c = parse_challenge(text)
    assert c and c.row == row and c.order_id == order and c.reason == text


@pytest.mark.parametrize("text", [
    "RTX GPU listings from Newegg: price, stock, link",
    "row 4 looks great, thanks",
    "this is wrong",  # no row: the desk can't tell which value
    "status",
    "open roles by team at Stripe, one row per team",
])
def test_other_messages_are_not_challenges(text):
    assert parse_challenge(text) is None


def test_a_challenge_is_not_a_status_request():
    assert not is_status_request("row 4 is wrong")


def test_pick_metric_names_one_metric_or_none():
    metrics = ["name", "one_liner", "website", "batch", "status"]
    assert pick_metric("row 0 batch is wrong", metrics) == "batch"
    assert pick_metric("row 0 one liner is wrong", metrics) == "one_liner"
    assert pick_metric("row 0 is wrong", metrics) == ""
    assert pick_metric("row 0 name and website are wrong", metrics) == ""
    assert pick_metric("row 0 price is wrong", ["price"]) == "price"


CH = {"id": 7, "order_id": 85, "status": "auditing", "auditor_reason": "", "verdict": ""}
CHECK = {
    "row": 0, "metric": "batch", "value": "Winter 2009", "observed_at": [1792878684415000], "fresh_fetched_at": [1792878761714000],
    "saved_result": "match", "saved_value": "Winter 2009", "saved_quote": "Batch: Winter 2009", "saved_reason": "",
    "fresh_result": "changed", "fresh_value": "Winter 2010", "fresh_quote": "Batch: Winter 2010", "fresh_reason": "",
}


def test_recheck_result_shows_both_quotes_and_timestamps():
    out = format_challenge(CH, CHECK)
    assert "**Challenge #7** on order #85, row 0 `batch`" in out and "the Auditor is reviewing it" in out
    assert 'Saved page the extractor read (2026-10-24 21:51:24 UTC): matches what we delivered: "Batch: Winter 2009".' in out
    assert 'Fresh fetch (2026-10-24 21:52:41 UTC): shows a different value: "Batch: Winter 2010" (value "Winter 2010").' in out


def test_verdict_and_refund_are_shown():
    out = format_challenge({**CH, "status": "upheld", "auditor_reason": "The saved page shows another company's batch."},
                           {**CHECK, "fresh_result": "unavailable", "fresh_reason": "http 502"},
                           [{"amount_cents": 100, "status": "issued"}])
    assert "upheld by the Auditor" in out and "Auditor: The saved page shows another company's batch." in out
    assert "Fresh fetch (2026-10-24 21:52:41 UTC): could not be loaded (http 502)." in out
    assert "Refund: $1.00 (TEST MODE) booked in FORGE's ledger; the test payment itself is not reversed." in out


def test_rechecking_without_results_yet():
    out = format_challenge({**CH, "status": "rechecking"}, None)
    assert out == "**Challenge #7** on order #85: rechecking the source now."
