"""
Household Chore Dashboard API (APP_MODE=chores) — see ORBIT_CHORE_MODE.md

POST /chores/submit  Anyone can propose a change. It is validated, rate-limited
                     per IP and stored in pending_changes (status=pending).
POST /chores/review  A reviewer with CHORE_APPROVAL_PIN approves or rejects
                     pending changes. Approved changes are applied to the live
                     chore tables with the Supabase service role key.
"""
import hmac
import os
import re
from datetime import date, datetime, timezone

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY
from security import ip_rate_exceeded, ip_rate_ok, is_valid_uuid, sanitize_text

chore_router = APIRouter(prefix="/chores")

_REST = f"{SUPABASE_URL}/rest/v1"
_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY or "",
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY or ''}",
    "Content-Type": "application/json",
}

SUBMIT_LIMIT_PER_MIN = 20
# Only wrong PINs count, so a reviewer can approve items one by one without being throttled.
PIN_FAILS_ALLOWED = 5
PIN_FAIL_WINDOW = 300  # seconds
MAX_REVIEW_BATCH = 200

# change_type → live table it targets
CHANGE_TYPES = {
    "chore_add":       "chores",
    "chore_edit":      "chores",
    "chore_delete":    "chores",
    "member_add":      "chore_members",
    "member_edit":     "chore_members",
    "member_remove":   "chore_members",
    "assignment_set":  "chore_assignments",
    "completion_set":  "chore_completions",
    "rotation_toggle": "chore_settings",
    "reset_defaults":  "all",
}

_FREQUENCIES = {"daily", "weekly", "monthly"}
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class ChoreValidationError(ValueError):
    pass


def _client_ip(request: Request) -> str:
    # Railway's edge proxy appends the real client IP as the last X-Forwarded-For hop.
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _text(payload: dict, key: str, max_len: int) -> str:
    value = sanitize_text(payload.get(key, ""), max_len)
    if not value:
        raise ChoreValidationError(f"{key} is required")
    return value


def _int(payload: dict, key: str, lo: int, hi: int) -> int:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ChoreValidationError(f"{key} must be an integer between {lo} and {hi}")
    return value


def _bool(payload: dict, key: str) -> bool:
    value = payload.get(key)
    if not isinstance(value, bool):
        raise ChoreValidationError(f"{key} must be true or false")
    return value


def _uuid(value, name: str) -> str:
    if not isinstance(value, str) or not is_valid_uuid(value):
        raise ChoreValidationError(f"{name} must be a valid id")
    return value


def _date(payload: dict, key: str = "date") -> str:
    value = payload.get(key)
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise ChoreValidationError(f"{key} must be YYYY-MM-DD")


def _chore_fields(payload: dict) -> dict:
    frequency = payload.get("frequency")
    if frequency not in _FREQUENCIES:
        raise ChoreValidationError("frequency must be daily, weekly or monthly")
    return {
        "title": _text(payload, "title", 120),
        "frequency": frequency,
        "zone": _text(payload, "zone", 40),
        "minutes": _int(payload, "minutes", 1, 600),
        "preferred_weekday": _int(payload, "preferred_weekday", 0, 6) if frequency == "weekly" else None,
        "month_day": _int(payload, "month_day", 1, 31) if frequency == "monthly" else None,
    }


def _member_fields(payload: dict) -> dict:
    color = payload.get("color")
    if not isinstance(color, str) or not _COLOR.match(color):
        raise ChoreValidationError("color must be a hex color like #6366f1")
    return {"name": _text(payload, "name", 40), "color": color}


