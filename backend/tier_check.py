"""
ORBIT Tier Checker
==================
Fast in-memory tier cache for use in analyze endpoints.
Avoids hitting Supabase on every request.
"""

import time
import httpx
import os
from config import SUPABASE_URL, SUPABASE_ANON_KEY
from datetime import datetime, timezone

_cache: dict = {}  # user_id -> { tier, expires_at, cached_at }
CACHE_TTL = 300    # 5 minutes

SERVICE_HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {os.environ.get('SUPABASE_SERVICE_KEY', SUPABASE_ANON_KEY)}",
    "Content-Type": "application/json",
}


async def get_tier(user_id: str) -> str:
    """Returns user tier: 'free', 'degen', or 'omega'."""
    if not user_id:
        return "guest"

    now = time.time()
    cached = _cache.get(user_id)
    if cached and now - cached["cached_at"] < CACHE_TTL:
        return cached["tier"]

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/user_reputation",
                params={"user_id": f"eq.{user_id}", "select": "tier,subscription_expires_at", "limit": "1"},
                headers=SERVICE_HEADERS,
            )
            rows = r.json()
            if not rows:
                tier = "free"
            else:
                row = rows[0]
                tier = row.get("tier") or "free"
                # Check if subscription has expired
                expires_at = row.get("subscription_expires_at")
                if expires_at and tier in ("degen", "omega"):
                    try:
                        exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                        if exp < datetime.now(timezone.utc):
                            tier = "free"
                            # Update Supabase too
                            await client.patch(
                                f"{SUPABASE_URL}/rest/v1/user_reputation",
                                params={"user_id": f"eq.{user_id}"},
                                headers={**SERVICE_HEADERS, "Prefer": "return=minimal"},
                                json={"tier": "free"},
                            )
                    except Exception:
                        pass

            _cache[user_id] = {"tier": tier, "cached_at": now}
            return tier
    except Exception as e:
        print(f"[TierCheck] Failed for {user_id[:8]}: {e}")
        return _cache.get(user_id, {}).get("tier", "free")


def invalidate(user_id: str):
    """Call this after a tier change to force refresh."""
    _cache.pop(user_id, None)


TIER_LIMITS = {
    "guest":  {"analyses_per_day": 1,  "history_days": 0,  "watchlist": 0,   "paid": False},
    "free":   {"analyses_per_day": 3,  "history_days": 0,  "watchlist": 3,   "paid": False},
    "degen":  {"analyses_per_day": -1, "history_days": -1, "watchlist": -1,  "paid": True},
    "omega":  {"analyses_per_day": -1, "history_days": -1, "watchlist": -1,  "paid": True},
}  # -1 = unlimited


def get_limits(tier: str) -> dict:
    return TIER_LIMITS.get(tier, TIER_LIMITS["free"])
