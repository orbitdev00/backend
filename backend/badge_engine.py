"""
badge_engine.py — Orbit Badge Award Engine
All auto-trigger checks. Called after relevant actions.
Awards are idempotent — safe to call multiple times.
"""

from datetime import datetime, timezone, timedelta
from supabase import Client
from badges import BADGES, EQUIP_LIMITS


async def award_badge(supabase: Client, user_id: str, badge_id: str) -> bool:
    """
    Award a badge to a user. Idempotent — won't duplicate.
    Returns True if newly awarded, False if already had it.
    """
    if badge_id not in BADGES:
        return False

    # Check if already owned
    existing = supabase.table("user_badges").select("id").eq("user_id", user_id).eq("badge_id", badge_id).execute()
    if existing.data:
        return False

    supabase.table("user_badges").insert({
        "user_id": user_id,
        "badge_id": badge_id,
        "awarded_at": datetime.now(timezone.utc).isoformat(),
        "equipped": False,
    }).execute()

    return True


async def check_analysis_badges(supabase: Client, user_id: str, snapshot: dict, coin_age_seconds: float | None = None):
    """
    Run after every analysis. Checks:
    - first_analysis, degen_starter, analyst, signal_machine
    - early_bird (coin < 5 min old)
    - on_a_run (3 analyses in 1 min)
    - night_owl (2am-5am UTC — caller should convert to user local if needed)
    - grinder (7-day streak)
    - purity_seeker (10 analyses purity > 80)
    - rug_survivor (outcome = rug — called separately from record_outcome)
    - lucky ($1M MC — called separately from record_outcome)
    """
    # Count total analyses
    count_res = supabase.table("predictions").select("id", count="exact").eq("user_id", user_id).execute()
    total = count_res.count or 0

    milestones = {1: "first_analysis", 10: "degen_starter", 50: "analyst", 200: "signal_machine"}
    for threshold, badge_id in milestones.items():
        if total >= threshold:
            await award_badge(supabase, user_id, badge_id)

    # Early bird — coin age passed from snapshot (pairCreatedAt)
    if coin_age_seconds is not None and coin_age_seconds < 300:
        await award_badge(supabase, user_id, "early_bird")

    # Night owl — check server UTC hour
    now_utc = datetime.now(timezone.utc)
    if 2 <= now_utc.hour < 5:
        await award_badge(supabase, user_id, "night_owl")

    # On a run — 3 analyses within last 60 seconds
    one_min_ago = (now_utc - timedelta(seconds=60)).isoformat()
    recent_res = supabase.table("predictions").select("id", count="exact").eq("user_id", user_id).gte("snapshot_timestamp", one_min_ago).execute()
    if (recent_res.count or 0) >= 3:
        await award_badge(supabase, user_id, "on_a_run")

    # Grinder — analyses on 7 consecutive distinct days
    seven_days_ago = (now_utc - timedelta(days=7)).isoformat()
    streak_res = supabase.table("predictions").select("snapshot_timestamp").eq("user_id", user_id).gte("snapshot_timestamp", seven_days_ago).execute()
    if streak_res.data:
        days = set(r["snapshot_timestamp"][:10] for r in streak_res.data)
        if len(days) >= 7:
            await award_badge(supabase, user_id, "grinder")

    # Purity seeker — 10 analyses with purity > 80
    # purity score lives in snapshot as snapshot.purity_score — stored in predictions.flags or bullish_flags
    # If purity_score is a top-level field on predictions, filter directly
    purity_res = supabase.table("predictions").select("id", count="exact").eq("user_id", user_id).gte("purity_score", 80).execute()
    if (purity_res.count or 0) >= 10:
        await award_badge(supabase, user_id, "purity_seeker")


async def check_outcome_badges(supabase: Client, user_id: str, mint: str, actual_peak_mc: float, was_rug: bool):
    """
    Called from POST /outcome/{mint} after recording actual outcome.
    Checks: rug_survivor, lucky, unlucky
    """
    if was_rug:
        await award_badge(supabase, user_id, "rug_survivor")

    if actual_peak_mc >= 1_000_000:
        await award_badge(supabase, user_id, "lucky")

    # Unlucky — TODO: enable once tracker_items table exists in Supabase
    # rug_count_res = supabase.table("tracker_items").select("id", count="exact").eq("user_id", user_id).eq("is_rug", True).execute()
    # if (rug_count_res.count or 0) >= 5:
    #     await award_badge(supabase, user_id, "unlucky")


