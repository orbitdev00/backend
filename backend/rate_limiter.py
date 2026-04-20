"""
ORBIT Rate Limiter
==================
Limits analysis requests per user per day.
Uses in-memory cache with Supabase fallback for persistence across restarts.

Free accounts:  10 analyses per day
Paid accounts:  unlimited (checked via user_reputation.tier)
Trial users:    handled separately by trial_gate.py
"""

import asyncio
import time
from collections import defaultdict
from datetime import datetime, timezone
import httpx
from config import SUPABASE_URL, SUPABASE_ANON_KEY

FREE_DAILY_LIMIT = 10

HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

# In-memory cache: { user_id: { "date": "YYYY-MM-DD", "count": int } }
_cache: dict = defaultdict(lambda: {"date": "", "count": 0})
_paid_cache: dict = {}  # user_id -> bool, cached for 5 min
_paid_cache_ts: dict = {}


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _is_paid(user_id: str) -> bool:
    """Check if user has paid tier — cached for 5 minutes."""
    now = time.time()
    if user_id in _paid_cache and now - _paid_cache_ts.get(user_id, 0) < 300:
        return _paid_cache[user_id]

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/user_reputation",
                params={
                    "select": "tier",
                    "user_id": f"eq.{user_id}",
                    "limit": "1",
                },
                headers=HEADERS,
            )
            rows = r.json()
            tier = rows[0].get("tier", "free") if rows else "free"
            is_paid = tier in ("pro", "owner")
            _paid_cache[user_id] = is_paid
            _paid_cache_ts[user_id] = now
            return is_paid
    except Exception as e:
        print(f"[RateLimit] Tier check failed for {user_id}: {e}")
        return False  # default to free limits on error


async def check_rate_limit(user_id: str) -> dict:
    """
    Returns:
        { "allowed": True, "remaining": int, "limit": int }
        { "allowed": False, "remaining": 0, "limit": int, "error": "rate_limit_exceeded" }
    """
    if not user_id:
        # No user_id = unauthenticated, trial gate handles this separately
        return {"allowed": True, "remaining": FREE_DAILY_LIMIT, "limit": FREE_DAILY_LIMIT}

    # Paid users are unlimited
    if await _is_paid(user_id):
        return {"allowed": True, "remaining": 9999, "limit": 9999, "tier": "paid"}

    today = _today()
    entry = _cache[user_id]

    # Reset count if it's a new day
    if entry["date"] != today:
        entry["date"] = today
        entry["count"] = 0

    remaining = FREE_DAILY_LIMIT - entry["count"]

    if remaining <= 0:
        return {
            "allowed": False,
            "remaining": 0,
            "limit": FREE_DAILY_LIMIT,
            "error": "rate_limit_exceeded",
            "message": f"Daily limit of {FREE_DAILY_LIMIT} analyses reached. Resets at midnight UTC.",
        }

    return {
        "allowed": True,
        "remaining": remaining,
        "limit": FREE_DAILY_LIMIT,
        "tier": "free",
    }


def consume_rate_limit(user_id: str):
    """Increment counter after a successful analysis."""
    if not user_id:
        return
    today = _today()
    entry = _cache[user_id]
    if entry["date"] != today:
        entry["date"] = today
        entry["count"] = 0
    entry["count"] += 1
    print(f"[RateLimit] {user_id[:8]}... used {entry['count']}/{FREE_DAILY_LIMIT} today")


def get_usage(user_id: str) -> dict:
    """Return current usage for a user."""
    if not user_id:
        return {"count": 0, "limit": FREE_DAILY_LIMIT, "remaining": FREE_DAILY_LIMIT}
    today = _today()
    entry = _cache[user_id]
    if entry["date"] != today:
        return {"count": 0, "limit": FREE_DAILY_LIMIT, "remaining": FREE_DAILY_LIMIT}
    count = entry["count"]
    return {
        "count": count,
        "limit": FREE_DAILY_LIMIT,
        "remaining": max(0, FREE_DAILY_LIMIT - count),
    }
