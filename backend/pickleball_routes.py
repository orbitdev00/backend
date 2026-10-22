"""
Pickleball tournament API (/pickleball page) — see ORBIT_CHORE_MODE.md

GET    /pickleball/config               Colors, skill levels and player count for the UI.
POST   /pickleball/join                 Joins as a singles player. The slot is drawn at random
                                        inside pickleball_join() under a table lock. Returns
                                        the raw edit token once; only its SHA-256 is stored.
PATCH  /pickleball/entry/{id}           Edits an entry (X-Entry-Token header).
DELETE /pickleball/entry/{id}           Leaves the tournament (X-Entry-Token header).
POST   /pickleball/messages             Posts to the chat as a joined player (X-Entry-Token header).

Organizer (X-Organizer-Pin header, checked on every request against the
PICKLEBALL_ADMIN_PIN env var; 503 when it's unset, 429 after 5 wrong tries in
5 minutes from one IP):
POST   /pickleball/admin/verify
PATCH  /pickleball/admin/entry/{id}
DELETE /pickleball/admin/entry/{id}
DELETE /pickleball/admin/messages/{id}
PATCH  /pickleball/admin/settings

Slots only ever come from the random draw: no endpoint accepts one and a
database trigger refuses to change it.
"""
import hashlib
import hmac
import os
import re
import secrets
from datetime import date

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY
from chore_routes import _client_ip
from security import ip_rate_exceeded, ip_rate_ok, is_valid_uuid

pickleball_router = APIRouter(prefix="/pickleball")

_REST = f"{SUPABASE_URL}/rest/v1"
_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY or "",
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY or ''}",
    "Content-Type": "application/json",
}
_MIN = {**_HEADERS, "Prefer": "return=minimal"}

MAX_TEAMS = 12
# The one list of player colors. The page reads it from GET /pickleball/config.
PICKLEBALL_COLORS = (
    "#ef4444", "#f97316", "#facc15", "#22c55e",
    "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
)
SKILL_LEVELS = ("beginner", "intermediate", "advanced")
NAME_MIN, NAME_MAX = 2, 30
MESSAGE_MAX = 200
EVENT_NAME_MAX = 60

JOIN_LIMIT, JOIN_WINDOW = 3, 3600
MESSAGE_LIMIT, MESSAGE_WINDOW = 5, 60
EDIT_LIMIT, EDIT_WINDOW = 30, 60
PIN_FAIL_LIMIT, PIN_FAIL_WINDOW = 5, 300

PIN_ENV = "PICKLEBALL_ADMIN_PIN"
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class PickleballError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _error(e: PickleballError) -> JSONResponse:
    return JSONResponse({"error": str(e)}, status_code=e.status)


# ── Validation ───────────────────────────────────────────────────────────────

def clean_name(value, label: str) -> str:
    if not isinstance(value, str):
        raise PickleballError(f"{label} is required")
    name = " ".join(value.split())
    if _CONTROL.search(name):
        raise PickleballError(f"{label} has characters that aren't allowed")
    if not NAME_MIN <= len(name) <= NAME_MAX:
        raise PickleballError(f"{label} must be {NAME_MIN} to {NAME_MAX} characters")
    return name


def validate_team(body: dict) -> dict:
    if "slot" in body:
        raise PickleballError("Slots come from the random draw and can't be chosen or changed")
    player = clean_name(body.get("player_name"), "Your name")
    skill = body.get("skill_level")
    if skill not in SKILL_LEVELS:
        raise PickleballError("Skill level must be beginner, intermediate or advanced")
    color = body.get("color")
    color = color.lower() if isinstance(color, str) else None
    if color not in PICKLEBALL_COLORS:
        raise PickleballError("Pick one of the colors")
    return {"player_name": player, "skill_level": skill, "color": color}


def validate_message(body: dict) -> tuple[str, str]:
    entry_id = body.get("entry_id")
    if not isinstance(entry_id, str) or not is_valid_uuid(entry_id):
        raise PickleballError("entry_id must be a valid id")
    text = body.get("body")
    if not isinstance(text, str):
        raise PickleballError("Message must be text")
    text = text.strip()
    if not text:
        raise PickleballError("Message can't be empty")
    if len(text) > MESSAGE_MAX:
        raise PickleballError(f"Messages are limited to {MESSAGE_MAX} characters")
    return entry_id, text


