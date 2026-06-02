"""
Account deletion endpoint.

Required Supabase migration (run once in SQL editor):
    ALTER TABLE user_reputation ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'email';

Requires SUPABASE_SERVICE_KEY (not anon key) to be set in Railway env vars.
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import httpx
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

delete_router = APIRouter()

_USER_TABLES = [
    "user_reputation",
    "predictions",
    "user_badges",
    "user_calls",
    "watchlist",
    "forum_votes",
    "direct_messages",
    "forum_posts",
    "forum_threads",
    "user_follows",
]


@delete_router.post("/account/delete")
async def delete_account(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    token = auth_header[7:].strip()

    # Use service key for all operations — anon key cannot delete auth users
    service_key = SUPABASE_SERVICE_KEY
    if not service_key or service_key == SUPABASE_ANON_KEY:
        print("[Delete] ERROR: SUPABASE_SERVICE_KEY is not set or equals anon key — auth deletion will fail")
        return JSONResponse({"error": "server misconfiguration"}, status_code=500)

    # Verify the user's JWT and extract their user_id
    async with httpx.AsyncClient(timeout=10) as client:
        user_resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": service_key, "Authorization": f"Bearer {token}"},
        )
    if user_resp.status_code != 200:
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    user_id = user_resp.json().get("id")
    if not user_id:
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    print(f"[Delete] Starting deletion for user {user_id}")

    # Delete all user data rows via REST API
    rest_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        for table in _USER_TABLES:
            try:
                resp = await client.delete(
                    f"{SUPABASE_URL}/rest/v1/{table}",
                    params={"user_id": f"eq.{user_id}"},
                    headers=rest_headers,
                )
                print(f"[Delete] {table}: status={resp.status_code}")
            except Exception as e:
                print(f"[Delete] {table} error: {e}")

    # Delete the Supabase Auth user using the admin SDK (requires service key)
    try:
        supabase_admin = create_client(SUPABASE_URL, service_key)
        supabase_admin.auth.admin.delete_user(user_id)
        print(f"[Delete] Auth user deleted: {user_id}")
    except Exception as e:
        print(f"[Delete] Auth user deletion FAILED for {user_id}: {e}")
        return JSONResponse({"error": "Failed to delete auth account"}, status_code=500)

    return JSONResponse({"status": "deleted"})
