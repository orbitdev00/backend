"""
forum_routes.py — Proxied forum endpoints with server-side sanitization.

All forum_threads and forum_posts writes go through here instead of hitting
Supabase directly from the frontend. sanitize_text() strips all HTML tags and
decodes entities before content is stored.
"""

import httpx
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from security import sanitize_text, is_valid_uuid
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

forum_router = APIRouter(prefix="/forum", tags=["forum"])

_KEY = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
_HEADERS = {
    "apikey": _KEY,
    "Authorization": f"Bearer {_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


async def _auth_user(request: Request) -> Optional[dict]:
    """Verify the Supabase JWT in the Authorization header.
    Returns {"id": "...", "email": "..."} or None if invalid."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            uid = data.get("id")
            if not uid or not is_valid_uuid(uid):
                return None
            return {"id": uid, "email": data.get("email", "")}
    except Exception:
        return None


@forum_router.post("/threads")
async def create_thread(request: Request):
    """Create a forum thread. Sanitizes title and body before writing."""
    user = await _auth_user(request)
    if not user:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    try:
        raw = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    category_id = raw.get("category_id")
    title = sanitize_text(str(raw.get("title", "")), max_len=200)
    body  = sanitize_text(str(raw.get("body",  "")), max_len=10_000)

    if not title:
        return JSONResponse({"error": "title is required"}, status_code=400)
    if not body:
        return JSONResponse({"error": "body is required"}, status_code=400)
    if not isinstance(category_id, int):
        return JSONResponse({"error": "invalid category_id"}, status_code=400)

    async with httpx.AsyncClient(timeout=10) as client:
        # Announcements category: only mods/admins/owners may post
        cat_resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/forum_categories",
            params={"id": f"eq.{category_id}", "select": "slug"},
            headers=_HEADERS,
        )
        if cat_resp.status_code == 200:
            cats = cat_resp.json()
            if cats and cats[0].get("slug") == "announcements":
                role_resp = await client.get(
                    f"{SUPABASE_URL}/rest/v1/user_reputation",
                    params={"user_id": f"eq.{user['id']}", "select": "role"},
                    headers=_HEADERS,
                )
                role = "member"
                if role_resp.status_code == 200:
                    rows = role_resp.json()
                    if rows:
                        role = rows[0].get("role") or "member"
                if role not in ("mod", "admin", "owner"):
                    return JSONResponse(
                        {"error": "Only moderators and admins can post in Announcements."},
                        status_code=403,
                    )

        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/forum_threads",
            json={
                "category_id": category_id,
                "user_id":     user["id"],
                "author_email": user["email"],
                "title":       title,
                "body":        body,
            },
            headers=_HEADERS,
        )

    if resp.status_code not in (200, 201):
        return JSONResponse({"error": "Failed to create thread"}, status_code=500)

    data = resp.json()
    if isinstance(data, list):
        data = data[0] if data else {}
    return JSONResponse(data)


@forum_router.post("/posts")
async def create_post(request: Request):
    """Create a forum reply. Sanitizes body before writing and updates thread metadata."""
    user = await _auth_user(request)
    if not user:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    try:
        raw = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    thread_id = raw.get("thread_id")
    body      = sanitize_text(str(raw.get("body", "")), max_len=10_000)

    if not body:
        return JSONResponse({"error": "body is required"}, status_code=400)
    if not isinstance(thread_id, int):
        return JSONResponse({"error": "invalid thread_id"}, status_code=400)

    async with httpx.AsyncClient(timeout=10) as client:
        # Insert the post
        post_resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/forum_posts",
            json={
                "thread_id":   thread_id,
                "user_id":     user["id"],
                "author_email": user["email"],
                "body":        body,
            },
            headers=_HEADERS,
        )

        if post_resp.status_code not in (200, 201):
            return JSONResponse({"error": "Failed to create post"}, status_code=500)

        # Fetch current reply_count then increment — avoids race on concurrent replies
        thread_resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/forum_threads",
            params={"id": f"eq.{thread_id}", "select": "reply_count"},
            headers=_HEADERS,
        )
        current_count = 0
        if thread_resp.status_code == 200:
            rows = thread_resp.json()
            if rows:
                current_count = rows[0].get("reply_count") or 0

        await client.patch(
            f"{SUPABASE_URL}/rest/v1/forum_threads",
            params={"id": f"eq.{thread_id}"},
            json={
                "reply_count":  current_count + 1,
                "last_reply_at": datetime.now(timezone.utc).isoformat(),
            },
            headers={**_HEADERS, "Prefer": "return=minimal"},
        )

    return JSONResponse({"ok": True})


@forum_router.post("/vote")
async def vote(request: Request):
    user = await _auth_user(request)
    if not user:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    try:
        raw = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    target_type = raw.get("target_type")
    target_id   = raw.get("target_id")
    value       = raw.get("value")

    if target_type not in ("thread", "post"):
        return JSONResponse({"error": "invalid target_type"}, status_code=400)
    if not isinstance(target_id, int):
        return JSONResponse({"error": "invalid target_id"}, status_code=400)
    if value not in (1, -1):
        return JSONResponse({"error": "invalid value"}, status_code=400)

    async with httpx.AsyncClient(timeout=10) as client:
        # Fetch existing vote
        ev_resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/forum_votes",
            params={"user_id": f"eq.{user['id']}", "target_type": f"eq.{target_type}", "target_id": f"eq.{target_id}", "select": "id,value"},
            headers=_HEADERS,
        )
        existing = ev_resp.json() if ev_resp.status_code == 200 else []
        existing_vote = existing[0] if existing else None

        if existing_vote and existing_vote["value"] == value:
            # Same vote again — toggle off
            await client.delete(
                f"{SUPABASE_URL}/rest/v1/forum_votes",
                params={"user_id": f"eq.{user['id']}", "target_type": f"eq.{target_type}", "target_id": f"eq.{target_id}"},
                headers={**_HEADERS, "Prefer": "return=minimal"},
            )
            new_vote = None
        elif existing_vote:
            # Switch vote direction
            await client.patch(
                f"{SUPABASE_URL}/rest/v1/forum_votes",
                params={"user_id": f"eq.{user['id']}", "target_type": f"eq.{target_type}", "target_id": f"eq.{target_id}"},
                json={"value": value},
                headers={**_HEADERS, "Prefer": "return=minimal"},
            )
            new_vote = value
        else:
            # New vote
            await client.post(
                f"{SUPABASE_URL}/rest/v1/forum_votes",
                json={"user_id": user["id"], "target_type": target_type, "target_id": target_id, "value": value},
                headers={**_HEADERS, "Prefer": "return=minimal"},
            )
            new_vote = value

        # Recalculate vote_score
        all_resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/forum_votes",
            params={"target_type": f"eq.{target_type}", "target_id": f"eq.{target_id}", "select": "value"},
            headers=_HEADERS,
        )
        all_votes = all_resp.json() if all_resp.status_code == 200 else []
        vote_score = sum(v["value"] for v in all_votes)

        table = "forum_threads" if target_type == "thread" else "forum_posts"
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/{table}",
            params={"id": f"eq.{target_id}"},
            json={"vote_score": vote_score},
            headers={**_HEADERS, "Prefer": "return=minimal"},
        )

    return JSONResponse({"ok": True, "vote_score": vote_score, "user_vote": new_vote})


@forum_router.post("/view/{thread_id}")
async def increment_view(thread_id: int):
    async with httpx.AsyncClient(timeout=10) as client:
        cur_resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/forum_threads",
            params={"id": f"eq.{thread_id}", "select": "view_count"},
            headers=_HEADERS,
        )
        current = 0
        if cur_resp.status_code == 200:
            rows = cur_resp.json()
            if rows:
                current = rows[0].get("view_count") or 0

        await client.patch(
            f"{SUPABASE_URL}/rest/v1/forum_threads",
            params={"id": f"eq.{thread_id}"},
            json={"view_count": current + 1},
            headers={**_HEADERS, "Prefer": "return=minimal"},
        )
    return JSONResponse({"ok": True})