def validate_settings(body: dict) -> dict:
    name = body.get("event_name")
    if not isinstance(name, str) or _CONTROL.search(name) or not 1 <= len(name.strip()) <= EVENT_NAME_MAX:
        raise PickleballError(f"Event name must be 1 to {EVENT_NAME_MAX} characters")
    value = body.get("event_date")
    if value in (None, ""):
        event_date = None
    else:
        try:
            event_date = date.fromisoformat(value).isoformat()
        except (TypeError, ValueError):
            raise PickleballError("Event date must be YYYY-MM-DD")
    return {"event_name": " ".join(name.split()), "event_date": event_date}


def _uuid(value: str) -> str:
    if not is_valid_uuid(value):
        raise PickleballError("Player not found", 404)
    return value


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception:
        raise PickleballError("Invalid JSON")
    if not isinstance(body, dict):
        raise PickleballError("Invalid body")
    return body


# ── Supabase ─────────────────────────────────────────────────────────────────

_DB_ERRORS = {
    "tournament full": PickleballError("The tournament is full", 409),
    "name taken": PickleballError("That name is already in the tournament", 409),
    "not found": PickleballError("Player not found", 404),
}


async def _rpc(client: httpx.AsyncClient, fn: str, args: dict):
    r = await client.post(f"{_REST}/rpc/{fn}", json=args, headers=_HEADERS)
    if r.status_code >= 400:
        message = (r.json() if r.content else {}).get("message", "")
        if message in _DB_ERRORS:
            raise _DB_ERRORS[message]
        r.raise_for_status()
    return r.json() if r.content else None


async def _require_owner(client: httpx.AsyncClient, request: Request, entry_id: str):
    r = await client.get(f"{_REST}/pickleball_entries",
                         params={"id": f"eq.{entry_id}", "select": "edit_token_hash"}, headers=_HEADERS)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise PickleballError("Player not found", 404)
    token = request.headers.get("x-entry-token") or ""
    if not hmac.compare_digest(rows[0]["edit_token_hash"], hash_token(token)):
        raise PickleballError("Only the device that signed up this player can do that", 403)


async def _update_entry(client: httpx.AsyncClient, entry_id: str, team: dict):
    await _rpc(client, "pickleball_update", {
        "p_id": entry_id, "p_player": team["player_name"], "p_skill": team["skill_level"], "p_color": team["color"]})


async def _delete_entry(client: httpx.AsyncClient, entry_id: str):
    r = await client.delete(f"{_REST}/pickleball_entries", params={"id": f"eq.{entry_id}"},
                            headers={**_HEADERS, "Prefer": "return=representation"})
    r.raise_for_status()
    if not r.json():
        raise PickleballError("Player not found", 404)


def _rate(request: Request, name: str, limit: int, window: int):
    if not ip_rate_ok(f"pickleball-{name}:{_client_ip(request)}", limit=limit, window=window):
        raise PickleballError("Too many requests. Try again in a minute.", 429)


async def _run(fn):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            return {"ok": True, **(await fn(client) or {})}
    except PickleballError as e:
        return _error(e)
    except Exception as e:
        print(f"[Pickleball] error: {type(e).__name__}")
        return JSONResponse({"error": "Something went wrong. Try again."}, status_code=502)


# ── Public ───────────────────────────────────────────────────────────────────

@pickleball_router.get("/config")
async def config():
    return {"colors": list(PICKLEBALL_COLORS), "skill_levels": list(SKILL_LEVELS), "max_teams": MAX_TEAMS}


@pickleball_router.post("/join")
async def join(request: Request):
    key = f"pickleball-join:{_client_ip(request)}"
    try:
        if ip_rate_exceeded(key, JOIN_LIMIT, JOIN_WINDOW):
            raise PickleballError("You've joined 3 times this hour. Try again later.", 429)
        team = validate_team(await _body(request))
    except PickleballError as e:
        return _error(e)

    async def go(client):
        token = secrets.token_urlsafe(32)
        row = await _rpc(client, "pickleball_join", {
            "p_player": team["player_name"], "p_skill": team["skill_level"], "p_color": team["color"],
            "p_token_hash": hash_token(token)})
        ip_rate_ok(key, limit=JOIN_LIMIT, window=JOIN_WINDOW)  # only successful joins count
        return {"id": row["id"], "slot": row["slot"], "token": token}
    return await _run(go)