def validate_change(change_type: str, target_id, payload: dict) -> tuple[str | None, dict]:
    """Returns (target_id, clean_payload) or raises ChoreValidationError."""
    if change_type not in CHANGE_TYPES:
        raise ChoreValidationError("unknown change_type")
    if not isinstance(payload, dict):
        raise ChoreValidationError("payload must be an object")

    if change_type == "chore_add":
        return None, _chore_fields(payload)
    if change_type == "chore_edit":
        return _uuid(target_id, "target_id"), _chore_fields(payload)
    if change_type in ("chore_delete", "member_remove"):
        return _uuid(target_id, "target_id"), {}
    if change_type == "member_add":
        return None, _member_fields(payload)
    if change_type == "member_edit":
        return _uuid(target_id, "target_id"), _member_fields(payload)
    if change_type == "assignment_set":
        chore_id = _uuid(payload.get("chore_id"), "chore_id")
        return chore_id, {
            "chore_id": chore_id,
            "date": _date(payload),
            "member_id": _uuid(payload.get("member_id"), "member_id"),
        }
    if change_type == "completion_set":
        chore_id = _uuid(payload.get("chore_id"), "chore_id")
        return chore_id, {"chore_id": chore_id, "date": _date(payload), "done": _bool(payload, "done")}
    if change_type == "rotation_toggle":
        return None, {"rotation_enabled": _bool(payload, "rotation_enabled")}
    return None, {}  # reset_defaults


async def _apply(client: httpx.AsyncClient, change: dict):
    """Apply one approved pending change to the live tables."""
    kind = change["change_type"]
    target = change.get("target_id")
    payload = change.get("payload") or {}
    rep = {**_HEADERS, "Prefer": "return=minimal"}

    if kind == "chore_add":
        r = await client.post(f"{_REST}/chores", json=payload, headers=rep)
    elif kind == "chore_edit":
        r = await client.patch(f"{_REST}/chores", params={"id": f"eq.{target}"}, json=payload, headers=rep)
    elif kind == "chore_delete":
        # Assignments/completions go with it (ON DELETE CASCADE).
        r = await client.delete(f"{_REST}/chores", params={"id": f"eq.{target}"}, headers=rep)
    elif kind == "member_add":
        r = await client.post(f"{_REST}/chore_members", json=payload, headers=rep)
    elif kind == "member_edit":
        r = await client.patch(f"{_REST}/chore_members", params={"id": f"eq.{target}"}, json=payload, headers=rep)
    elif kind == "member_remove":
        # Soft-remove, then drop their manual assignments so rotation rebalances them.
        r = await client.patch(f"{_REST}/chore_members", params={"id": f"eq.{target}"},
                               json={"active": False}, headers=rep)
        r.raise_for_status()
        r = await client.delete(f"{_REST}/chore_assignments", params={"member_id": f"eq.{target}"}, headers=rep)
    elif kind == "assignment_set":
        r = await client.post(
            f"{_REST}/chore_assignments",
            params={"on_conflict": "chore_id,date"},
            json={**payload, "overridden": True},
            headers={**rep, "Prefer": "return=minimal,resolution=merge-duplicates"},
        )
    elif kind == "completion_set":
        params = {"chore_id": f"eq.{payload['chore_id']}", "date": f"eq.{payload['date']}"}
        if payload.get("done"):
            r = await client.post(
                f"{_REST}/chore_completions",
                params={"on_conflict": "chore_id,date"},
                json={"chore_id": payload["chore_id"], "date": payload["date"]},
                headers={**rep, "Prefer": "return=minimal,resolution=ignore-duplicates"},
            )
        else:
            r = await client.delete(f"{_REST}/chore_completions", params=params, headers=rep)
    elif kind == "rotation_toggle":
        r = await client.post(
            f"{_REST}/chore_settings",
            params={"on_conflict": "id"},
            json={"id": 1, "rotation_enabled": payload["rotation_enabled"]},
            headers={**rep, "Prefer": "return=minimal,resolution=merge-duplicates"},
        )
    elif kind == "reset_defaults":
        r = await client.post(f"{_REST}/rpc/chore_reset_defaults", json={}, headers=rep)
    else:
        raise ValueError(f"unknown change_type {kind}")
    r.raise_for_status()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _mark(client: httpx.AsyncClient, change_id: str, status: str) -> bool:
    """Mark a change reviewed. Only flips rows that are still pending."""
    r = await client.patch(
        f"{_REST}/pending_changes",
        params={"id": f"eq.{change_id}", "status": "eq.pending"},
        json={"status": status, "reviewed_at": _now()},
        headers={**_HEADERS, "Prefer": "return=representation"},
    )
    r.raise_for_status()
    return bool(r.json())


