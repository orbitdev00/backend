"""
stripe_routes.py — Stripe checkout + webhook handler
Handles:
  - POST /stripe/create-checkout  — create checkout session
  - POST /stripe/webhook          — handle Stripe events
  - POST /stripe/portal           — customer portal session
"""
import os
import stripe
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from config import (
    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
    STRIPE_DEGEN_PRICE_ID, STRIPE_OMEGA_PRICE_ID,
    SUPABASE_URL, SUPABASE_SERVICE_KEY,
)

stripe.api_key = STRIPE_SECRET_KEY

router = APIRouter()
ORBIT_BOT_ID = "orbit-system-bot-0000-000000000000"


async def _send_system_dm(receiver_id: str, body: str):
    """Insert a DM from the Orbit system bot to a user."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/direct_messages",
            headers=SUPA_HEADERS,
            json={
                "sender_id": ORBIT_BOT_ID,
                "receiver_id": receiver_id,
                "body": body,
                "read": False,
            },
        )
        print(f"[DM] System DM sent to {receiver_id[:8]}... status={r.status_code}")


PRICE_TO_TIER = {}  # populated on first use

def _price_map():
    global PRICE_TO_TIER
    if not PRICE_TO_TIER:
        PRICE_TO_TIER = {
            STRIPE_DEGEN_PRICE_ID: "degen",
            STRIPE_OMEGA_PRICE_ID: "omega",
        }
    return PRICE_TO_TIER

SUPA_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


async def _set_tier(user_id: str, tier: str, stripe_customer_id: str = None,
                    stripe_subscription_id: str = None, expires_at: str = None):
    """Update user_reputation.tier (and Stripe fields) in Supabase."""
    payload = {"tier": tier}
    if stripe_customer_id:
        payload["stripe_customer_id"] = stripe_customer_id
    if stripe_subscription_id:
        payload["stripe_subscription_id"] = stripe_subscription_id
    if expires_at:
        payload["subscription_expires_at"] = expires_at
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"user_id": f"eq.{user_id}"},
            json=payload,
            headers=SUPA_HEADERS,
        )
        print(f"[Stripe] Set tier={tier} for {user_id[:8]}... status={r.status_code}")
        return r.status_code in (200, 204)


async def _get_user_by_customer(customer_id: str) -> str | None:
    """Find user_id by stripe_customer_id."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"select": "user_id", "stripe_customer_id": f"eq.{customer_id}", "limit": "1"},
            headers=SUPA_HEADERS,
        )
        rows = r.json()
        return rows[0]["user_id"] if rows else None


