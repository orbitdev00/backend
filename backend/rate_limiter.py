"""
ORBIT Rate Limiter — Supabase-backed
Persists daily usage to user_reputation so Railway restarts don't reset counts.
Free: 5/day | Degen/Omega: unlimited
"""
import time
import httpx
from datetime import datetime, timezone
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

FREE_DAILY_LIMIT = 5

HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# Local tier cache — avoids Supabase hit on every WS connection
_tier_cache: dict = {}
_tier_cache_ts: dict = {}
TIER_TTL = 300  # 5 min


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _get_user_row(user_id: str) -> dict:
    """Fetch tier, daily_analysis_count, daily_reset_date from Supabase."""
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={
                "select": "tier,daily_analysis_count,daily_reset_date",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
            headers=HEADERS,
        )
        rows = r.json()
        return rows[0] if rows else {}


async def _update_count(user_id: str, count: int, date: str):
    """Write updated count to Supabase."""
    async with httpx.AsyncClient(timeout=5) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"user_id": f"eq.{user_id}"},
            json={
                "daily_analysis_count": count,
                "daily_reset_date": date,
            },
            headers={**HEADERS, "Prefer": "return=minimal"},
        )


async def check_rate_limit(user_id: str) -> dict:
    if not user_id:
        return {"allowed": True, "remaining": FREE_DAILY_LIMIT, "limit": FREE_DAILY_LIMIT}

    try:
        row = await _get_user_row(user_id)
    except Exception as e:
        print(f"[RateLimit] Supabase error: {e} — allowing")
        return {"allowed": True, "remaining": FREE_DAILY_LIMIT, "limit": FREE_DAILY_LIMIT}

    tier = row.get("tier", "free")

    # Paid tiers — unlimited
    if tier in ("degen", "omega", "pro", "owner"):
        return {"allowed": True, "remaining": 9999, "limit": 9999, "tier": tier}

    today = _today()
    stored_date = row.get("daily_reset_date", "")
    count = row.get("daily_analysis_count", 0) or 0

    # Reset if new day
    if str(stored_date) != today:
        count = 0

    remaining = FREE_DAILY_LIMIT - count

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
    """Fire-and-forget increment — runs as background task."""
    import asyncio
    asyncio.create_task(_do_consume(user_id))


async def _do_consume(user_id: str):
    try:
        row = await _get_user_row(user_id)
        tier = row.get("tier", "free")
        if tier in ("degen", "omega", "pro", "owner"):
            return  # unlimited — don't write

        today = _today()
        stored_date = row.get("daily_reset_date", "")
        count = row.get("daily_analysis_count", 0) or 0

        if str(stored_date) != today:
            count = 0  # reset for new day

        new_count = count + 1
        await _update_count(user_id, new_count, today)
        print(f"[RateLimit] {user_id[:8]}... used {new_count}/{FREE_DAILY_LIMIT} today (persisted)")
    except Exception as e:
        print(f"[RateLimit] consume error: {e}")


def get_usage(user_id: str) -> dict:
    """Sync wrapper — returns cached or default. Real data fetched async."""
    return {"count": 0, "limit": FREE_DAILY_LIMIT, "remaining": FREE_DAILY_LIMIT}


async def get_usage_async(user_id: str) -> dict:
    try:
        row = await _get_user_row(user_id)
        today = _today()
        count = row.get("daily_analysis_count", 0) or 0
        if str(row.get("daily_reset_date", "")) != today:
            count = 0
        return {
            "count": count,
            "limit": FREE_DAILY_LIMIT,
            "remaining": max(0, FREE_DAILY_LIMIT - count),
        }
    except Exception:
        return {"count": 0, "limit": FREE_DAILY_LIMIT, "remaining": FREE_DAILY_LIMIT}
