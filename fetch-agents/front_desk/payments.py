"""Stripe test-mode checkout for the ASI:One payment card. The secret key never leaves this module."""

import os
import time

import stripe
from uagents_core.contrib.protocols.payment import Funds, RequestPayment

from front_desk import fet

# ASI:One renders an embedded Checkout from the RequestPayment metadata; this page is where
# Stripe returns after payment.
RETURN_URL = "https://agentverse.ai/payment-success"
CHECKOUT_TTL_S = 1800  # Stripe's minimum expires_at window


def _stripe():
    key = os.environ["STRIPE_SECRET_KEY"]
    if not key.startswith("sk_test_"):
        raise RuntimeError("FORGE runs in TEST MODE: STRIPE_SECRET_KEY must be an sk_test_ key")
    stripe.api_key = key
    return stripe


def create_checkout(*, amount_cents: int, description: str, reference: str, customer: str) -> dict[str, str]:
    """Creates an embedded Checkout session and returns the metadata ASI:One needs to render it."""
    s = _stripe().checkout.Session.create(
        ui_mode="embedded_page",  # Stripe renamed "embedded"
        redirect_on_completion="if_required",
        mode="payment",
        return_url=f"{RETURN_URL}?session_id={{CHECKOUT_SESSION_ID}}",
        expires_at=int(time.time()) + CHECKOUT_TTL_S,
        line_items=[{
            "price_data": {
                "currency": "usd",
                "product_data": {"name": "FORGE data API (TEST MODE)", "description": description[:500]},
                "unit_amount": amount_cents,
            },
            "quantity": 1,
        }],
        metadata={"reference": reference, "customer": customer},
    )
    return {
        "client_secret": s.client_secret,
        "id": s.id,
        "checkout_session_id": s.id,
        "publishable_key": os.environ["STRIPE_PUBLISHABLE_KEY"],
        "currency": "usd",
        "amount_cents": str(amount_cents),
        # The value the Innovation Lab Stripe examples send; ASI:One reads it to pick the card.
        "ui_mode": "embedded",
    }


def payment_request(*, quote: dict, checkout: dict[str, str], wallet: str) -> RequestPayment:
    """The offer: a Stripe test card for people in ASI:One, or testnet FET to `wallet` for agents."""
    return RequestPayment(
        accepted_funds=[Funds(currency="USD", amount=f"{quote['cents'] / 100:.2f}", payment_method="stripe"),
                        Funds(currency="FET", amount=fet.PRICE_FET, payment_method=fet.METHOD)],
        recipient=wallet,
        deadline_seconds=300,
        reference=quote["ref"],
        description=f"FORGE (TEST MODE): order #{quote['order_id']} {quote['summary']}",
        metadata={"stripe": checkout, "service": "forge_data_api", "fet_network": fet.NETWORK, "mainnet": "false",
                  "provider_agent_wallet": wallet},
    )


def is_paid(checkout_session_id: str) -> bool:
    """The only proof of payment FORGE trusts: Stripe's own record, fetched with our key."""
    s = _stripe().checkout.Session.retrieve(checkout_session_id)
    return getattr(s, "payment_status", None) == "paid"
