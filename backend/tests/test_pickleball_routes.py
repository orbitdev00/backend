"""
Tests for /pickleball/*. No network: Supabase's REST API is replaced with an
in-memory fake through httpx.MockTransport. The fake's join/update RPCs hold a
lock the way pickleball_join()/pickleball_update() hold the table lock.

The organizer PIN is a fake value set through a monkeypatched env var.

Run from backend/:  python -m pytest tests/test_pickleball_routes.py
"""
import asyncio
import hashlib
import json
import random
import re
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import pickleball_routes
from pickleball_routes import PICKLEBALL_COLORS, pickleball_router

FAKE_PIN = "test-pin-not-real-0000"
RED, BLUE = PICKLEBALL_COLORS[0], PICKLEBALL_COLORS[5]
_RealAsyncClient = httpx.AsyncClient
MIGRATION = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20261022000000_pickleball.sql"


class FakeSupabase:
    def __init__(self):
        self.entries = {}
        self.messages = {}
        self.settings = {"id": 1, "event_name": "Pickleball Tournament", "event_date": None}
        self.lock = asyncio.Lock()

    def _names(self, exclude=None):
        return {n.lower() for e in self.entries.values() if e["id"] != exclude
                for n in (e["player_name"], e["partner_name"])}

    @staticmethod
    def _err(message):
        return httpx.Response(400, json={"code": "P0001", "message": message})

    def bracket(self):
        """What the pickleball_bracket view returns."""
        cols = ("id", "player_name", "partner_name", "skill_level", "color", "slot", "created_at")
        return [{k: e[k] for k in cols} for e in self.entries.values()]

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/rest/v1/")
        p = dict(request.url.params)
        body = json.loads(request.content) if request.content else None
        eq = lambda k: (p.get(k) or "")[3:]

        if path == "rpc/pickleball_join":
            async with self.lock:
                if len(self.entries) >= 12:
                    return self._err("tournament full")
                taken = self._names()
                if body["p_player"].lower() == body["p_partner"].lower() or \
                        {body["p_player"].lower(), body["p_partner"].lower()} & taken:
                    return self._err("name taken")
                open_slots = [s for s in range(1, 13) if s not in {e["slot"] for e in self.entries.values()}]
                await asyncio.sleep(0)  # let other joins run while this one holds the lock
                slot = random.choice(open_slots)
                eid = str(uuid.uuid4())
                self.entries[eid] = {"id": eid, "player_name": body["p_player"], "partner_name": body["p_partner"],
                                     "skill_level": body["p_skill"], "color": body["p_color"], "slot": slot,
                                     "edit_token_hash": body["p_token_hash"], "created_at": "2026-10-22T12:00:00Z"}
                return httpx.Response(200, json={"id": eid, "slot": slot})
        if path == "rpc/pickleball_update":
            async with self.lock:
                e = self.entries.get(body["p_id"])
                if not e:
                    return self._err("not found")
                if body["p_player"].lower() == body["p_partner"].lower() or \
                        {body["p_player"].lower(), body["p_partner"].lower()} & self._names(exclude=e["id"]):
                    return self._err("name taken")
                e.update(player_name=body["p_player"], partner_name=body["p_partner"],
                         skill_level=body["p_skill"], color=body["p_color"])
                return httpx.Response(200, content=b"")
        if path == "pickleball_entries" and request.method == "GET":
            e = self.entries.get(eq("id"))
            return httpx.Response(200, json=[{"edit_token_hash": e["edit_token_hash"]}] if e else [])
        if path == "pickleball_entries" and request.method == "DELETE":
            e = self.entries.pop(eq("id"), None)
            if e:
                self.messages = {k: m for k, m in self.messages.items() if m["entry_id"] != e["id"]}
            return httpx.Response(200, json=[e] if e else [])
        if path == "pickleball_messages" and request.method == "POST":
            mid = str(uuid.uuid4())
            self.messages[mid] = {"id": mid, "created_at": "2026-10-22T12:00:00Z", **body}
            return httpx.Response(201, json=[self.messages[mid]])
        if path == "pickleball_messages" and request.method == "DELETE":
            self.messages.pop(eq("id"), None)
            return httpx.Response(204)
        if path == "pickleball_settings" and request.method == "PATCH":
            self.settings.update(body)
            return httpx.Response(204)
        return httpx.Response(404, json={"message": f"unhandled {request.method} {path}"})