@chore_router.post("/submit")
async def submit_change(request: Request):
    ip = _client_ip(request)
    if not ip_rate_ok(f"chores-submit:{ip}", limit=SUBMIT_LIMIT_PER_MIN, window=60):
        return JSONResponse({"error": "Too many changes submitted. Try again in a minute."}, status_code=429)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "Invalid body"}, status_code=400)

    change_type = body.get("change_type")
    try:
        target_id, payload = validate_change(change_type, body.get("target_id"), body.get("payload") or {})
    except ChoreValidationError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    summary = sanitize_text(body.get("summary", ""), 300)
    if not summary:
        return JSONResponse({"error": "summary is required"}, status_code=400)

    row = {
        "change_type": change_type,
        "target_table": CHANGE_TYPES[change_type],
        "target_id": target_id,
        "payload": payload,
        "summary": summary,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{_REST}/pending_changes", json=row,
                                  headers={**_HEADERS, "Prefer": "return=representation"})
            r.raise_for_status()
            return {"change": r.json()[0]}
    except Exception as e:
        print(f"[Chores] submit error: {e}")
        return JSONResponse({"error": "Could not save change"}, status_code=502)


@chore_router.post("/review")
async def review_changes(request: Request):
    ip = _client_ip(request)
    fail_key = f"chores-pin-fail:{ip}"
    if ip_rate_exceeded(fail_key, PIN_FAILS_ALLOWED, PIN_FAIL_WINDOW):
        return JSONResponse({"error": "Too many wrong PINs. Try again in a few minutes."}, status_code=429)

    expected_pin = os.getenv("CHORE_APPROVAL_PIN", "")
    if not expected_pin:
        return JSONResponse({"error": "Reviewing is not configured (CHORE_APPROVAL_PIN unset)"}, status_code=503)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "Invalid body"}, status_code=400)

    pin = body.get("pin")
    if not isinstance(pin, str) or not hmac.compare_digest(pin.encode(), expected_pin.encode()):
        ip_rate_ok(fail_key, limit=PIN_FAILS_ALLOWED, window=PIN_FAIL_WINDOW)  # record the failure
        return JSONResponse({"error": "Incorrect PIN"}, status_code=403)

    action = body.get("action")
    if action not in ("approve", "reject"):
        return JSONResponse({"error": "action must be approve or reject"}, status_code=400)
    ids = body.get("ids")
    if (not isinstance(ids, list) or not ids or len(ids) > MAX_REVIEW_BATCH
            or not all(isinstance(i, str) and is_valid_uuid(i) for i in ids)):
        return JSONResponse({"error": "ids must be a non-empty list of change ids"}, status_code=400)

    results = []
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{_REST}/pending_changes",
            params={"id": f"in.({','.join(ids)})", "status": "eq.pending", "order": "submitted_at.asc"},
            headers=_HEADERS,
        )
        if r.status_code != 200:
            return JSONResponse({"error": "Could not load pending changes"}, status_code=502)

        for change in r.json():
            cid = change["id"]
            if action == "reject":
                try:
                    results.append({"id": cid, "ok": await _mark(client, cid, "rejected")})
                except Exception as e:
                    print(f"[Chores] reject {cid} failed: {e}")
                    results.append({"id": cid, "ok": False, "error": "Could not reject this change"})
                continue

            try:
                # Re-validate the stored payload before touching live tables.
                validate_change(change["change_type"], change.get("target_id"), change.get("payload") or {})
                # Claim the row first so two reviewers can't apply the same change twice.
                if not await _mark(client, cid, "approved"):
                    results.append({"id": cid, "ok": False, "error": "Already reviewed"})
                    continue
            except Exception as e:
                print(f"[Chores] approve {cid} rejected before apply: {e}")
                results.append({"id": cid, "ok": False, "error": "Could not apply this change"})
                continue

            try:
                await _apply(client, change)
                results.append({"id": cid, "ok": True})
            except Exception as e:
                print(f"[Chores] approve {cid} failed: {e}")
                # Put it back in the queue so it can be retried or rejected.
                await client.patch(
                    f"{_REST}/pending_changes",
                    params={"id": f"eq.{cid}"},
                    json={"status": "pending", "reviewed_at": None},
                    headers={**_HEADERS, "Prefer": "return=minimal"},
                )
                results.append({"id": cid, "ok": False, "error": "Could not apply this change"})

    return {"results": results}
