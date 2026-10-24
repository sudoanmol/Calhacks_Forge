"""Testnet FET payments: the offer the buyer agent reads, the CommitPayment checks, and the on-chain transfer check.

FAUCET_TX is a real dorado-1 transaction (the faucet funding the buyer agent's wallet), captured from GetTx.
PURCHASE_TX_HASH is the buyer agent's real 1.0 FET payment for order #131.
"""

from decimal import Decimal

import grpc
import pytest
from uagents_core.contrib.protocols.payment import CommitPayment, Funds

from buyer.offer import parse_offer
from front_desk import fet
from front_desk.payments import payment_request

FD_WALLET = "fetch1ykd2jf7xn7cfel24w4tavfrpu4w697fwm6nkqh"
BUYER_WALLET = "fetch1at4kaq6rp0rrkvyff2m44d4xara0dcdpx8vugw"
FAUCET = "fetch1faucet4f3ryl8l6ll5e4xyecm85klhlqfhc8hk"
FAUCET_TX_HASH = "4A1DA6EFB1A593725A7CCBCAB2A4A7A3863B0DC05A281712157A5EC53A69F9A9"
FAUCET_TX = {
    "hash": FAUCET_TX_HASH, "chain_id": "dorado-1", "code": 0, "height": 25843028,
    "timestamp": "2026-10-24T22:09:03Z", "raw_log": "", "memo": "faucet-fet",
    "transfers": [
        # The fee transfer comes first and has the same sender as the payment.
        {"recipient": "fetch17xpfvakm2amg962yls6f84z3kell8c5lry2yf2", "sender": FAUCET, "amount": "476565000000000atestfet"},
        {"recipient": BUYER_WALLET, "sender": FAUCET, "amount": "10000000000000000000atestfet", "msg_index": "0"},
    ],
}
PURCHASE_TX_HASH = "92CB62A56D1BC9B23CC87DAEED20C69D9FC3677AE4B825A540455405CABF2E10"
QUOTE = {"ref": "ref-fet", "order_id": 7, "summary": "Open roles at Lattice", "cents": 100}
RECORD = {"sender": "agent1qbuyer", "quote": QUOTE, "reference": "ref-fet", "fet_amount": "1.0", "fet_atestfet": 10**18}


def test_the_price_in_atestfet():
    assert fet.to_atestfet(fet.PRICE_FET) == 10**18
    assert fet.to_atestfet("0.5") == 5 * 10**17


def test_the_offer_keeps_stripe_and_the_buyer_agent_turns_it_into_a_testnet_transfer():
    checkout = {"client_secret": "cs_x_secret", "checkout_session_id": "cs_test_x", "publishable_key": "pk_test_x"}
    req = payment_request(quote=QUOTE, checkout=checkout, wallet=FD_WALLET)
    methods = {f.payment_method: f for f in req.accepted_funds}
    assert methods["stripe"].currency == "USD" and methods["stripe"].amount == "1.00"
    assert req.metadata["stripe"] == checkout and req.metadata["service"] == "forge_data_api"
    assert req.metadata["mainnet"] == "false" and req.reference == "ref-fet"
    plan = parse_offer(req, Decimal("5"))["plan"]
    assert plan["recipient"] == FD_WALLET and plan["network"] == "stable-testnet"
    assert plan["atestfet"] == RECORD["fet_atestfet"]
    assert plan["funds"] == {"amount": "1.0", "currency": "FET", "payment_method": "fet_direct"}


def test_hashes_are_normalized_and_junk_is_refused():
    assert fet.normalize_hash(FAUCET_TX_HASH.lower()) == FAUCET_TX_HASH
    assert fet.normalize_hash(" " + FAUCET_TX_HASH + "\n") == FAUCET_TX_HASH
    for junk in ("", "cs_test_abc", "0x" + FAUCET_TX_HASH, FAUCET_TX_HASH[:-1]):
        assert fet.normalize_hash(junk) is None


def test_coins_parse_multi_denom_amounts():
    assert fet.coins("5atestfet,2ibc/AB12") == {"atestfet": 5, "ibc/AB12": 2}
    assert fet.coins("") == {}