@pytest.fixture
def fake(monkeypatch):
    fake = FakeSupabase()
    real_client = httpx.AsyncClient
    monkeypatch.setattr(pickleball_routes.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(fake), **kw))
    monkeypatch.setattr(pickleball_routes, "_REST", "https://sb.test/rest/v1")
    monkeypatch.setenv("PICKLEBALL_ADMIN_PIN", FAKE_PIN)
    from security import _ip_windows
    _ip_windows.clear()
    return fake


def make_app():
    app = FastAPI()
    app.include_router(pickleball_router)
    return app


@pytest.fixture
def client():
    return TestClient(make_app())


_ip_counter = iter(range(1, 10_000))


def fresh_ip():
    n = next(_ip_counter)
    return f"10.0.{n // 250}.{n % 250 + 1}"


def team(i=0, **overrides):
    return {"player_name": f"Player {i}", "partner_name": f"Partner {i}", "skill_level": "intermediate",
            "color": RED, **overrides}


def join(client, body=None, ip=None):
    return client.post("/pickleball/join", json=body or team(), headers={"x-forwarded-for": ip or fresh_ip()})


def joined(client, i=0, **overrides):
    r = join(client, team(i, **overrides))
    assert r.status_code == 200, r.text
    return r.json()


def pin(value=FAKE_PIN, ip="203.0.113.9"):
    return {"x-organizer-pin": value, "x-forwarded-for": ip}


# ── Joining ──────────────────────────────────────────────────────────────────

def test_join_returns_slot_and_token_and_stores_only_the_hash(fake, client):
    r = joined(client)
    assert 1 <= r["slot"] <= 12
    assert len(r["token"]) >= 40
    stored = fake.entries[r["id"]]
    assert stored["edit_token_hash"] == hashlib.sha256(r["token"].encode()).hexdigest()
    assert r["token"] not in json.dumps(fake.entries)


def test_concurrent_joins_never_share_a_slot(fake):
    async def run():
        transport = httpx.ASGITransport(app=make_app())
        async with _RealAsyncClient(transport=transport, base_url="http://test") as c:
            return await asyncio.gather(*(
                c.post("/pickleball/join", json=team(i), headers={"x-forwarded-for": fresh_ip()})
                for i in range(20)))
    for _ in range(5):
        fake.entries.clear()
        fake.lock = asyncio.Lock()
        responses = asyncio.run(run())
        ok = [r.json() for r in responses if r.status_code == 200]
        full = [r for r in responses if r.status_code == 409]
        slots = [r["slot"] for r in ok]
        assert len(ok) == 12 and len(full) == 8
        assert sorted(slots) == list(range(1, 13))


def test_thirteenth_join_is_rejected(fake, client):
    for i in range(12):
        joined(client, i)
    r = join(client, team(99))
    assert r.status_code == 409
    assert "full" in r.json()["error"]
    assert len(fake.entries) == 12


def test_join_rate_limit_is_three_per_hour_per_ip(fake, client):
    for i in range(3):
        assert join(client, team(i), ip="198.51.100.1").status_code == 200
    assert join(client, team(3), ip="198.51.100.1").status_code == 429
    assert join(client, team(4), ip="198.51.100.2").status_code == 200


@pytest.mark.parametrize("player,partner", [
    ("Alex", "Pat"),          # same player
    ("alex", "Sam"),          # case
    ("Sam", "ALEX"),          # as partner
    ("Jordan", "  aLeX  "),   # trimmed
    ("Riley", "taylor"),      # existing partner, as partner
    ("TAYLOR", "Morgan"),     # existing partner, as player
])
def test_duplicate_names_rejected_across_player_and_partner(fake, client, player, partner):
    joined(client, player_name="Alex", partner_name="Taylor")
    r = join(client, team(player_name=player, partner_name=partner))
    assert r.status_code == 409, r.text
    assert len(fake.entries) == 1


