"""
badge_engine.py — Orbit Badge Award Engine
Uses httpx directly (same pattern as supabase_logger.py).
Service key bypasses RLS for all writes.
Awards are idempotent — safe to call multiple times.
"""

import httpx
from datetime import datetime, timezone, timedelta
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
from badges import BADGES, EQUIP_LIMITS

KEY = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY

HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

HEADERS_MINIMAL = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


async def _get(path: str, params: dict = None) -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/{path}", params=params, headers=HEADERS)
        if resp.status_code == 200:
            return resp.json()
        return []


async def _post(path: str, data: dict) -> bool:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{SUPABASE_URL}/rest/v1/{path}", json=data, headers=HEADERS_MINIMAL)
        return resp.status_code in (200, 201)


async def _count(path: str, params: dict) -> int:
    count_headers = {**HEADERS, "Prefer": "count=exact"}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/{path}", params={**params, "select": "id"}, headers=count_headers)
        if resp.status_code == 200:
            return len(resp.json())
        return 0


async def award_badge(user_id: str, badge_id: str) -> bool:
    """
    Award a badge to a user. Idempotent.
    Returns True if newly awarded, False if already had it.
    """
    if badge_id not in BADGES:
        return False

    # Check if already owned
    existing = await _get("user_badges", {"user_id": f"eq.{user_id}", "badge_id": f"eq.{badge_id}"})
    if existing:
        return False

    success = await _post("user_badges", {
        "user_id": user_id,
        "badge_id": badge_id,
        "awarded_at": datetime.now(timezone.utc).isoformat(),
        "equipped": False,
    })
    if success:
        print(f"[Badges] Awarded '{badge_id}' to {user_id[:8]}...")
    return success


async def check_analysis_badges(user_id: str, snapshot: dict, coin_age_seconds: float = None):
    """Called after every analysis."""
    try:
        # Total analysis count
        rows = await _get("predictions", {"user_id": f"eq.{user_id}", "select": "id"})
        total = len(rows)

        milestones = {1: "first_analysis", 10: "degen_starter", 50: "analyst", 200: "signal_machine"}
        for threshold, badge_id in milestones.items():
            if total >= threshold:
                await award_badge(user_id, badge_id)

        # Early bird — coin under 5 minutes old
        if coin_age_seconds is not None and coin_age_seconds < 300:
            await award_badge(user_id, "early_bird")

        # Night owl — 2am-5am UTC
        now_utc = datetime.now(timezone.utc)
        if 2 <= now_utc.hour < 5:
            await award_badge(user_id, "night_owl")

        # On a run — 3 analyses within last 60 seconds
        one_min_ago = (now_utc - timedelta(seconds=60)).isoformat()
        recent = await _get("predictions", {
            "user_id": f"eq.{user_id}",
            "snapshot_timestamp": f"gte.{one_min_ago}",
            "select": "id",
        })
        if len(recent) >= 3:
            await award_badge(user_id, "on_a_run")

        # Grinder — analyses on 7 distinct days in last 7 days
        seven_days_ago = (now_utc - timedelta(days=7)).isoformat()
        streak_rows = await _get("predictions", {
            "user_id": f"eq.{user_id}",
            "snapshot_timestamp": f"gte.{seven_days_ago}",
            "select": "snapshot_timestamp",
        })
        days = set(r["snapshot_timestamp"][:10] for r in streak_rows if r.get("snapshot_timestamp"))
        if len(days) >= 7:
            await award_badge(user_id, "grinder")

        # Purity seeker — 10 analyses with purity_score > 80
        purity_rows = await _get("predictions", {
            "user_id": f"eq.{user_id}",
            "purity_score": "gte.80",
            "select": "id",
        })
        if len(purity_rows) >= 10:
            await award_badge(user_id, "purity_seeker")

    except Exception as e:
        print(f"[Badges] check_analysis_badges error: {e}")


async def check_outcome_badges(user_id: str, mint: str, actual_peak_mc: float, was_rug: bool):
    """Called after outcome is recorded."""
    try:
        if was_rug:
            await award_badge(user_id, "rug_survivor")
        if actual_peak_mc >= 1_000_000:
            await award_badge(user_id, "lucky")
    except Exception as e:
        print(f"[Badges] check_outcome_badges error: {e}")


