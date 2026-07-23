"""
admin_routes.py — Owner-only privileged actions.

Every action requires the CALLER's Supabase JWT (Authorization: Bearer <token>)
to belong to the owner — either role='owner' in user_reputation, or the
hardcoded owner email. There is no client-shared secret: the previous flow
sent ADMIN_SECRET via VITE_ADMIN_SECRET, which Vite inlines into the public
browser bundle (anyone could read it and grant themselves omega).

Writes use the service key so they bypass the protect_reputation_columns
trigger added in supabase_rls.sql.
"""
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
from security import is_valid_uuid, ip_rate_ok

admin_router = APIRouter(prefix="/admin", tags=["admin"])

OWNER_EMAIL = "orbitdev00@gmail.com"

_SERVICE_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

VALID_TIERS = {"free", "degen", "omega"}
VALID_ROLES = {"member", "mod", "banned"}


async def _verify_owner(request: Request) -> bool:
    """Return True only if the request's JWT belongs to the owner."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token = auth[7:]
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
            )
            if r.status_code != 200:
                return False
            u = r.json()
        uid = u.get("id")
        email = u.get("email", "")
        if not uid or not is_valid_uuid(uid):
            return False
        if email == OWNER_EMAIL:
            return True
        # Confirm role from DB (service key) so a spoofed JWT email can't pass.
        async with httpx.AsyncClient(timeout=5) as client:
            rr = await client.get(
                f"{SUPABASE_URL}/rest/v1/user_reputation",
                params={"user_id": f"eq.{uid}", "select": "role,email"},
                headers={
                    "apikey": SUPABASE_SERVICE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                },
            )
            rows = rr.json() if rr.status_code == 200 else []
        if rows and (rows[0].get("role") == "owner" or rows[0].get("email") == OWNER_EMAIL):
            return True
    except Exception as e:
        print(f"[Admin] owner verify error: {e}")
    return False


async def _send_system_dm(receiver_id: str, body: str):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{SUPABASE_URL}/rest/v1/direct_messages",
                headers=_SERVICE_HEADERS,
                json={
                    "sender_id": "orbit-system-bot-0000-000000000000",
                    "receiver_id": receiver_id,
                    "body": body,
                    "read": False,
                },
            )
    except Exception as e:
        print(f"[Admin] system DM error: {e}")


@admin_router.post("/user-action")
async def user_action(request: Request):
    """Owner-only: change a user's tier/role or delete their reputation row."""
    ip = request.client.host if request.client else "unknown"
    if not ip_rate_ok(ip, limit=30, window=60):
        return JSONResponse({"error": "Rate limit exceeded"}, status_code=429)

    if not await _verify_owner(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid body"}, status_code=400)

    action = body.get("action")
    target = body.get("user_id")
    if not target or not is_valid_uuid(target):
        return JSONResponse({"error": "valid user_id required"}, status_code=400)

    if action == "set_tier":
        tier = body.get("tier")
        if tier not in VALID_TIERS:
            return JSONResponse({"error": "invalid tier"}, status_code=400)
        expires = None
        if tier in ("degen", "omega"):
            expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        payload = {"tier": tier, "subscription_expires_at": expires}
    elif action == "set_role":
        role = body.get("role")
        if role not in VALID_ROLES:
            return JSONResponse({"error": "invalid role"}, status_code=400)
        payload = {"role": role}
    elif action == "delete":
        async with httpx.AsyncClient(timeout=10) as client:
            await client.delete(
                f"{SUPABASE_URL}/rest/v1/user_reputation",
                params={"user_id": f"eq.{target}"},
                headers=_SERVICE_HEADERS,
            )
        return JSONResponse({"ok": True, "action": "delete", "user_id": target})
    else:
        return JSONResponse({"error": "invalid action"}, status_code=400)

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"user_id": f"eq.{target}"},
            json=payload,
            headers=_SERVICE_HEADERS,
        )
    if r.status_code not in (200, 204):
        print(f"[Admin] user-action patch failed status={r.status_code} body={r.text[:200]}")
        return JSONResponse({"error": "update failed"}, status_code=500)

    if action == "set_tier" and body.get("tier") in ("degen", "omega"):
        await _send_system_dm(
            target,
            f"Welcome to Orbit {body['tier'].upper()}! Your subscription is now active. "
            f"Head to /analyze to get started.",
        )

    return JSONResponse({"ok": True, "action": action, "user_id": target})