def test_player_and_partner_must_differ(fake, client):
    assert join(client, team(player_name="Casey", partner_name="casey")).status_code == 400


@pytest.mark.parametrize("field,value", [
    ("player_name", "A"), ("player_name", "x" * 31), ("player_name", "   "), ("partner_name", None),
    ("skill_level", "pro"), ("skill_level", "Beginner"), ("skill_level", None),
    ("color", "#123456"), ("color", "red"), ("color", None), ("color", "#ef444"),
])
def test_invalid_fields_rejected(fake, client, field, value):
    r = join(client, team(**{field: value}))
    assert r.status_code == 400, r.text
    assert not fake.entries


def test_names_are_trimmed(fake, client):
    r = joined(client, player_name="  Jamie   Lee ", partner_name="Robin ")
    assert fake.entries[r["id"]]["player_name"] == "Jamie Lee"
    assert fake.entries[r["id"]]["partner_name"] == "Robin"


def test_slot_cannot_be_chosen_on_join(fake, client):
    assert join(client, team(slot=1)).status_code == 400
    assert not fake.entries


# ── Editing and leaving ──────────────────────────────────────────────────────

@pytest.mark.parametrize("headers", [{}, {"x-entry-token": "wrong-token"}, {"x-entry-token": ""}])
def test_edit_and_leave_need_the_right_token(fake, client, headers):
    e = joined(client)
    other = joined(client, 1)
    assert client.patch(f"/pickleball/entry/{e['id']}", json=team(0, color=BLUE), headers=headers).status_code == 403
    assert client.delete(f"/pickleball/entry/{e['id']}", headers=headers).status_code == 403
    # Another team's token doesn't work either.
    wrong = {"x-entry-token": other["token"]}
    assert client.patch(f"/pickleball/entry/{e['id']}", json=team(0, color=BLUE), headers=wrong).status_code == 403
    assert client.delete(f"/pickleball/entry/{e['id']}", headers=wrong).status_code == 403
    assert fake.entries[e["id"]]["color"] == RED


def test_edit_and_leave_work_with_the_right_token(fake, client):
    e = joined(client)
    auth = {"x-entry-token": e["token"]}
    r = client.patch(f"/pickleball/entry/{e['id']}",
                     json=team(0, player_name="New Name", skill_level="advanced", color=BLUE), headers=auth)
    assert r.status_code == 200, r.text
    row = fake.entries[e["id"]]
    assert (row["player_name"], row["skill_level"], row["color"], row["slot"]) == \
           ("New Name", "advanced", BLUE, e["slot"])
    assert client.delete(f"/pickleball/entry/{e['id']}", headers=auth).status_code == 200
    assert e["id"] not in fake.entries


def test_leaving_frees_the_slot(fake, client):
    entries = [joined(client, i) for i in range(12)]
    gone = entries[4]
    assert client.delete(f"/pickleball/entry/{gone['id']}", headers={"x-entry-token": gone["token"]}).status_code == 200
    again = joined(client, 50)
    assert again["slot"] == gone["slot"]


def test_edit_keeps_its_own_names_but_not_others(fake, client):
    e = joined(client, player_name="Alex", partner_name="Taylor")
    joined(client, player_name="Morgan", partner_name="Riley")
    auth = {"x-entry-token": e["token"]}
    assert client.patch(f"/pickleball/entry/{e['id']}", json=team(player_name="ALEX", partner_name="Taylor"),
                        headers=auth).status_code == 200
    assert client.patch(f"/pickleball/entry/{e['id']}", json=team(player_name="Alex", partner_name="riley"),
                        headers=auth).status_code == 409


def test_edit_cannot_move_a_slot(fake, client):
    e = joined(client)
    r = client.patch(f"/pickleball/entry/{e['id']}", json=team(0, slot=12 if e["slot"] != 12 else 1),
                     headers={"x-entry-token": e["token"]})
    assert r.status_code == 400
    assert fake.entries[e["id"]]["slot"] == e["slot"]