async def check_community_badges(user_id: str):
    """Called after follow, upvote, thread creation, reply."""
    try:
        # Followers
        followers = await _get("user_follows", {"following_id": f"eq.{user_id}", "select": "id"})
        if len(followers) >= 10:
            await award_badge(user_id, "social_butterfly")
        if len(followers) >= 50:
            await award_badge(user_id, "influencer")

        # Upvotes across posts
        posts = await _get("forum_posts", {"author_id": f"eq.{user_id}", "select": "upvotes"})
        total_upvotes = sum(r.get("upvotes", 0) for r in posts)
        if total_upvotes >= 50:
            await award_badge(user_id, "helpful")
        if total_upvotes >= 200:
            await award_badge(user_id, "forum_legend")

        # Thread count
        threads = await _get("forum_threads", {"author_id": f"eq.{user_id}", "select": "id"})
        if len(threads) >= 10:
            await award_badge(user_id, "thread_starter")

        # Reply count
        replies = await _get("forum_posts", {"author_id": f"eq.{user_id}", "select": "id"})
        if len(replies) >= 25:
            await award_badge(user_id, "conversationalist")

    except Exception as e:
        print(f"[Badges] check_community_badges error: {e}")


async def check_account_badges(user_id: str, created_at: str):
    """Called on login or profile load."""
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if (now - created).days >= 30:
            await award_badge(user_id, "veteran")

        # OG — first 100 users by created_at
        og_rows = await _get("user_reputation", {"select": "user_id", "order": "created_at.asc", "limit": "100"})
        og_ids = [r["user_id"] for r in og_rows]
        if user_id in og_ids:
            await award_badge(user_id, "og")

    except Exception as e:
        print(f"[Badges] check_account_badges error: {e}")


async def check_pnl_badges(user_id: str):
    """Called after PnL sync."""
    try:
        rows = await _get("user_reputation", {"user_id": f"eq.{user_id}", "select": "total_pnl_pct"})
        if not rows:
            return
        pnl = rows[0].get("total_pnl_pct", 0) or 0

        if pnl > 0:
            await award_badge(user_id, "in_the_green")

        # Whale — top 10 by PnL
        top10 = await _get("user_reputation", {"select": "user_id", "order": "total_pnl_pct.desc", "limit": "10"})
        if any(r["user_id"] == user_id for r in top10):
            await award_badge(user_id, "whale")

    except Exception as e:
        print(f"[Badges] check_pnl_badges error: {e}")


async def check_subscription_badges(user_id: str, tier: str):
    """Called from Stripe webhook after tier change."""
    try:
        if tier == "degen":
            await award_badge(user_id, "degen_member")
            degen_count = await _get("user_reputation", {"tier": "eq.degen", "select": "user_id"})
            if len(degen_count) <= 100:
                await award_badge(user_id, "founding_degen")
        elif tier == "omega":
            await award_badge(user_id, "omega_member")
            omega_count = await _get("user_reputation", {"tier": "eq.omega", "select": "user_id"})
            if len(omega_count) <= 100:
                await award_badge(user_id, "founding_omega")
    except Exception as e:
        print(f"[Badges] check_subscription_badges error: {e}")


async def grant_badge_manual(granter_id: str, target_user_id: str, badge_id: str, granter_role: str) -> dict:
    """Manual badge grant for owner/mod."""
    MANUAL_BADGES = {"owner", "mod", "beta_tester", "orbit_dev", "advisor", "special", "cupsey_warning"}
    MOD_GRANTABLE = {"special"}

    if badge_id not in MANUAL_BADGES:
        return {"error": "Badge is not manually grantable"}
    if granter_role == "mod" and badge_id not in MOD_GRANTABLE:
        return {"error": "Mods can only grant the Special badge"}
    if granter_role not in ("mod", "owner"):
        return {"error": "Unauthorized"}

    # Verify granter role from DB
    rows = await _get("user_reputation", {"user_id": f"eq.{granter_id}", "select": "role"})
    if not rows:
        return {"error": "Granter not found"}
    actual_role = rows[0].get("role")
    if actual_role not in ("mod", "owner"):
        return {"error": "Unauthorized"}

    awarded = await award_badge(target_user_id, badge_id)
    return {"awarded": awarded, "badge_id": badge_id}


async def equip_badge_fn(user_id: str, badge_id: str, tier: str) -> dict:
    limit = EQUIP_LIMITS.get(tier, 1)

    owned = await _get("user_badges", {"user_id": f"eq.{user_id}", "badge_id": f"eq.{badge_id}"})
    if not owned:
        return {"error": "Badge not owned"}

    equipped = await _get("user_badges", {"user_id": f"eq.{user_id}", "equipped": "eq.true"})
    if len(equipped) >= limit:
        return {"error": f"Equip limit reached ({limit} for {tier} tier)"}

    async with httpx.AsyncClient(timeout=10) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/user_badges",
            params={"user_id": f"eq.{user_id}", "badge_id": f"eq.{badge_id}"},
            json={"equipped": True},
            headers=HEADERS_MINIMAL,
        )
    return {"equipped": True, "badge_id": badge_id}


async def unequip_badge_fn(user_id: str, badge_id: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/user_badges",
            params={"user_id": f"eq.{user_id}", "badge_id": f"eq.{badge_id}"},
            json={"equipped": False},
            headers=HEADERS_MINIMAL,
        )
    return {"equipped": False, "badge_id": badge_id}
