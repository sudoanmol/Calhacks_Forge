"""The buyer's own testnet wallet: faucet top-up and one direct FET transfer. Blocking; call via asyncio.to_thread."""

from cosmpy.aerial.client import LedgerClient, NetworkConfig
from cosmpy.aerial.faucet import FaucetApi
from cosmpy.aerial.wallet import LocalWallet
from cosmpy.crypto.address import Address

DENOM = "atestfet"
FEE_RESERVE = 10**17  # 0.1 testFET covers the transfer fee with room to spare


def _config() -> NetworkConfig:
    return NetworkConfig.fetchai_stable_testnet()


def balance(address: str) -> int:
    return int(LedgerClient(_config()).query_bank_balance(Address(address), DENOM))


def ensure_funds(address: str, needed: int) -> dict:
    before = balance(address)
    if before >= needed + FEE_RESERVE:
        return {"before": before, "faucet": False, "after": before}
    FaucetApi(_config()).get_wealth(address)
    return {"before": before, "faucet": True, "after": balance(address)}


def pay(wallet: LocalWallet, recipient: str, atestfet: int, memo: str | None) -> dict:
    tx = LedgerClient(_config()).send_tokens(Address(recipient), atestfet, DENOM, wallet, memo=memo)
    tx.wait_to_complete(timeout=90)
    return {"tx_hash": tx.tx_hash, "chain_id": _config().chain_id, "denom": DENOM, "amount": atestfet,
            "from": str(wallet.address()), "to": recipient, "memo": memo}