async def _get_user_by_email(email: str) -> str | None:
    """Find user_id by email."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"select": "user_id", "email": f"eq.{email}", "limit": "1"},
            headers=SUPA_HEADERS,
        )
        rows = r.json()
        return rows[0]["user_id"] if rows else None


async def _already_processed(event_id: str, event_type: str) -> bool:
    """Idempotency guard. Records the Stripe event id in stripe_events (id is the
    PRIMARY KEY). Returns True if the id was already recorded -- i.e. this is a
    Stripe retry/replay -- so the caller can skip re-processing (e.g. avoid
    sending a duplicate welcome DM or re-running tier logic).

    Fails OPEN: if the dedup table can't be reached we process the event anyway,
    since dropping a real payment event is far worse than a rare duplicate DM.
    """
    if not event_id:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{SUPABASE_URL}/rest/v1/stripe_events",
                json={"id": event_id, "type": event_type},
                headers={**SUPA_HEADERS, "Prefer": "return=minimal"},
            )
        if r.status_code in (200, 201, 204):
            return False   # newly recorded -> first time seeing it
        if r.status_code == 409:
            return True    # duplicate primary key -> already handled
        print(f"[Stripe] idempotency insert status={r.status_code} body={r.text[:200]}")
        return False
    except Exception as e:
        print(f"[Stripe] idempotency check error: {e} -- processing anyway")
        return False


@router.post("/stripe/create-checkout")
async def create_checkout(request: Request):
    """Create a Stripe checkout session for tier upgrade."""
    try:
        body = await request.json()
        tier = body.get("tier")
        user_id = body.get("user_id")
        email = body.get("email")
        origin = request.headers.get("origin", "https://orbit-app.xyz")

        price_id = STRIPE_DEGEN_PRICE_ID if tier == "degen" else STRIPE_OMEGA_PRICE_ID
        if not price_id:
            return JSONResponse({"error": "Invalid tier"}, status_code=400)

        # Re-use existing Stripe customer if they have one
        existing_customer = None
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/user_reputation",
                params={"user_id": f"eq.{user_id}", "select": "stripe_customer_id", "limit": "1"},
                headers=SUPA_HEADERS,
            )
            rows = r.json()
            existing_customer = rows[0].get("stripe_customer_id") if rows else None

        session_params = dict(
            payment_method_types=["card"],
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"{origin}/pricing?success=1&tier={tier}",
            cancel_url=f"{origin}/pricing?cancelled=1",
            metadata={"user_id": user_id, "tier": tier},
            subscription_data={"metadata": {"user_id": user_id, "tier": tier}},
            allow_promotion_codes=True,
        )
        if existing_customer:
            session_params["customer"] = existing_customer
        else:
            session_params["customer_email"] = email

        session = stripe.checkout.Session.create(**session_params)
        return JSONResponse({"url": session.url})
    except Exception as e:
        print(f"[Stripe] Checkout error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError as e:
        print(f"[Stripe] Webhook signature failed: {e}")
        return JSONResponse({"error": "Invalid signature"}, status_code=400)
    except Exception as e:
        print(f"[Stripe] Webhook parse error: {e}")
        return JSONResponse({"error": str(e)}, status_code=400)

    event_type = event["type"]
    print(f"[Stripe] Event: {event_type}")

    # Idempotency: skip events we've already handled (Stripe retries/replays).
    if await _already_processed(event.get("id", ""), event_type):
        print(f"[Stripe] Duplicate event {event.get('id')} ({event_type}) -- skipping")
        return JSONResponse({"received": True, "duplicate": True})

    # ── Checkout completed → upgrade tier ─────────────────────
    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        user_id     = session.get("metadata", {}).get("user_id")
        tier        = session.get("metadata", {}).get("tier")
        customer_id = session.get("customer")
        sub_id      = session.get("subscription")
        email       = session.get("customer_email") or session.get("customer_details", {}).get("email")

        if not user_id and email:
            user_id = await _get_user_by_email(email)

        if user_id and tier:
            expires_at = None
            if sub_id:
                sub = stripe.Subscription.retrieve(sub_id)
                expires_ts = sub.get("current_period_end")
                if expires_ts:
                    expires_at = datetime.fromtimestamp(expires_ts, tz=timezone.utc).isoformat()
                # Resolve tier from actual price in case metadata was stale
                items = sub.get("items", {}).get("data", [])
                if items:
                    tier = _price_map().get(items[0]["price"]["id"], tier)

            await _set_tier(user_id, tier, customer_id, sub_id, expires_at)
            await _send_system_dm(
                user_id,
                f"Welcome to Orbit {tier.upper()}! Your subscription is now active. "
                f"Head to /analyze to get started."
            )
            try:
                from badge_engine import check_subscription_badges
                await check_subscription_badges(user_id, tier)
            except Exception as e:
                print(f"[Badges] subscription check error: {e}")
        else:
            print(f"[Stripe] checkout.session.completed — missing user_id or tier. meta={session.get('metadata')}")

    # ── Subscription updated (plan change or renewal) ─────────
    elif event_type == "customer.subscription.updated":
        sub = event["data"]["object"]
        customer_id = sub.get("customer")
        sub_id      = sub.get("id")
        user_id     = sub.get("metadata", {}).get("user_id") or await _get_user_by_customer(customer_id)

        if user_id:
            items    = sub.get("items", {}).get("data", [])
            price_id = items[0]["price"]["id"] if items else None
            tier     = _price_map().get(price_id)
            status   = sub.get("status")
            expires_ts = sub.get("current_period_end")
            expires_at = datetime.fromtimestamp(expires_ts, tz=timezone.utc).isoformat() if expires_ts else None

            if status in ("active", "trialing") and tier:
                await _set_tier(user_id, tier, customer_id, sub_id, expires_at)
            elif status in ("canceled", "unpaid", "past_due"):
                await _set_tier(user_id, "free", customer_id, expires_at=expires_at)

    # ── Subscription deleted (fully cancelled) ────────────────
    elif event_type == "customer.subscription.deleted":
        sub = event["data"]["object"]
        customer_id = sub.get("customer")
        user_id = sub.get("metadata", {}).get("user_id") or await _get_user_by_customer(customer_id)
        if user_id:
            await _set_tier(user_id, "free")
            await _send_system_dm(
                user_id,
                "Your Orbit subscription has been cancelled. You've been moved to the Free tier. "
                "Resubscribe anytime at orbit-app.xyz/pricing."
            )
            print(f"[Stripe] Downgraded {user_id[:8]}... to free (subscription deleted)")

    # ── Invoice payment failed ─────────────────────────────────
    elif event_type == "invoice.payment_failed":
        invoice = event["data"]["object"]
        customer_id = invoice.get("customer")
        user_id = await _get_user_by_customer(customer_id)
        if user_id:
            print(f"[Stripe] Payment failed for {user_id[:8]}... — keeping tier for now")

    return JSONResponse({"received": True})


@router.post("/stripe/portal")
async def billing_portal(request: Request):
    """Open Stripe customer portal for subscription management."""
    try:
        body = await request.json()
        user_id = body.get("user_id")
        origin = request.headers.get("origin", "https://orbit-app.xyz")

        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/user_reputation",
                params={"select": "stripe_customer_id", "user_id": f"eq.{user_id}", "limit": "1"},
                headers=SUPA_HEADERS,
            )
            rows = r.json()
            customer_id = rows[0].get("stripe_customer_id") if rows else None

        if not customer_id:
            return JSONResponse({"error": "No billing account found"}, status_code=404)

        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{origin}/pricing",
        )
        return JSONResponse({"url": session.url})
    except Exception as e:
        print(f"[Stripe] Portal error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/admin/assign-tier")
async def assign_tier(request: Request):
    """Owner endpoint — manually assign tier to a user."""
    import os
    secret = request.headers.get("x-admin-secret", "")
    if secret != (os.getenv("ADMIN_SECRET") or ""):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    try:
        body = await request.json()
        user_id = body.get("user_id")
        tier = body.get("tier")
        if not user_id or not tier:
            return JSONResponse({"error": "user_id and tier required"}, status_code=400)
        await _set_tier(user_id, tier)
        if tier in ("degen", "omega"):
            await _send_system_dm(
                user_id,
                f"Welcome to Orbit {tier.upper()}. Your subscription is now active. "
                f"Head to /analyze to get started."
            )
        return JSONResponse({"ok": True, "user_id": user_id, "tier": tier})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
