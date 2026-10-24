"""Real SpacetimeDB calls on Maincloud as the front_desk seat. Refs and senders start with `test-`."""

import os
from uuid import uuid4

import httpx
import pytest

from front_desk import stdb

pytestmark = pytest.mark.skipif(not os.environ.get("SPACETIME_TOKEN_FRONT_DESK"), reason="needs the front_desk token")

INTENT = {"summary": "pytest order", "sources": ["example.com"], "fields": ["title"], "estimated_pages": 1, "pages": 1}


def ids():
    u = uuid4().hex[:12]
    return f"test-{u}", f"test-sender-{u}"


def test_order_is_created_read_back_and_paid():
    ref, sender = ids()
    stdb.create_order(ref, sender, "pytest request", INTENT, 100)
    o = stdb.order_by_ref(ref)
    assert o and o["status"] == "quoted" and o["price_cents"] == 100 and o["api_id"] is None
    assert [x["ref"] for x in stdb.orders_for_sender(sender)] == [ref]
    assert stdb.value_records(o["id"]) == []

    stdb.record_payment(ref, "cs_test_pytest")
    paid = stdb.order_by_ref(ref)
    assert paid["status"] == "paid" and paid["stripe_session_id"] == "cs_test_pytest"

    with pytest.raises(stdb.StdbError, match="not quoted") as err:
        stdb.record_payment(ref, "cs_test_pytest")
    assert err.value.status == 530
    _coo_reject(paid["id"])


def test_order_params_are_set_and_checked():
    ref, sender = ids()
    stdb.create_order(ref, sender, "open roles by team at Lattice", INTENT, 100)
    stdb.set_order_params(ref, {"board": "lattice"})
    assert stdb.order_by_ref(ref)["params"] == '{"board":"lattice"}'
    with pytest.raises(stdb.StdbError) as err:
        stdb.set_order_params(ref, {"board": "Not A Slug!"})
    assert err.value.status == 530
    stdb.record_payment(ref, "cs_test_pytest_params")
    _coo_reject(stdb.order_by_ref(ref)["id"])


def _coo_reject(order_id: int) -> None:
    # A paid order queues a coo_triage task; close it now so dispatch doesn't spend a real CREAO run on test data.
    token = os.environ.get("SPACETIME_TOKEN_COO")
    if not token:
        return
    r = httpx.post(f"{stdb._base()}/call/coo_decide", json=[order_id, "REJECT", "-", "pytest order, closed by the test"],
                   headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 200, r.text


def test_orders_for_sender_newest_first():
    ref1, sender = ids()
    ref2 = ref1 + "-b"
    stdb.create_order(ref1, sender, "first", INTENT, 100)
    stdb.create_order(ref2, sender, "second", INTENT, 100)
    assert [o["ref"] for o in stdb.orders_for_sender(sender)] == [ref2, ref1]


def test_reject_at_desk_records_reason():
    ref, sender = ids()
    stdb.reject_at_desk(ref, sender, "Emails of engineers at Stripe", INTENT, "personal_data", "personal data (emails)")
    o = stdb.order_by_ref(ref)
    assert o["status"] == "rejected_at_desk" and o["decision_reason"] == "personal data (emails)"


def test_duplicate_ref_is_refused():
    ref, sender = ids()
    stdb.create_order(ref, sender, "pytest request", INTENT, 100)
    with pytest.raises(stdb.StdbError, match="exists"):
        stdb.create_order(ref, sender, "pytest request", INTENT, 100)


def test_unknown_sender_has_no_orders():
    assert stdb.orders_for_sender("test-nobody-" + uuid4().hex) == []


def test_wrong_token_is_refused(monkeypatch):
    monkeypatch.setenv("SPACETIME_TOKEN_FRONT_DESK", "not-a-token")
    ref, sender = ids()
    with pytest.raises(stdb.StdbError):
        stdb.create_order(ref, sender, "pytest request", INTENT, 100)


def test_open_challenge_needs_a_delivered_order_the_customer_owns():
    ref, sender = ids()
    stdb.create_order(ref, sender, "pytest request", INTENT, 100)
    o = stdb.order_by_ref(ref)
    with pytest.raises(stdb.StdbError, match="only a delivered order can be challenged") as err:
        stdb.open_challenge(o["id"], sender, 0, "", "row 0 is wrong")
    assert err.value.status == 530
    delivered = next((x for x in stdb.orders_for_sender("asi-e2e-founder") if x["status"] == "delivered"), None)
    if delivered:
        with pytest.raises(stdb.StdbError, match="does not belong to this customer"):
            stdb.open_challenge(delivered["id"], sender, 0, "", "row 0 is wrong")
    assert stdb.challenges_for_orders([o["id"]]) == []