def test_the_payment_transfer_counts_and_the_fee_transfer_does_not():
    assert fet.paid_to(FAUCET_TX, recipient=BUYER_WALLET, sender=FAUCET) == 10 * 10**18
    assert fet.check_transfer(FAUCET_TX, recipient=BUYER_WALLET, sender=FAUCET, min_atestfet=10**18) is None


@pytest.mark.parametrize("change,kw,why", [
    ({}, {"sender": BUYER_WALLET}, "moved 0 atestfet"),          # someone else's transfer
    ({}, {"recipient": FD_WALLET}, "moved 0 atestfet"),          # paid a different wallet
    ({}, {"min_atestfet": 11 * 10**18}, "needs 11000000000000000000"),
    ({"code": 5, "raw_log": "insufficient funds"}, {}, "failed on chain (code 5)"),
])
def test_transfers_that_do_not_pay_the_order(change, kw, why):
    args = {"recipient": BUYER_WALLET, "sender": FAUCET, "min_atestfet": 10**18, **kw}
    assert why in fet.check_transfer({**FAUCET_TX, **change}, **args)


def test_an_unknown_transaction_does_not_pay():
    assert "not found" in fet.check_transfer(None, recipient=FD_WALLET, sender=BUYER_WALLET, min_atestfet=1)


def _commit(**kw) -> CommitPayment:
    base = {"funds": Funds(currency="FET", amount="1.0", payment_method="fet_direct"), "recipient": FD_WALLET,
            "transaction_id": FAUCET_TX_HASH, "reference": "ref-fet",
            "metadata": {"buyer_fet_wallet": BUYER_WALLET, "fet_network": "stable-testnet"}}
    return CommitPayment(**{**base, **kw})


def test_a_well_formed_commit_passes_the_precheck():
    assert fet.commit_problem(_commit(), RECORD, "agent1qbuyer") is None


@pytest.mark.parametrize("commit,record,sender,why", [
    (_commit(), None, "agent1qbuyer", "Unknown payment reference"),
    (_commit(), RECORD, "agent1qsomeoneelse", "Unknown payment reference"),
    (_commit(funds=Funds(currency="USD", amount="1.0", payment_method="fet_direct")), RECORD, "agent1qbuyer", "not USD"),
    (_commit(metadata={"buyer_fet_wallet": BUYER_WALLET, "fet_network": "mainnet"}), RECORD, "agent1qbuyer", "stable-testnet only"),
    (_commit(metadata={"fet_network": "stable-testnet"}), RECORD, "agent1qbuyer", "needs buyer_fet_wallet"),
])
def test_commits_that_are_refused_before_any_chain_lookup(commit, record, sender, why):
    assert why in fet.commit_problem(commit, record, sender)


def _live(fn):
    try:
        return fn()
    except grpc.RpcError as err:
        pytest.skip(f"testnet gRPC unavailable: {err.code()}")


def test_live_lookup_returns_the_captured_transaction():
    tx = _live(lambda: fet.fetch_tx(FAUCET_TX_HASH))
    assert tx == FAUCET_TX


def test_live_the_buyer_agents_purchase_pays_exactly_the_price():
    tx = _live(lambda: fet.fetch_tx(PURCHASE_TX_HASH.lower()))
    assert tx["hash"] == PURCHASE_TX_HASH and tx["memo"] == "0937abf3-aeed-4c6b-9e63-eda5b7a1829c"
    assert fet.paid_to(tx, recipient=FD_WALLET, sender=BUYER_WALLET) == 10**18
    assert fet.check_transfer(tx, recipient=FD_WALLET, sender=BUYER_WALLET, min_atestfet=10**18) is None
    assert "moved 0" in fet.check_transfer(tx, recipient=FD_WALLET, sender=FAUCET, min_atestfet=10**18)
    assert "needs" in fet.check_transfer(tx, recipient=FD_WALLET, sender=BUYER_WALLET, min_atestfet=10**18 + 1)


def test_live_lookup_of_an_unknown_hash_is_none():
    assert _live(lambda: fet.fetch_tx("00" * 32)) is None
