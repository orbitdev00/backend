"""
badge_routes.py — Badge API Routes
Mount these in main.py: app.include_router(badge_router)
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY
from badges import BADGES, BADGE_IDS, EQUIP_LIMITS
from badge_engine import grant_badge_manual, equip_badge, unequip_badge

badge_router = APIRouter(prefix="/badges", tags=["badges"])

def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


@badge_router.get("/all")
def get_all_badges():
    """Return full badge catalog (definitions only, no user data)."""
    return {"badges": list(BADGES.values())}


@badge_router.get("/user/{user_id}")
def get_user_badges(user_id: str):
    """Return all badges a user owns, with equipped status."""
    supabase = get_supabase()
    res = supabase.table("user_badges").select("badge_id, equipped, awarded_at").eq("user_id", user_id).execute()
    owned = res.data or []

    enriched = []
    for row in owned:
        badge_def = BADGES.get(row["badge_id"])
        if badge_def:
            enriched.append({**badge_def, "equipped": row["equipped"], "awarded_at": row["awarded_at"]})

    return {"user_id": user_id, "badges": enriched}


@badge_router.get("/user/{user_id}/equipped")
def get_equipped_badges(user_id: str):
    """Return only equipped badges (shown on profile/posts)."""
    supabase = get_supabase()
    res = supabase.table("user_badges").select("badge_id, awarded_at").eq("user_id", user_id).eq("equipped", True).execute()
    equipped = []
    for row in (res.data or []):
        badge_def = BADGES.get(row["badge_id"])
        if badge_def:
            equipped.append({**badge_def, "awarded_at": row["awarded_at"]})
    return {"user_id": user_id, "equipped": equipped}


class EquipRequest(BaseModel):
    user_id: str
    badge_id: str
    tier: str


@badge_router.post("/equip")
async def equip(req: EquipRequest):
    supabase = get_supabase()
    result = await equip_badge(supabase, req.user_id, req.badge_id, req.tier)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@badge_router.post("/unequip")
async def unequip(req: EquipRequest):
    supabase = get_supabase()
    result = await unequip_badge(supabase, req.user_id, req.badge_id)
    return result


class GrantRequest(BaseModel):
    granter_id: str
    target_user_id: str
    badge_id: str
    granter_role: str  # 'mod' or 'owner'


@badge_router.post("/grant")
async def grant(req: GrantRequest):
    supabase = get_supabase()

    # Verify granter role from DB (don't trust client)
    granter_res = supabase.table("user_reputation").select("role").eq("user_id", req.granter_id).single().execute()
    if not granter_res.data:
        raise HTTPException(status_code=403, detail="Granter not found")
    actual_role = granter_res.data.get("role")
    if actual_role not in ("mod", "owner"):
        raise HTTPException(status_code=403, detail="Unauthorized")

    result = await grant_badge_manual(supabase, req.granter_id, req.target_user_id, req.badge_id, actual_role)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@badge_router.get("/equip-limit")
def equip_limit(tier: str = Query(...)):
    return {"tier": tier, "limit": EQUIP_LIMITS.get(tier, 1)}
