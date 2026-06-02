"""
badge_routes.py — Badge API Routes
"""

from fastapi import APIRouter, HTTPException, Query, Request
from security import ip_rate_ok, is_valid_uuid
from pydantic import BaseModel
from typing import Optional
from badges import BADGES, EQUIP_LIMITS
from badge_engine import grant_badge_manual, revoke_badge_manual, equip_badge_fn, unequip_badge_fn
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
import httpx

badge_router = APIRouter(prefix="/badges", tags=["badges"])

KEY = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


async def _get(path: str, params: dict = None) -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/{path}", params=params, headers=HEADERS)
        return resp.json() if resp.status_code == 200 else []


async def _auth_user(request: Request) -> Optional[dict]:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            uid = data.get("id")
            return {"id": uid, "email": data.get("email", "")} if uid else None
    except Exception:
        return None


@badge_router.get("/all")
def get_all_badges():
    return {"badges": list(BADGES.values())}


@badge_router.get("/user/{user_id}")
async def get_user_badges(user_id: str):
    rows = await _get("user_badges", {"user_id": f"eq.{user_id}"})
    enriched = []
    for row in rows:
        badge_def = BADGES.get(row["badge_id"])
        if badge_def:
            enriched.append({**badge_def, "equipped": row["equipped"], "awarded_at": row["awarded_at"]})
    return {"user_id": user_id, "badges": enriched}


@badge_router.get("/user/{user_id}/equipped")
async def get_equipped_badges(user_id: str):
    rows = await _get("user_badges", {"user_id": f"eq.{user_id}", "equipped": "eq.true"})
    equipped = []
    for row in rows:
        badge_def = BADGES.get(row["badge_id"])
        if badge_def:
            equipped.append({**badge_def, "awarded_at": row["awarded_at"]})
    return {"user_id": user_id, "equipped": equipped}


class EquipRequest(BaseModel):
    user_id: str
    badge_id: str
    tier: str


@badge_router.post("/equip")
async def equip(req: EquipRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    if not ip_rate_ok(ip, limit=20, window=60):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    user = await _auth_user(request)
    if not user or user["id"] != req.user_id:
        raise HTTPException(status_code=401, detail="unauthorized")
    result = await equip_badge_fn(req.user_id, req.badge_id, req.tier)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@badge_router.post("/unequip")
async def unequip(req: EquipRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    if not ip_rate_ok(ip, limit=20, window=60):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    user = await _auth_user(request)
    if not user or user["id"] != req.user_id:
        raise HTTPException(status_code=401, detail="unauthorized")
    return await unequip_badge_fn(req.user_id, req.badge_id)


class GrantRequest(BaseModel):
    granter_id: str
    target_user_id: str
    badge_id: str
    granter_role: str


@badge_router.post("/grant")
async def grant(req: GrantRequest, request: Request):
    user = await _auth_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="unauthorized")
    result = await grant_badge_manual(user["id"], req.target_user_id, req.badge_id, req.granter_role)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@badge_router.post("/revoke")
async def revoke(req: GrantRequest, request: Request):
    user = await _auth_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="unauthorized")
    result = await revoke_badge_manual(user["id"], req.target_user_id, req.badge_id, req.granter_role)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@badge_router.get("/equip-limit")
def equip_limit(tier: str = Query(...)):
    return {"tier": tier, "limit": EQUIP_LIMITS.get(tier, 1)}
