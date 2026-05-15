"""
Account deletion endpoint.

Required Supabase migration (run once in SQL editor):
    ALTER TABLE user_reputation ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'email';
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import httpx
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

delete_router = APIRouter()

_USER_TABLES = [
    "user_reputation",
    "predictions",
    "user_badges",
    "user_calls",
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

    key = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY

    # Verify the user's JWT and get their user_id
    async with httpx.AsyncClient(timeout=10) as client:
        user_resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": key, "Authorization": f"Bearer {token}"},
        )
    if user_resp.status_code != 200:
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    user_id = user_resp.json().get("id")
    if not user_id:
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    rest_headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        # Delete all user data rows
        for table in _USER_TABLES:
            try:
                await client.delete(
                    f"{SUPABASE_URL}/rest/v1/{table}",
                    params={"user_id": f"eq.{user_id}"},
                    headers=rest_headers,
                )
            except Exception as e:
                print(f"[DeleteAccount] {table}: {e}")

        # Delete the Supabase Auth user (requires service key)
        admin_resp = await client.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )
        if admin_resp.status_code not in (200, 204):
            print(f"[DeleteAccount] auth delete failed: {admin_resp.status_code} {admin_resp.text[:200]}")
            return JSONResponse({"error": "Failed to delete auth account"}, status_code=500)

    print(f"[DeleteAccount] Deleted user {user_id}")
    return JSONResponse({"status": "deleted"})