@pickleball_router.patch("/entry/{entry_id}")
async def edit_entry(entry_id: str, request: Request):
    try:
        _rate(request, "edit", EDIT_LIMIT, EDIT_WINDOW)
        entry_id = _uuid(entry_id)
        team = validate_team(await _body(request))
    except PickleballError as e:
        return _error(e)

    async def go(client):
        await _require_owner(client, request, entry_id)
        await _update_entry(client, entry_id, team)
    return await _run(go)


@pickleball_router.delete("/entry/{entry_id}")
async def leave(entry_id: str, request: Request):
    try:
        _rate(request, "edit", EDIT_LIMIT, EDIT_WINDOW)
        entry_id = _uuid(entry_id)
    except PickleballError as e:
        return _error(e)

    async def go(client):
        await _require_owner(client, request, entry_id)
        await _delete_entry(client, entry_id)
    return await _run(go)


@pickleball_router.post("/messages")
async def post_message(request: Request):
    try:
        _rate(request, "message", MESSAGE_LIMIT, MESSAGE_WINDOW)
        entry_id, text = validate_message(await _body(request))
    except PickleballError as e:
        return _error(e)

    async def go(client):
        await _require_owner(client, request, entry_id)
        r = await client.post(f"{_REST}/pickleball_messages", json={"entry_id": entry_id, "body": text},
                              headers={**_HEADERS, "Prefer": "return=representation"})
        r.raise_for_status()
        return {"message": r.json()[0]}
    return await _run(go)


# ── Organizer ────────────────────────────────────────────────────────────────

def check_pin(request: Request):
    """Raises unless the X-Organizer-Pin header matches PICKLEBALL_ADMIN_PIN.
    The PIN is never logged or echoed."""
    pin = os.getenv(PIN_ENV, "")
    if not pin:
        raise PickleballError("Organizer tools aren't set up", 503)
    key = f"pickleball-pin-fail:{_client_ip(request)}"
    if ip_rate_exceeded(key, PIN_FAIL_LIMIT, PIN_FAIL_WINDOW):
        raise PickleballError("Too many wrong PINs. Try again in 5 minutes.", 429)
    given = request.headers.get("x-organizer-pin") or ""
    # Compare fixed-length digests so the time taken doesn't depend on the PIN.
    if not hmac.compare_digest(hashlib.sha256(given.encode()).digest(), hashlib.sha256(pin.encode()).digest()):
        ip_rate_ok(key, limit=PIN_FAIL_LIMIT, window=PIN_FAIL_WINDOW)
        raise PickleballError("Wrong PIN", 401)


@pickleball_router.post("/admin/verify")
async def admin_verify(request: Request):
    try:
        check_pin(request)
    except PickleballError as e:
        return _error(e)
    return {"ok": True}


@pickleball_router.patch("/admin/entry/{entry_id}")
async def admin_edit_entry(entry_id: str, request: Request):
    try:
        check_pin(request)
        entry_id = _uuid(entry_id)
        team = validate_team(await _body(request))
    except PickleballError as e:
        return _error(e)
    return await _run(lambda client: _update_entry(client, entry_id, team))


@pickleball_router.delete("/admin/entry/{entry_id}")
async def admin_remove_entry(entry_id: str, request: Request):
    try:
        check_pin(request)
        entry_id = _uuid(entry_id)
    except PickleballError as e:
        return _error(e)
    return await _run(lambda client: _delete_entry(client, entry_id))


@pickleball_router.delete("/admin/messages/{message_id}")
async def admin_delete_message(message_id: str, request: Request):
    try:
        check_pin(request)
        if not is_valid_uuid(message_id):
            raise PickleballError("Message not found", 404)
    except PickleballError as e:
        return _error(e)

    async def go(client):
        r = await client.delete(f"{_REST}/pickleball_messages", params={"id": f"eq.{message_id}"}, headers=_MIN)
        r.raise_for_status()
    return await _run(go)


@pickleball_router.patch("/admin/settings")
async def admin_settings(request: Request):
    try:
        check_pin(request)
        settings = validate_settings(await _body(request))
    except PickleballError as e:
        return _error(e)

    async def go(client):
        r = await client.patch(f"{_REST}/pickleball_settings", params={"id": "eq.1"}, json=settings, headers=_MIN)
        r.raise_for_status()
        return {"settings": settings}
    return await _run(go)
