"""
Matos Dashboard chore API (APP_MODE=chores) — see ORBIT_CHORE_MODE.md

POST /chores/submit  Validates a change and applies it right away to the live
                     chore tables with the Supabase service role key. Rate
                     limited per IP. The public (anon) key stays read only.
POST /chores/chat    Posts a family chat message as the selected member.
POST /chores/shop    Buys or equips a cosmetic with coins (1 coin per 10 points).

Chores aren't assigned: any member can claim any chore scheduled today or
yesterday, and only whoever claimed it can unclaim it.

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
    "completion_set", "reset_defaults",
}

_FREQUENCIES = {"daily", "weekly", "monthly"}
DIFFICULTY_MULTIPLIER = {"easy": 1.0, "medium": 1.5, "hard": 2.0, "extreme": 2.5}
# Extreme chores are worth a fixed amount (stored as chores.points_override).
EXTREME_POINTS = 75
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)(:00)?$")
# Changing any of these changes which days a chore lands on.
_SCHEDULE_FIELDS = ("frequency", "preferred_weekday", "month_day")


class ChoreValidationError(ValueError):
    pass


class ChoreRuleError(ValueError):
    """A valid request that breaks a chore rule (already claimed, wrong day, …)."""
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def points_for(minutes: int, difficulty: str, points_override: int | None = None) -> int:
    """points_override if set, else time estimate × difficulty multiplier, rounded half up."""
    if points_override is not None:
        return points_override
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


def _chore_fields(payload: dict) -> dict:
    frequency = payload.get("frequency")
    if frequency not in _FREQUENCIES:
        raise ChoreValidationError("frequency must be daily, weekly or monthly")
    difficulty = payload.get("difficulty")
    if difficulty not in DIFFICULTY_MULTIPLIER:
        raise ChoreValidationError("difficulty must be easy, medium, hard or extreme")
    return {
        "title": _text(payload, "title", 120),
        "frequency": frequency,
        "zone": _text(payload, "zone", 40),
        "minutes": _int(payload, "minutes", 1, 600),
        "difficulty": difficulty,
        # Never taken from the client: extreme is always the fixed value.
        "points_override": EXTREME_POINTS if difficulty == "extreme" else None,
        "description": sanitize_text(payload.get("description") or "", 500) or None,
        "time_of_day": _time_of_day(payload),
        "allowed_member_ids": None,  # every chore is open to everyone
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
    if change_type == "completion_set":
        chore_id = _uuid(payload.get("chore_id"), "chore_id")
        return chore_id, {
            "chore_id": chore_id,
            "date": _date(payload),
            "done": _bool(payload, "done"),
            "member_id": _uuid(payload.get("member_id"), "member_id"),
        }
    return None, {}  # reset_defaults


# ── Apply ────────────────────────────────────────────────────────────────────

_MIN = {**_HEADERS, "Prefer": "return=minimal"}


async def _get(client: httpx.AsyncClient, table: str, params: dict) -> list:
    r = await client.get(f"{_REST}/{table}", params=params, headers=_HEADERS)
    r.raise_for_status()
    return r.json()


async def _active_member_ids(client: httpx.AsyncClient) -> set[str]:
    return {m["id"] for m in await _get(client, "chore_members", {"select": "id", "active": "eq.true"})}


async def _load_chore(client: httpx.AsyncClient, chore_id: str) -> dict:
    rows = await _get(client, "chores", {"id": f"eq.{chore_id}", "select": "*"})
    if not rows:
        raise ChoreRuleError("Chore not found", 404)
    return rows[0]


def _same_schedule(current: dict, fields: dict) -> bool:
    for key in _SCHEDULE_FIELDS:
        if current.get(key) != fields.get(key):
            return False
    return True


async def _edit_chore(client: httpx.AsyncClient, chore_id: str, fields: dict, today: date) -> dict:
    current = await _load_chore(client, chore_id)
    if not current["active"]:
        raise ChoreRuleError("That chore was deleted")
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
    return {"id": new_id, "starts_on": tomorrow}


async def _delete_chore(client: httpx.AsyncClient, chore_id: str, today: date):
    # Soft delete: completions (and their points) stay.
    current = await _load_chore(client, chore_id)
    retired_on = max(today.isoformat(), current["starts_on"])
    r = await client.patch(f"{_REST}/chores", params={"id": f"eq.{chore_id}", "active": "eq.true"},
                           json={"active": False, "retired_on": retired_on}, headers=_MIN)
    r.raise_for_status()


async def _set_completion(client: httpx.AsyncClient, payload: dict, today: date) -> dict:
    day = payload["date"]
    if day not in (today.isoformat(), (today - timedelta(days=1)).isoformat()):
        raise ChoreRuleError("Tasks can only be checked off for today or yesterday")

    if payload["member_id"] not in await _active_member_ids(client):
        raise ChoreValidationError("member_id is not a family member")
    rows = await _get(client, "chore_schedule", {
        "chore_id": f"eq.{payload['chore_id']}", "date": f"eq.{day}", "select": "done,completed_by"})
    if not rows:
        raise ChoreRuleError("That chore isn't scheduled on this day")
    claimed_by = rows[0]["completed_by"] if rows[0]["done"] else None
    if claimed_by and claimed_by != payload["member_id"]:
        raise ChoreRuleError("Someone else already claimed this chore" if payload["done"]
                             else "Only the person who claimed this chore can unclaim it", 403)

    where = {"chore_id": f"eq.{payload['chore_id']}", "date": f"eq.{day}"}
    if not payload["done"]:
        r = await client.delete(f"{_REST}/chore_completions",
                                params={**where, "completed_by": f"eq.{payload['member_id']}"}, headers=_MIN)
        r.raise_for_status()
        return {"done": False}

    chore = await _load_chore(client, payload["chore_id"])
    row = {
        "chore_id": payload["chore_id"],
        "date": day,
        "completed_by": payload["member_id"],
        "points_awarded": points_for(chore["minutes"], chore["difficulty"], chore.get("points_override")),
    }
    r = await client.post(
        f"{_REST}/chore_completions",
        params={"on_conflict": "chore_id,date"},
        json=row,
        headers={**_HEADERS, "Prefer": "return=representation,resolution=ignore-duplicates"},
    )
    r.raise_for_status()
    created = r.json()
    if not created:  # already claimed, maybe by someone else a moment ago
        existing = await _get(client, "chore_completions", {**where, "select": "completed_by,points_awarded"})
        if existing and existing[0]["completed_by"] != payload["member_id"]:
            raise ChoreRuleError("Someone else already claimed this chore", 403)
        return {"done": True, "points": existing[0]["points_awarded"] if existing else 0, "already": True}
    return {"done": True, "points": created[0]["points_awarded"]}


async def apply_change(client: httpx.AsyncClient, change_type: str, target_id, payload: dict,
                       today: date | None = None) -> dict:
    today = today or ny_today()
    if change_type == "chore_add":
        r = await client.post(f"{_REST}/chores", json={**payload, "starts_on": today.isoformat()},
                              headers={**_HEADERS, "Prefer": "return=representation"})
        r.raise_for_status()
        return {"id": r.json()[0]["id"]}
    if change_type == "chore_edit":
        return await _edit_chore(client, target_id, payload, today)
    if change_type == "chore_delete":
        await _delete_chore(client, target_id, today)
        return {}
    if change_type == "completion_set":
        return await _set_completion(client, payload, today)
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


# ── Chat ─────────────────────────────────────────────────────────────────────

CHAT_LIMIT_PER_MIN = 10
CHAT_MAX_LEN = 500


def validate_chat(body: dict) -> tuple[str, str]:
    """Returns (member_id, text). The text is stored exactly as typed (trimmed);
    the client renders it as plain text, so HTML in a message is never markup."""
    member_id = _uuid(body.get("member_id"), "member_id")
    text = body.get("body")
    if not isinstance(text, str):
        raise ChoreValidationError("body must be text")
    text = text.strip()
    if not text:
        raise ChoreValidationError("Message can't be empty")
    if len(text) > CHAT_MAX_LEN:
        raise ChoreValidationError(f"Messages are limited to {CHAT_MAX_LEN} characters")
    return member_id, text


@chore_router.post("/chat")
async def post_chat(request: Request):
    ip = _client_ip(request)
    if not ip_rate_ok(f"chores-chat:{ip}", limit=CHAT_LIMIT_PER_MIN, window=60):
        return JSONResponse({"error": "Slow down! Try again in a minute."}, status_code=429)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "Invalid body"}, status_code=400)
    try:
        member_id, text = validate_chat(body)
        async with httpx.AsyncClient(timeout=15) as client:
            if member_id not in await _active_member_ids(client):
                raise ChoreValidationError("member_id is not a family member")
            r = await client.post(f"{_REST}/chat_messages", json={"member_id": member_id, "body": text},
                                  headers={**_HEADERS, "Prefer": "return=representation"})
            r.raise_for_status()
        return {"ok": True, "message": r.json()[0]}
    except ChoreValidationError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        print(f"[Chores] chat error: {e}")
        return JSONResponse({"error": "Could not send message"}, status_code=502)


# ── Shop ─────────────────────────────────────────────────────────────────────
# Item id → (slot, price in coins). Mirrors SHOP_ITEMS in
# frontend/src/chores/shop.js (a test checks they match). Prices are only ever
# taken from here. Each slot is a column of chore_member_cosmetics.

SHOP_LIMIT_PER_MIN = 30
SHOP_SLOTS = ("theme", "avatar", "color", "name_font", "name_color", "banner")
SHOP_ITEMS = {
    "theme-bubblegum": ("theme", 15),
    "theme-rose-noir": ("theme", 20),
    "theme-crimson": ("theme", 20),
    "theme-ocean": ("theme", 15),
    "theme-midnight": ("theme", 20),
    "theme-sunset": ("theme", 15),
    "theme-silver-gold": ("theme", 25),
    "theme-obsidian": ("theme", 25),
    "avatar-fox": ("avatar", 30),
    "avatar-panda": ("avatar", 30),
    "avatar-unicorn": ("avatar", 45),
    "avatar-dragon": ("avatar", 60),
    "avatar-galaxy": ("avatar", 50),
    "avatar-holo": ("avatar", 75),
    "color-crimson": ("color", 40),
    "color-violet": ("color", 40),
    "color-teal": ("color", 40),
    "color-gold": ("color", 40),
    "color-hotpink": ("color", 40),
    "color-sky": ("color", 40),
    "font-playfair": ("name_font", 40),
    "font-pacifico": ("name_font", 50),
    "font-orbitron": ("name_font", 50),
    "font-bungee": ("name_font", 50),
    "font-pixel": ("name_font", 60),
    "nc-royal": ("name_color", 40),
    "nc-neon": ("name_color", 50),
    "nc-fire": ("name_color", 60),
    "nc-ice": ("name_color", 60),
    "nc-gold": ("name_color", 60),
    "nc-rainbow": ("name_color", 80),
    "banner-aurora": ("banner", 80),
    "banner-waves": ("banner", 90),
    "banner-stars": ("banner", 100),
    "banner-lava": ("banner", 120),
}


def validate_shop(body: dict) -> dict:
    action = body.get("action")
    member_id = _uuid(body.get("member_id"), "member_id")
    if action == "buy":
        item_id = body.get("item_id")
        if item_id not in SHOP_ITEMS:
            raise ChoreValidationError("Unknown item")
        return {"action": "buy", "member_id": member_id, "item_id": item_id}
    if action == "equip":
        item_id = body.get("item_id")
        if item_id is None:  # back to the default look for this slot
            slot = body.get("slot")
            if slot not in SHOP_SLOTS:
                raise ChoreValidationError("Unknown slot")
        elif item_id in SHOP_ITEMS:
            slot = SHOP_ITEMS[item_id][0]
        else:
            raise ChoreValidationError("Unknown item")
        return {"action": "equip", "member_id": member_id, "item_id": item_id, "slot": slot}
    raise ChoreValidationError("action must be buy or equip")


_BUY_ERRORS = {"not enough coins": "Not enough coins", "already owned": "You already own that",
               "unknown member": "member_id is not a family member"}


async def apply_shop(client: httpx.AsyncClient, req: dict) -> dict:
    member_id, item_id = req["member_id"], req["item_id"]
    if req["action"] == "buy":
        r = await client.post(f"{_REST}/rpc/chore_buy",
                              json={"p_member": member_id, "p_item": item_id, "p_price": SHOP_ITEMS[item_id][1]},
                              headers=_HEADERS)
        if r.status_code >= 400:
            message = (r.json() if r.content else {}).get("message", "")
            if message in _BUY_ERRORS:
                raise ChoreRuleError(_BUY_ERRORS[message], 400 if message == "unknown member" else 409)
            r.raise_for_status()
        return {"coins": r.json()}

    if member_id not in await _active_member_ids(client):
        raise ChoreValidationError("member_id is not a family member")
    if item_id is not None:
        owned = await _get(client, "chore_purchases", {
            "member_id": f"eq.{member_id}", "item_id": f"eq.{item_id}", "select": "item_id"})
        if not owned:
            raise ChoreRuleError("Buy it first", 403)
    r = await client.post(
        f"{_REST}/chore_member_cosmetics",
        params={"on_conflict": "member_id"},
        json={"member_id": member_id, req["slot"]: item_id, "updated_at": datetime.now(timezone.utc).isoformat()},
        headers={**_HEADERS, "Prefer": "return=minimal,resolution=merge-duplicates"},
    )
    r.raise_for_status()
    return {}


@chore_router.post("/shop")
async def shop(request: Request):
    ip = _client_ip(request)
    if not ip_rate_ok(f"chores-shop:{ip}", limit=SHOP_LIMIT_PER_MIN, window=60):
        return JSONResponse({"error": "Too many requests. Try again in a minute."}, status_code=429)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "Invalid body"}, status_code=400)
    try:
        req = validate_shop(body)
        async with httpx.AsyncClient(timeout=15) as client:
            result = await apply_shop(client, req)
        return {"ok": True, **result}
    except ChoreValidationError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except ChoreRuleError as e:
        return JSONResponse({"error": str(e)}, status_code=e.status)
    except Exception as e:
        print(f"[Chores] shop error: {e}")
        return JSONResponse({"error": "Could not complete purchase"}, status_code=502)
