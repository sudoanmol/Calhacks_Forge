"""Testnet FET through the Payment Protocol: the price asked for and the on-chain check of a committed transfer.

The only proof of payment FORGE trusts is the chain's own record, read from the Fetch stable testnet (dorado).
`fetch_tx` blocks on the network; call it through asyncio.to_thread.
"""

import re
from decimal import Decimal

import grpc
from cosmpy.aerial.client import LedgerClient, NetworkConfig
from cosmpy.protos.cosmos.tx.v1beta1.service_pb2 import GetTxRequest
from uagents_core.contrib.protocols.payment import CommitPayment

METHOD = "fet_direct"
NETWORK = "stable-testnet"
DENOM = "atestfet"
ATESTFET_PER_FET = 10**18
PRICE_FET = "1.0"  # TEST MODE price on testnet, alongside the $1.00 Stripe quote
_COIN_RE = re.compile(r"^(\d+)([a-zA-Z][a-zA-Z0-9/:._-]*)$")
_HASH_RE = re.compile(r"^[0-9A-F]{64}$")


def to_atestfet(fet: str) -> int:
    return int(Decimal(fet) * ATESTFET_PER_FET)


def normalize_hash(tx_hash: str) -> str | None:
    """Upper-case hex, the form the chain reports; None when it isn't a 32-byte hex hash."""
    h = (tx_hash or "").strip().upper()
    return h if _HASH_RE.match(h) else None


def _config() -> NetworkConfig:
    return NetworkConfig.fetchai_stable_testnet()


def _s(v) -> str:
    return v.decode() if isinstance(v, bytes) else str(v)


def fetch_tx(tx_hash: str) -> dict | None:
    """The transaction as plain data, or None when the chain doesn't know the hash.

    Reads the raw GetTx response rather than LedgerClient.query_tx, whose event dict merges every `transfer`
    event into one and so can hide the fee transfer or the payment behind each other.
    """
    cfg = _config()
    try:
        resp = LedgerClient(cfg).txs.GetTx(GetTxRequest(hash=tx_hash))
    except grpc.RpcError as err:
        if "not found" in (err.details() or ""):
            return None
        raise
    r = resp.tx_response
    return {
        "hash": r.txhash, "chain_id": cfg.chain_id, "code": int(r.code), "height": int(r.height),
        "timestamp": r.timestamp, "raw_log": r.raw_log, "memo": resp.tx.body.memo,
        "transfers": [{_s(a.key): _s(a.value) for a in e.attributes} for e in r.events if e.type == "transfer"],
    }


def coins(amount: str) -> dict[str, int]:
    """'5atestfet,2foo' -> {'atestfet': 5, 'foo': 2}."""
    out: dict[str, int] = {}
    for part in (amount or "").split(","):
        if m := _COIN_RE.match(part.strip()):
            out[m.group(2)] = out.get(m.group(2), 0) + int(m.group(1))
    return out


def paid_to(tx: dict, *, recipient: str, sender: str) -> int:
    """atestfet moved from `sender` to `recipient` by this transaction's transfer events."""
    return sum(coins(t.get("amount", "")).get(DENOM, 0) for t in tx["transfers"]
               if t.get("recipient") == recipient and t.get("sender") == sender)


def commit_problem(msg: CommitPayment, record: dict | None, sender: str) -> str | None:
    """Why a fet_direct CommitPayment can't be checked on chain, or None. `record` is what FORGE asked this sender for."""
    if not record or record["sender"] != sender:
        return "Unknown payment reference."
    if msg.funds.currency.upper() != "FET":
        return f"fet_direct pays in FET, not {msg.funds.currency}."
    meta = msg.metadata or {}
    if meta.get("fet_network", NETWORK) != NETWORK:
        return f"FORGE accepts FET on {NETWORK} only."
    if not str(meta.get("buyer_fet_wallet", "")).startswith("fetch1"):
        return "CommitPayment metadata needs buyer_fet_wallet, the fetch1 wallet that sent the transfer."
    return None


def check_transfer(tx: dict | None, *, recipient: str, sender: str, min_atestfet: int) -> str | None:
    """Why this transaction doesn't pay the order, or None when it does."""
    if tx is None:
        return f"transaction not found on {NETWORK}"
    if tx["code"] != 0:
        return f"transaction failed on chain (code {tx['code']}): {tx['raw_log'][:120]}"
    paid = paid_to(tx, recipient=recipient, sender=sender)
    if paid < min_atestfet:
        return (f"transaction moved {paid} {DENOM} from {sender} to {recipient}; "
                f"the order needs {min_atestfet} {DENOM} ({min_atestfet / ATESTFET_PER_FET:g} FET)")
    return None
