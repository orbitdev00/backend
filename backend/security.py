import re
import os
import time
from collections import defaultdict
from fastapi import Request

_BASE58 = re.compile(r'^[1-9A-HJ-NP-Za-km-z]{32,44}$')
_UUID   = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)

def is_valid_mint(mint: str) -> bool:
    return bool(_BASE58.match(mint))

def is_valid_uuid(uid: str) -> bool:
    return bool(_UUID.match(uid))

def admin_ok(request: Request) -> bool:
    secret = os.getenv("ADMIN_SECRET", "")
    if not secret:
        return False
    return request.headers.get("x-admin-secret") == secret

# Per-IP sliding window rate limiter
_ip_windows: dict[str, list[float]] = defaultdict(list)

def ip_rate_ok(ip: str, limit: int = 30, window: int = 60) -> bool:
    """Returns True if the IP is within the limit, False if exceeded."""
    now  = time.time()
    hits = [h for h in _ip_windows[ip] if now - h < window]
    _ip_windows[ip] = hits
    if len(hits) >= limit:
        return False
    _ip_windows[ip].append(now)
    return True

async def verify_ws_token(access_token: str, claimed_user_id: str) -> bool:
    """Verify Supabase access_token and confirm it belongs to claimed_user_id."""
    if not access_token or not claimed_user_id:
        return False
    try:
        import httpx
        from config import SUPABASE_URL, SUPABASE_ANON_KEY
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {access_token}",
                },
            )
            if resp.status_code != 200:
                return False
            return resp.json().get("id") == claimed_user_id
    except Exception:
        return False
