"""
stripe_routes.py — Stripe checkout + webhook handler
Handles:
  - POST /stripe/create-checkout  — create checkout session
  - POST /stripe/webhook          — handle Stripe events
  - POST /stripe/portal           — customer portal session
"""
import stripe
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from config import (
    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
    STRIPE_DEGEN_PRICE_ID, STRIPE_OMEGA_PRICE_ID,
    SUPABASE_URL, SUPABASE_SERVICE_KEY,
)

stripe.api_key = STRIPE_SECRET_KEY

router = APIRouter()
import os
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
ORBIT_FROM_EMAIL = "Orbit <noreply@orbit-app.xyz>"
ORBIT_BOT_ID = "orbit-system-bot-0000-000000000000"


async def _get_user_email(user_id: str) -> str | None:
    """Fetch user email from Supabase."""
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"select": "email", "user_id": f"eq.{user_id}", "limit": "1"},
            headers=SUPA_HEADERS,
        )
        rows = r.json()
        return rows[0].get("email") if rows else None


async def _send_upgrade_email(email: str, tier: str):
    """Send welcome email via Resend when user upgrades."""
    if not RESEND_API_KEY or not email:
        return
    tier_name = tier.upper()
    color = "#a78bfa" if tier == "degen" else "#f59e0b"
    perks = (
        "unlimited analyses, full analysis history, unlimited tracker alerts, "
        "Degen badge, and priority queue"
        if tier == "degen"
        else "everything in Degen plus maximum analysis depth, Omega badge, "
             "exclusive profile border, and direct access to Orbit devs"
    )
    html = f"""
    <div style="background:#000;color:#f1f5f9;font-family:monospace;padding:40px;max-width:480px;margin:0 auto;border:1px solid #1a1a1a;">
      <div style="font-size:24px;font-weight:700;color:{color};letter-spacing:4px;margin-bottom:8px;">ORBIT</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:16px;">Welcome to {tier_name}.</div>
      <p style="color:#94a3b8;line-height:1.7;margin-bottom:24px;">
        Your subscription is active. You now have access to {perks}.
      </p>
      <a href="https://orbit-app.xyz/analyze" style="background:{color};color:#000;padding:12px 24px;text-decoration:none;font-weight:700;letter-spacing:1px;display:inline-block;border-radius:4px;">
        START ANALYZING →
      </a>
      <p style="color:#475569;font-size:11px;margin-top:32px;">
        Manage your subscription at orbit-app.xyz/pricing · Cancel anytime.
      </p>
    </div>
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={
                    "from": ORBIT_FROM_EMAIL,
                    "to": [email],
                    "subject": f"Welcome to Orbit {tier_name}",
                    "html": html,
                },
            )
            print(f"[Email] Sent upgrade email to {email[:20]}...")
    except Exception as e:
        print(f"[Email] Failed to send: {e}")


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


async def _set_tier(user_id: str, tier: str, stripe_customer_id: str = None):
    """Update user_reputation.tier in Supabase."""
    payload = {"tier": tier}
    if stripe_customer_id:
        payload["stripe_customer_id"] = stripe_customer_id
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

        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"{origin}/pricing?success=1&tier={tier}",
            cancel_url=f"{origin}/pricing?cancelled=1",
            customer_email=email,
            metadata={"user_id": user_id, "tier": tier},
            subscription_data={"metadata": {"user_id": user_id, "tier": tier}},
        )
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

    # ── Checkout completed → upgrade tier ─────────────────────
    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = session.get("metadata", {}).get("user_id")
        tier    = session.get("metadata", {}).get("tier")
        customer_id = session.get("customer")
        email   = session.get("customer_email") or session.get("customer_details", {}).get("email")

        if not user_id and email:
            user_id = await _get_user_by_email(email)

        if user_id and tier:
            await _set_tier(user_id, tier, customer_id)
            recipient = email or await _get_user_email(user_id)
            if recipient:
                await _send_upgrade_email(recipient, tier)
            await _send_system_dm(
                user_id,
                f"Welcome to Orbit {tier.upper()}. Your subscription is now active. "
                f"Head to /analyze to get started."
            )
        else:
            print(f"[Stripe] checkout.session.completed — missing user_id or tier. meta={session.get('metadata')}")

    # ── Subscription updated (plan change) ────────────────────
    elif event_type == "customer.subscription.updated":
        sub = event["data"]["object"]
        customer_id = sub.get("customer")
        user_id = sub.get("metadata", {}).get("user_id") or await _get_user_by_customer(customer_id)

        if user_id:
            items = sub.get("items", {}).get("data", [])
            price_id = items[0]["price"]["id"] if items else None
            tier = _price_map().get(price_id)
            status = sub.get("status")

            if status in ("active", "trialing") and tier:
                await _set_tier(user_id, tier, customer_id)
            elif status in ("canceled", "unpaid", "past_due"):
                await _set_tier(user_id, "free", customer_id)

    # ── Subscription deleted (cancelled) ──────────────────────
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
            # Don't downgrade immediately on first failure — Stripe will retry

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
    """Owner endpoint — manually assign tier to a user and send welcome email."""
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
        email = await _get_user_email(user_id)
        if email and tier in ("degen", "omega"):
            await _send_upgrade_email(email, tier)
        if tier in ("degen", "omega"):
            await _send_system_dm(
                user_id,
                f"Welcome to Orbit {tier.upper()}. Your subscription is now active. "
                f"Head to /analyze to get started."
            )
        return JSONResponse({"ok": True, "user_id": user_id, "tier": tier, "email_sent": bool(email)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