async def check_community_badges(supabase: Client, user_id: str):
    """
    Called after: follow, upvote, thread creation, reply.
    Checks: social_butterfly, influencer, helpful, forum_legend, thread_starter, conversationalist
    """
    # Followers count
    # NOTE: table is user_follows — verify column name matches (following_id assumed)
    followers_res = supabase.table("user_follows").select("id", count="exact").eq("following_id", user_id).execute()
    followers = followers_res.count or 0
    if followers >= 10:
        await award_badge(supabase, user_id, "social_butterfly")
    if followers >= 50:
        await award_badge(supabase, user_id, "influencer")

    # Upvotes across all posts
    upvotes_res = supabase.table("forum_posts").select("upvotes").eq("author_id", user_id).execute()
    total_upvotes = sum(r.get("upvotes", 0) for r in (upvotes_res.data or []))
    if total_upvotes >= 50:
        await award_badge(supabase, user_id, "helpful")
    if total_upvotes >= 200:
        await award_badge(supabase, user_id, "forum_legend")

    # Thread count
    threads_res = supabase.table("forum_threads").select("id", count="exact").eq("author_id", user_id).execute()
    if (threads_res.count or 0) >= 10:
        await award_badge(supabase, user_id, "thread_starter")

    # Reply count
    replies_res = supabase.table("forum_posts").select("id", count="exact").eq("author_id", user_id).execute()
    if (replies_res.count or 0) >= 25:
        await award_badge(supabase, user_id, "conversationalist")


async def check_account_badges(supabase: Client, user_id: str, created_at: str):
    """
    Called on login or profile load.
    Checks: veteran (30 days), og (first 100 users)
    """
    created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    if (now - created).days >= 30:
        await award_badge(supabase, user_id, "veteran")

    # OG — check if user_id is within first 100 users by creation order
    og_res = supabase.table("user_reputation").select("user_id").order("created_at", desc=False).limit(100).execute()
    og_ids = [r["user_id"] for r in (og_res.data or [])]
    if user_id in og_ids:
        await award_badge(supabase, user_id, "og")


async def check_pnl_badges(supabase: Client, user_id: str):
    """
    Called after PnL sync.
    Checks: in_the_green, whale
    """
    pnl_res = supabase.table("user_reputation").select("total_pnl_pct").eq("user_id", user_id).single().execute()
    pnl = pnl_res.data.get("total_pnl_pct", 0) if pnl_res.data else 0

    if pnl > 0:
        await award_badge(supabase, user_id, "in_the_green")

    # Whale — top 10 on leaderboard by total_pnl_pct
    top10_res = supabase.table("user_reputation").select("user_id").order("total_pnl_pct", desc=True).limit(10).execute()
    top10_ids = [r["user_id"] for r in (top10_res.data or [])]
    if user_id in top10_ids:
        await award_badge(supabase, user_id, "whale")


async def check_subscription_badges(supabase: Client, user_id: str, tier: str):
    """
    Called from Stripe webhook after tier change.
    Checks: degen_member, omega_member, founding_degen, founding_omega
    """
    if tier == "degen":
        await award_badge(supabase, user_id, "degen_member")
        # Founding degen — count existing degen subscribers
        degen_count_res = supabase.table("user_reputation").select("user_id", count="exact").eq("tier", "degen").execute()
        if (degen_count_res.count or 0) <= 100:
            await award_badge(supabase, user_id, "founding_degen")

    elif tier == "omega":
        await award_badge(supabase, user_id, "omega_member")
        omega_count_res = supabase.table("user_reputation").select("user_id", count="exact").eq("tier", "omega").execute()
        if (omega_count_res.count or 0) <= 100:
            await award_badge(supabase, user_id, "founding_omega")


async def grant_badge_manual(supabase: Client, granter_id: str, target_user_id: str, badge_id: str, granter_role: str) -> dict:
    """
    Manual badge grant (owner or mod).
    Manual badges: owner, mod, beta_tester, orbit_dev, advisor, special, cupsey_warning
    Mods can only grant: special
    Owner can grant: all manual badges
    """
    MANUAL_BADGES = {"owner", "mod", "beta_tester", "orbit_dev", "advisor", "special", "cupsey_warning"}
    MOD_GRANTABLE = {"special"}

    if badge_id not in MANUAL_BADGES:
        return {"error": "Badge is not manually grantable"}

    if granter_role == "mod" and badge_id not in MOD_GRANTABLE:
        return {"error": "Mods can only grant the Special badge"}

    if granter_role not in ("mod", "owner"):
        return {"error": "Unauthorized"}

    awarded = await award_badge(supabase, target_user_id, badge_id)
    return {"awarded": awarded, "badge_id": badge_id}


async def equip_badge(supabase: Client, user_id: str, badge_id: str, tier: str) -> dict:
    """
    Equip a badge to show on profile. Respects EQUIP_LIMITS per tier.
    """
    limit = EQUIP_LIMITS.get(tier, 1)

    # Verify user owns badge
    owned = supabase.table("user_badges").select("id").eq("user_id", user_id).eq("badge_id", badge_id).execute()
    if not owned.data:
        return {"error": "Badge not owned"}

    # Count currently equipped
    equipped_res = supabase.table("user_badges").select("id", count="exact").eq("user_id", user_id).eq("equipped", True).execute()
    equipped_count = equipped_res.count or 0

    if equipped_count >= limit:
        return {"error": f"Equip limit reached ({limit} for {tier} tier)"}

    supabase.table("user_badges").update({"equipped": True}).eq("user_id", user_id).eq("badge_id", badge_id).execute()
    return {"equipped": True, "badge_id": badge_id}


async def unequip_badge(supabase: Client, user_id: str, badge_id: str) -> dict:
    supabase.table("user_badges").update({"equipped": False}).eq("user_id", user_id).eq("badge_id", badge_id).execute()
    return {"equipped": False, "badge_id": badge_id}
