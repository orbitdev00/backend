"""
Matos Dashboard chore API (APP_MODE=chores) — see ORBIT_CHORE_MODE.md

POST /chores/submit  Validates a change and applies it right away to the live
                     chore tables with the Supabase service role key. Rate
                     limited per IP. The public (anon) key stays read only.

Score integrity: points are never accepted from the client. A completion's
points_awarded is computed here from the chore's minutes and difficulty (and
stamped again by a database trigger), completions can't be edited, and the
leaderboard/streaks are a read-only view over chore_completions.
"""
import re
from datetime import date, datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY
from security import ip_rate_ok, is_valid_uuid, sanitize_text

chore_router = APIRouter(prefix="/chores")

_REST = f"{SUPABASE_URL}/rest/v1"
_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY or "",
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY or ''}",
    "Content-Type": "application/json",
}

SUBMIT_LIMIT_PER_MIN = 20

CHANGE_TYPES = {
    "chore_add", "chore_edit", "chore_delete",
    "assignment_set", "completion_set",
    "rotation_toggle", "reset_defaults",
}

_FREQUENCIES = {"daily", "weekly", "monthly"}
DIFFICULTY_MULTIPLIER = {"easy": 1.0, "medium": 1.5, "hard": 2.0}
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)(:00)?$")
# Changing any of these changes which days (or whom) a chore lands on.
_SCHEDULE_FIELDS = ("frequency", "preferred_weekday", "month_day", "allowed_member_ids")


class ChoreValidationError(ValueError):
    pass


class ChoreRuleError(ValueError):
    """A valid request that breaks a chore rule (wrong person, wrong day, …)."""
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def points_for(minutes: int, difficulty: str) -> int:
    """Time estimate × difficulty multiplier, rounded half up."""
    return int(minutes * DIFFICULTY_MULTIPLIER.get(difficulty, 1.0) + 0.5)


# ── America/New_York day boundaries ──────────────────────────────────────────
# US rules: DST from the 2nd Sunday of March 02:00 local to the 1st Sunday of
# November 02:00 local. Done by hand so the slim Docker image needs no tzdata.

def _nth_sunday(year: int, month: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))


def ny_today(now: datetime | None = None) -> date:
    now = now or datetime.now(timezone.utc)
    y = now.year
    dst_start = datetime.combine(_nth_sunday(y, 3, 2), datetime.min.time(), timezone.utc) + timedelta(hours=7)
    dst_end = datetime.combine(_nth_sunday(y, 11, 1), datetime.min.time(), timezone.utc) + timedelta(hours=6)
    offset = -4 if dst_start <= now < dst_end else -5
    return (now + timedelta(hours=offset)).date()


# ── Validation ───────────────────────────────────────────────────────────────

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


def _time_of_day(payload: dict):
    value = payload.get("time_of_day")
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not _TIME.match(value):
        raise ChoreValidationError("time_of_day must be HH:MM (24 hour)")
    return value[:5] + ":00"


def _allowed(payload: dict):
    value = payload.get("allowed_member_ids")
    if value is None:
        return None
    if not isinstance(value, list) or len(value) > 50:
        raise ChoreValidationError("allowed_member_ids must be a list of member ids or null")
    ids = list(dict.fromkeys(_uuid(v, "allowed_member_ids") for v in value))
    return ids or None


def _chore_fields(payload: dict) -> dict:
    frequency = payload.get("frequency")
    if frequency not in _FREQUENCIES:
        raise ChoreValidationError("frequency must be daily, weekly or monthly")
    difficulty = payload.get("difficulty")
    if difficulty not in DIFFICULTY_MULTIPLIER:
        raise ChoreValidationError("difficulty must be easy, medium or hard")
    return {
        "title": _text(payload, "title", 120),
        "frequency": frequency,
        "zone": _text(payload, "zone", 40),
        "minutes": _int(payload, "minutes", 1, 600),
        "difficulty": difficulty,
        "description": sanitize_text(payload.get("description") or "", 500) or None,
        "time_of_day": _time_of_day(payload),
        "allowed_member_ids": _allowed(payload),
        "preferred_weekday": _int(payload, "preferred_weekday", 0, 6) if frequency == "weekly" else None,
        "month_day": _int(payload, "month_day", 1, 31) if frequency == "monthly" else None,
    }


