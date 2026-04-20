"""
ORBIT Stripe Integration
========================
Handles subscription creation, webhooks, and tier management.
"""

import os
import stripe
import httpx
from datetime import datetime, timezone
from fastapi import Request
from fastapi.responses import JSONResponse
from config import SUPABASE_URL, SUPABASE_ANON_KEY

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET  = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
DEGEN_PRICE_ID  = os.environ.get("STRIPE_DEGEN_PRICE_ID", "")
OMEGA_PRICE_ID  = os.environ.get("STRIPE_OMEGA_PRICE_ID", "")

PRICE_TO_TIER = {}  # populated after env vars load

def _get_price_map():
    return {
        DEGEN_PRICE_ID: "degen",
        OMEGA_PRICE_ID: "omega",
    }

HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}
SERVICE_HEADERS = {
    **HEADERS,
    "Authorization": f"Bearer {os.environ.get('SUPABASE_SERVICE_KEY', SUPABASE_ANON_KEY)}",
}


async def _get_user_by_stripe_customer(customer_id: str) -> str | None:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"stripe_customer_id": f"eq.{customer_id}", "select": "user_id", "limit": "1"},
            headers=SERVICE_HEADERS,
        )
        rows = r.json()
        return rows[0]["user_id"] if rows else None


async def _set_tier(user_id: str, tier: str, stripe_customer_id: str = None,
                    stripe_subscription_id: str = None, expires_at: str = None):
    payload = {"tier": tier}
    if stripe_customer_id:
        payload["stripe_customer_id"] = stripe_customer_id
    if stripe_subscription_id:
        payload["stripe_subscription_id"] = stripe_subscription_id
    if expires_at:
        payload["subscription_expires_at"] = expires_at

    async with httpx.AsyncClient(timeout=10) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"user_id": f"eq.{user_id}"},
            headers=SERVICE_HEADERS,
            json=payload,
        )
    print(f"[Stripe] Set tier={tier} for user {user_id[:8]}...")


async def create_checkout_session(user_id: str, email: str, tier: str, success_url: str, cancel_url: str):
    """Create a Stripe Checkout session for the given tier."""
    price_id = DEGEN_PRICE_ID if tier == "degen" else OMEGA_PRICE_ID
    if not price_id:
        return JSONResponse({"error": "Price ID not configured"}, status_code=500)

    # Check if user already has a Stripe customer ID
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"user_id": f"eq.{user_id}", "select": "stripe_customer_id", "limit": "1"},
            headers=SERVICE_HEADERS,
        )
        rows = r.json()
        existing_customer = rows[0].get("stripe_customer_id") if rows else None

    session_params = {
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": success_url + "?payment=success&tier=" + tier,
        "cancel_url": cancel_url + "?payment=cancelled",
        "metadata": {"user_id": user_id},
        "subscription_data": {"metadata": {"user_id": user_id}},
        "allow_promotion_codes": True,  # enables discount codes at checkout
    }

    if existing_customer:
        session_params["customer"] = existing_customer
    else:
        session_params["customer_email"] = email

    session = stripe.checkout.Session.create(**session_params)
    return JSONResponse({"url": session.url})


async def create_billing_portal(user_id: str, return_url: str):
    """Open Stripe billing portal for managing/cancelling subscription."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"user_id": f"eq.{user_id}", "select": "stripe_customer_id", "limit": "1"},
            headers=SERVICE_HEADERS,
        )
        rows = r.json()
        customer_id = rows[0].get("stripe_customer_id") if rows else None

    if not customer_id:
        return JSONResponse({"error": "No billing account found"}, status_code=404)

    portal = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return JSONResponse({"url": portal.url})


async def handle_webhook(request: Request):
    """Process Stripe webhook events."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        return JSONResponse({"error": "Invalid signature"}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    price_map = _get_price_map()
    etype = event["type"]
    data  = event["data"]["object"]

    print(f"[Stripe Webhook] {etype}")

    if etype == "checkout.session.completed":
        user_id     = data.get("metadata", {}).get("user_id")
        customer_id = data.get("customer")
        sub_id      = data.get("subscription")
        if not user_id or not sub_id:
            return JSONResponse({"received": True})

        # Get tier from subscription price
        sub = stripe.Subscription.retrieve(sub_id)
        price_id = sub["items"]["data"][0]["price"]["id"]
        tier = price_map.get(price_id, "degen")

        # Expiry = current period end
        expires_ts = sub["current_period_end"]
        expires_at = datetime.fromtimestamp(expires_ts, tz=timezone.utc).isoformat()

        await _set_tier(user_id, tier, customer_id, sub_id, expires_at)

    elif etype == "customer.subscription.updated":
        customer_id = data.get("customer")
        user_id = await _get_user_by_stripe_customer(customer_id)
        if not user_id:
            return JSONResponse({"received": True})

        price_id   = data["items"]["data"][0]["price"]["id"]
        tier       = price_map.get(price_id, "degen")
        status     = data.get("status")
        expires_ts = data.get("current_period_end")
        expires_at = datetime.fromtimestamp(expires_ts, tz=timezone.utc).isoformat() if expires_ts else None

        # If cancelled but still in period, keep tier until expiry
        if status == "canceled":
            # Keep existing tier, just update expiry — nightly job will downgrade
            await _set_tier(user_id, tier, expires_at=expires_at)
        else:
            await _set_tier(user_id, tier, expires_at=expires_at)

    elif etype == "customer.subscription.deleted":
        customer_id = data.get("customer")
        user_id = await _get_user_by_stripe_customer(customer_id)
        if not user_id:
            return JSONResponse({"received": True})
        # Subscription fully deleted — drop to free
        await _set_tier(user_id, "free")

    return JSONResponse({"received": True})