def test_unknown_entry_is_404(fake, client):
    assert client.delete(f"/pickleball/entry/{uuid.uuid4()}", headers={"x-entry-token": "x"}).status_code == 404
    assert client.delete("/pickleball/entry/not-a-uuid", headers={"x-entry-token": "x"}).status_code == 404


# ── Organizer ────────────────────────────────────────────────────────────────

def test_organizer_pin_checks(fake, client):
    assert client.post("/pickleball/admin/verify", headers=pin()).status_code == 200
    assert client.post("/pickleball/admin/verify", headers=pin("nope")).status_code == 401
    assert client.post("/pickleball/admin/verify", headers={"x-forwarded-for": "203.0.113.9"}).status_code == 401


def test_organizer_lockout_after_five_wrong_tries(fake, client):
    for _ in range(5):
        assert client.post("/pickleball/admin/verify", headers=pin("wrong")).status_code == 401
    # Locked out, even with the right PIN, on every organizer endpoint.
    assert client.post("/pickleball/admin/verify", headers=pin()).status_code == 429
    assert client.patch("/pickleball/admin/settings", json={"event_name": "X"}, headers=pin()).status_code == 429
    # Other IPs aren't affected.
    assert client.post("/pickleball/admin/verify", headers=pin(ip="203.0.113.10")).status_code == 200


def test_organizer_endpoints_503_when_pin_unset(fake, client, monkeypatch):
    monkeypatch.delenv("PICKLEBALL_ADMIN_PIN")
    e = joined(client)
    some_id = str(uuid.uuid4())
    calls = [
        ("post", "/pickleball/admin/verify", None),
        ("patch", f"/pickleball/admin/entry/{e['id']}", team(0, color=BLUE)),
        ("delete", f"/pickleball/admin/entry/{e['id']}", None),
        ("delete", f"/pickleball/admin/messages/{some_id}", None),
        ("patch", "/pickleball/admin/settings", {"event_name": "X"}),
    ]
    for method, url, body in calls:
        kwargs = {"headers": pin()} | ({"json": body} if body is not None else {})
        assert getattr(client, method)(url, **kwargs).status_code == 503, url
    assert fake.entries[e["id"]]["color"] == RED


def test_every_organizer_endpoint_rejects_a_wrong_pin(fake, client):
    e = joined(client)
    calls = [
        ("patch", f"/pickleball/admin/entry/{e['id']}", team(0, color=BLUE)),
        ("delete", f"/pickleball/admin/entry/{e['id']}", None),
        ("delete", f"/pickleball/admin/messages/{uuid.uuid4()}", None),
        ("patch", "/pickleball/admin/settings", {"event_name": "X"}),
    ]
    for method, url, body in calls:
        kwargs = {"headers": pin("wrong", ip=fresh_ip())} | ({"json": body} if body is not None else {})
        assert getattr(client, method)(url, **kwargs).status_code == 401, url
    assert e["id"] in fake.entries
    assert fake.entries[e["id"]]["color"] == RED
    assert fake.settings["event_name"] == "Pickleball Tournament"


def test_organizer_can_edit_and_remove_any_entry(fake, client):
    e = joined(client)
    r = client.patch(f"/pickleball/admin/entry/{e['id']}", json=team(0, player_name="Fixed", color=BLUE), headers=pin())
    assert r.status_code == 200, r.text
    assert fake.entries[e["id"]]["player_name"] == "Fixed"
    assert client.delete(f"/pickleball/admin/entry/{e['id']}", headers=pin()).status_code == 200
    assert e["id"] not in fake.entries


def test_organizer_cannot_change_a_slot(fake, client):
    e = joined(client)
    new_slot = 12 if e["slot"] != 12 else 1
    r = client.patch(f"/pickleball/admin/entry/{e['id']}", json=team(0, slot=new_slot), headers=pin())
    assert r.status_code == 400
    assert fake.entries[e["id"]]["slot"] == e["slot"]