def validate_change(change_type: str, target_id, payload: dict) -> tuple[str | None, dict]:
    """Returns (target_id, clean_payload) or raises ChoreValidationError.
    Only whitelisted fields survive, so a client-sent points value is dropped here."""
    if change_type not in CHANGE_TYPES:
        raise ChoreValidationError("unknown change_type")
    if not isinstance(payload, dict):
        raise ChoreValidationError("payload must be an object")

    if change_type == "chore_add":
        return None, _chore_fields(payload)
    if change_type == "chore_edit":
        return _uuid(target_id, "target_id"), _chore_fields(payload)
    if change_type == "chore_delete":
        return _uuid(target_id, "target_id"), {}
    if change_type == "assignment_set":
        chore_id = _uuid(payload.get("chore_id"), "chore_id")
        return chore_id, {
            "chore_id": chore_id,
            "date": _date(payload),
            "member_id": _uuid(payload.get("member_id"), "member_id"),
        }
    if change_type == "completion_set":
        chore_id = _uuid(payload.get("chore_id"), "chore_id")
        return chore_id, {
            "chore_id": chore_id,
            "date": _date(payload),
            "done": _bool(payload, "done"),
            "member_id": _uuid(payload.get("member_id"), "member_id"),
        }
    if change_type == "rotation_toggle":
        return None, {"rotation_enabled": _bool(payload, "rotation_enabled")}
    return None, {}  # reset_defaults


# ── Apply ────────────────────────────────────────────────────────────────────

_MIN = {**_HEADERS, "Prefer": "return=minimal"}


async def _get(client: httpx.AsyncClient, table: str, params: dict) -> list:
    r = await client.get(f"{_REST}/{table}", params=params, headers=_HEADERS)
    r.raise_for_status()
    return r.json()


async def _active_member_ids(client: httpx.AsyncClient) -> set[str]:
    return {m["id"] for m in await _get(client, "chore_members", {"select": "id", "active": "eq.true"})}


async def _check_allowed(client: httpx.AsyncClient, fields: dict):
    if fields["allowed_member_ids"] and not set(fields["allowed_member_ids"]) <= await _active_member_ids(client):
        raise ChoreValidationError("allowed_member_ids contains an unknown member")


async def _load_chore(client: httpx.AsyncClient, chore_id: str) -> dict:
    rows = await _get(client, "chores", {"id": f"eq.{chore_id}", "select": "*"})
    if not rows:
        raise ChoreRuleError("Chore not found", 404)
    return rows[0]


def _same_schedule(current: dict, fields: dict) -> bool:
    for key in _SCHEDULE_FIELDS:
        a, b = current.get(key), fields.get(key)
        if key == "allowed_member_ids":
            a, b = set(a or []), set(b or [])
        if a != b:
            return False
    return True


async def _edit_chore(client: httpx.AsyncClient, chore_id: str, fields: dict, today: date) -> dict:
    current = await _load_chore(client, chore_id)
    if not current["active"]:
        raise ChoreRuleError("That chore was deleted")
    await _check_allowed(client, fields)
    tomorrow = (today + timedelta(days=1)).isoformat()

    if _same_schedule(current, fields) or current["starts_on"] > today.isoformat():
        r = await client.patch(f"{_REST}/chores", params={"id": f"eq.{chore_id}"}, json=fields, headers=_MIN)
        r.raise_for_status()
        return {"id": chore_id}

    # The schedule changed: keep the old version through today so past days
    # (and streaks) stay as they were, and start the new version tomorrow.
    r = await client.post(f"{_REST}/chores", json={**fields, "starts_on": tomorrow},
                          headers={**_HEADERS, "Prefer": "return=representation"})
    r.raise_for_status()
    new_id = r.json()[0]["id"]
    r = await client.patch(f"{_REST}/chores", params={"id": f"eq.{chore_id}"},
                           json={"active": False, "retired_on": tomorrow}, headers=_MIN)
    r.raise_for_status()
    r = await client.patch(f"{_REST}/chore_assignments",
                           params={"chore_id": f"eq.{chore_id}", "date": f"gte.{tomorrow}"},
                           json={"chore_id": new_id}, headers=_MIN)
    r.raise_for_status()
    return {"id": new_id, "starts_on": tomorrow}


async def _delete_chore(client: httpx.AsyncClient, chore_id: str, today: date):
    # Soft delete: completions (and their points) stay.
    current = await _load_chore(client, chore_id)
    retired_on = max(today.isoformat(), current["starts_on"])
    r = await client.patch(f"{_REST}/chores", params={"id": f"eq.{chore_id}", "active": "eq.true"},
                           json={"active": False, "retired_on": retired_on}, headers=_MIN)
    r.raise_for_status()


async def _set_assignment(client: httpx.AsyncClient, payload: dict, today: date):
    if payload["date"] < (today - timedelta(days=1)).isoformat():
        raise ChoreRuleError("Tasks before yesterday can't be reassigned")
    if payload["member_id"] not in await _active_member_ids(client):
        raise ChoreValidationError("member_id is not a family member")
    await _load_chore(client, payload["chore_id"])
    done = await _get(client, "chore_completions", {
        "chore_id": f"eq.{payload['chore_id']}", "date": f"eq.{payload['date']}", "select": "chore_id"})
    if done:
        raise ChoreRuleError("Uncheck this task before reassigning it")
    r = await client.post(
        f"{_REST}/chore_assignments",
        params={"on_conflict": "chore_id,date"},
        json={**payload, "overridden": True},
        headers={**_HEADERS, "Prefer": "return=minimal,resolution=merge-duplicates"},
    )
    r.raise_for_status()


async def _set_completion(client: httpx.AsyncClient, payload: dict, today: date) -> dict:
    day = payload["date"]
    if day not in (today.isoformat(), (today - timedelta(days=1)).isoformat()):
        raise ChoreRuleError("Tasks can only be checked off for today or yesterday")

    rows = await _get(client, "chore_schedule", {
        "chore_id": f"eq.{payload['chore_id']}", "date": f"eq.{day}", "select": "member_id,done"})
    if not rows:
        raise ChoreRuleError("That chore isn't scheduled on this day")
    if rows[0]["member_id"] != payload["member_id"]:
        raise ChoreRuleError("Only the person assigned to this task can check it off", 403)

    where = {"chore_id": f"eq.{payload['chore_id']}", "date": f"eq.{day}"}
    if not payload["done"]:
        r = await client.delete(f"{_REST}/chore_completions", params=where, headers=_MIN)
        r.raise_for_status()
        return {"done": False}

    chore = await _load_chore(client, payload["chore_id"])
    row = {
        "chore_id": payload["chore_id"],
        "date": day,
        "completed_by": payload["member_id"],
        "points_awarded": points_for(chore["minutes"], chore["difficulty"]),
    }
    r = await client.post(
        f"{_REST}/chore_completions",
        params={"on_conflict": "chore_id,date"},
        json=row,
        headers={**_HEADERS, "Prefer": "return=representation,resolution=ignore-duplicates"},
    )
    r.raise_for_status()
    created = r.json()
    if not created:  # already checked off
        existing = await _get(client, "chore_completions", {**where, "select": "points_awarded"})
        return {"done": True, "points": existing[0]["points_awarded"] if existing else 0, "already": True}
    return {"done": True, "points": created[0]["points_awarded"]}


async def apply_change(client: httpx.AsyncClient, change_type: str, target_id, payload: dict,
                       today: date | None = None) -> dict:
    today = today or ny_today()
    if change_type == "chore_add":
        await _check_allowed(client, payload)
        r = await client.post(f"{_REST}/chores", json={**payload, "starts_on": today.isoformat()},
                              headers={**_HEADERS, "Prefer": "return=representation"})
        r.raise_for_status()
        return {"id": r.json()[0]["id"]}
    if change_type == "chore_edit":
        return await _edit_chore(client, target_id, payload, today)
    if change_type == "chore_delete":
        await _delete_chore(client, target_id, today)
        return {}
    if change_type == "assignment_set":
        await _set_assignment(client, payload, today)
        return {}
    if change_type == "completion_set":
        return await _set_completion(client, payload, today)
    if change_type == "rotation_toggle":
        # Takes effect tomorrow so today's (and past) assignments don't reshuffle.
        enabled = payload["rotation_enabled"]
        r = await client.post(
            f"{_REST}/chore_rotation_log",
            params={"on_conflict": "effective_on"},
            json={"effective_on": (today + timedelta(days=1)).isoformat(), "enabled": enabled},
            headers={**_HEADERS, "Prefer": "return=minimal,resolution=merge-duplicates"},
        )
        r.raise_for_status()
        r = await client.post(
            f"{_REST}/chore_settings",
            params={"on_conflict": "id"},
            json={"id": 1, "rotation_enabled": enabled},
            headers={**_HEADERS, "Prefer": "return=minimal,resolution=merge-duplicates"},
        )
        r.raise_for_status()
        return {}
    # reset_defaults: chores and members only, never completions.
    r = await client.post(f"{_REST}/rpc/chore_reset_defaults", json={}, headers=_MIN)
    r.raise_for_status()
    return {}


@chore_router.post("/submit")
async def submit_change(request: Request):
    ip = _client_ip(request)
    if not ip_rate_ok(f"chores-submit:{ip}", limit=SUBMIT_LIMIT_PER_MIN, window=60):
        return JSONResponse({"error": "Too many changes. Try again in a minute."}, status_code=429)
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

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            result = await apply_change(client, change_type, target_id, payload)
        return {"ok": True, **result}
    except ChoreValidationError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except ChoreRuleError as e:
        return JSONResponse({"error": str(e)}, status_code=e.status)
    except Exception as e:
        print(f"[Chores] {change_type} error: {e}")
        return JSONResponse({"error": "Could not save change"}, status_code=502)