def test_organizer_settings(fake, client):
    r = client.patch("/pickleball/admin/settings", json={"event_name": " Fall Classic ", "event_date": "2026-11-14"},
                     headers=pin())
    assert r.status_code == 200, r.text
    assert fake.settings == {"id": 1, "event_name": "Fall Classic", "event_date": "2026-11-14"}
    assert client.patch("/pickleball/admin/settings", json={"event_name": "X", "event_date": "soon"},
                        headers=pin()).status_code == 400
    assert client.patch("/pickleball/admin/settings", json={"event_name": "Y", "event_date": None},
                        headers=pin()).status_code == 200
    assert fake.settings["event_date"] is None


def test_organizer_can_delete_wall_messages(fake, client):
    e = joined(client)
    m = client.post("/pickleball/messages", json={"entry_id": e["id"], "body": "hi"},
                    headers={"x-entry-token": e["token"]}).json()["message"]
    assert client.delete(f"/pickleball/admin/messages/{m['id']}", headers=pin()).status_code == 200
    assert not fake.messages


# ── Bracket view ─────────────────────────────────────────────────────────────

def test_bracket_view_never_exposes_token_hashes(fake, client):
    tokens = [joined(client, i)["token"] for i in range(3)]
    view = json.dumps(fake.bracket())
    assert "edit_token_hash" not in view
    for t in tokens:
        assert hashlib.sha256(t.encode()).hexdigest() not in view

    sql = MIGRATION.read_text(encoding="utf-8")
    view_sql = re.search(r"create view public\.pickleball_bracket as(.*?);", sql, re.S | re.I).group(1)
    assert "edit_token_hash" not in view_sql and "*" not in view_sql
    assert "grant select on public.pickleball_bracket to anon" in sql
    assert not re.search(r"grant[^;]*on public\.pickleball_entries[^;]*to[^;]*anon", sql, re.I)
    assert not re.search(r"grant\s+(insert|update|delete|all)", sql, re.I)


def test_migration_join_locks_before_drawing_a_slot():
    sql = MIGRATION.read_text(encoding="utf-8")
    fn = re.search(r"create function public\.pickleball_join.*?\$\$(.*?)\$\$", sql, re.S).group(1)
    assert fn.index("lock table public.pickleball_entries") < fn.index("order by random()")
    assert re.search(r"slot\s+integer not null unique", sql)


# ── Message wall ─────────────────────────────────────────────────────────────

def post(client, entry, body, token=None, ip="192.0.2.50"):
    headers = {"x-forwarded-for": ip}
    if token is not False:
        headers["x-entry-token"] = token if token is not None else entry["token"]
    return client.post("/pickleball/messages", json={"entry_id": entry["id"], "body": body}, headers=headers)


def test_wall_posts_need_a_valid_token(fake, client):
    e = joined(client)
    other = joined(client, 1)
    assert post(client, e, "hello", token=False).status_code == 403
    assert post(client, e, "hello", token="bogus").status_code == 403
    assert post(client, e, "hello", token=other["token"]).status_code == 403
    assert not fake.messages
    assert post(client, e, "hello").status_code == 200


def test_wall_length_and_empty(fake, client):
    e = joined(client)
    assert post(client, e, "x" * 201).status_code == 400
    assert post(client, e, "   ").status_code == 400
    r = post(client, e, "  " + "y" * 200 + "  ")
    assert r.status_code == 200
    assert r.json()["message"]["body"] == "y" * 200


def test_wall_rate_limit_five_per_minute(fake, client):
    e = joined(client)
    for i in range(5):
        assert post(client, e, f"msg {i}").status_code == 200
    assert post(client, e, "one too many").status_code == 429
    assert post(client, e, "other ip", ip="192.0.2.51").status_code == 200


def test_wall_stores_html_as_typed(fake, client):
    e = joined(client)
    body = '<img src=x onerror="alert(1)"><b>hi</b>'
    assert post(client, e, body).json()["message"]["body"] == body


# ── Config ───────────────────────────────────────────────────────────────────

def test_config_has_eight_colors(client):
    data = client.get("/pickleball/config").json()
    assert data["colors"] == list(PICKLEBALL_COLORS) and len(set(data["colors"])) == 8
    assert all(re.fullmatch(r"#[0-9a-f]{6}", c) for c in data["colors"])
    assert data["max_teams"] == 12
