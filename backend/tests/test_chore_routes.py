"""
Tests for POST /chores/submit (chore mode). No network: Supabase's REST API is
replaced with an in-memory fake through httpx.MockTransport.

Run from backend/:  python -m pytest tests/test_chore_routes.py
"""
import json
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import chore_routes
from chore_routes import chore_router, ny_today, points_for

TODAY = date(2026, 10, 20)
YESTERDAY = TODAY - timedelta(days=1)
ALEX = "11111111-1111-4111-8111-111111111111"
NATHAN = "22222222-2222-4222-8222-222222222222"
NOON = "33333333-3333-4333-8333-333333333333"   # 25m medium → 38 pts
BATH = "44444444-4444-4444-8444-444444444444"   # 30m hard → 60 pts
EVENING = "77777777-7777-4777-8777-777777777777"  # 30m extreme, points_override 75


class FakeSupabase:
    """Just enough of PostgREST for the chore routes."""

    def __init__(self):
        self.members = [{"id": ALEX, "active": True}, {"id": NATHAN, "active": True}]
        self.chores = {
            NOON: {"id": NOON, "minutes": 25, "difficulty": "medium", "active": True, "starts_on": "2026-01-01",
                   "frequency": "daily", "preferred_weekday": None, "month_day": None, "allowed_member_ids": None},
            BATH: {"id": BATH, "minutes": 30, "difficulty": "hard", "active": True, "starts_on": "2026-01-01",
                   "frequency": "weekly", "preferred_weekday": 2, "month_day": None,
                   "allowed_member_ids": [ALEX, NATHAN]},
            EVENING: {"id": EVENING, "minutes": 30, "difficulty": "extreme", "points_override": 75, "active": True,
                      "starts_on": "2026-01-01", "frequency": "daily", "preferred_weekday": None, "month_day": None,
                      "allowed_member_ids": None},
        }
        # (chore_id, date) pairs the chore_schedule view lists
        self.schedule = {(NOON, TODAY.isoformat()), (NOON, YESTERDAY.isoformat()),
                         (BATH, TODAY.isoformat()), (EVENING, TODAY.isoformat())}
        self.completions = {}
        self.writes = []
        self.messages = []
        self.coins = {ALEX: 100, NATHAN: 0}
        self.purchases = set()

    @staticmethod
    def _eq(params, key):
        v = params.get(key)
        return v[3:] if v and v.startswith("eq.") else None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/rest/v1/")
        p = dict(request.url.params)
        body = json.loads(request.content) if request.content else None
        if request.method != "GET":
            self.writes.append((request.method, path, p, body))

        if path == "chore_members":
            return httpx.Response(200, json=[{"id": m["id"]} for m in self.members if m["active"]])
        if path == "chores" and request.method == "GET":
            c = self.chores.get(self._eq(p, "id"))
            return httpx.Response(200, json=[c] if c else [])
        if path == "chore_schedule":
            key = (self._eq(p, "chore_id"), self._eq(p, "date"))
            if key not in self.schedule:
                return httpx.Response(200, json=[])
            comp = self.completions.get(key)
            return httpx.Response(200, json=[{"done": comp is not None,
                                              "completed_by": comp["completed_by"] if comp else None}])
        if path == "chore_completions":
            if request.method == "GET":
                key = (self._eq(p, "chore_id"), self._eq(p, "date"))
                row = self.completions.get(key)
                return httpx.Response(200, json=[row] if row else [])
            if request.method == "POST":
                key = (body["chore_id"], body["date"])
                if key in self.completions:
                    return httpx.Response(201, json=[])
                self.completions[key] = dict(body)
                return httpx.Response(201, json=[self.completions[key]])
            if request.method == "DELETE":
                key = (self._eq(p, "chore_id"), self._eq(p, "date"))
                if self.completions.get(key, {}).get("completed_by") == self._eq(p, "completed_by"):
                    self.completions.pop(key)
                return httpx.Response(204)
        if path == "chat_messages" and request.method == "POST":
            row = {"id": f"msg-{len(self.messages)}", "created_at": "2026-10-20T12:00:00+00:00", **body}
            self.messages.append(row)
            return httpx.Response(201, json=[row])
        if path == "rpc/chore_buy":
            member, item, price = body["p_member"], body["p_item"], body["p_price"]
            if (member, item) in self.purchases:
                return httpx.Response(400, json={"code": "P0001", "message": "already owned"})
            if self.coins.get(member, 0) < price:
                return httpx.Response(400, json={"code": "P0001", "message": "not enough coins"})
            self.purchases.add((member, item))
            self.coins[member] -= price
            return httpx.Response(200, json=self.coins[member])
        if path == "chore_purchases" and request.method == "GET":
            key = (self._eq(p, "member_id"), self._eq(p, "item_id"))
            return httpx.Response(200, json=[{"item_id": key[1]}] if key in self.purchases else [])
        if request.method in ("POST", "PATCH"):
            if path == "chores" and request.method == "POST":
                return httpx.Response(201, json=[{"id": "55555555-5555-4555-8555-555555555555", **body}])
            return httpx.Response(201 if request.method == "POST" else 204)
        return httpx.Response(404, json={"message": f"unhandled {request.method} {path}"})


@pytest.fixture
def fake(monkeypatch):
    fake = FakeSupabase()
    real_client = httpx.AsyncClient
    monkeypatch.setattr(chore_routes.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(fake), **kw))
    monkeypatch.setattr(chore_routes, "ny_today", lambda now=None: TODAY)
    monkeypatch.setattr(chore_routes, "_REST", "https://sb.test/rest/v1")
    from security import _ip_windows
    _ip_windows.clear()
    return fake


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(chore_router)
    return TestClient(app)


def submit(client, change_type, payload=None, target_id=None):
    return client.post("/chores/submit", json={"change_type": change_type, "payload": payload or {},
                                               "target_id": target_id})


def complete(client, chore_id, day, member, done=True, **extra):
    return submit(client, "completion_set",
                  {"chore_id": chore_id, "date": day.isoformat(), "done": done, "member_id": member, **extra})


# ── Points ───────────────────────────────────────────────────────────────────

def test_points_formula():
    assert points_for(20, "easy") == 20
    assert points_for(25, "medium") == 38      # 37.5 rounds up
    assert points_for(30, "medium") == 45
    assert points_for(30, "hard") == 60
    assert points_for(15, "easy") == 15


def test_completing_awards_the_right_points(fake, client):
    r = complete(client, NOON, TODAY, ALEX)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "done": True, "points": 38}
    assert fake.completions[(NOON, TODAY.isoformat())]["completed_by"] == ALEX
    assert fake.completions[(NOON, TODAY.isoformat())]["points_awarded"] == 38


def test_custom_points_value_is_ignored(fake, client):
    r = complete(client, NOON, TODAY, ALEX, points=9999, points_awarded=9999)
    assert r.status_code == 200, r.text
    assert r.json()["points"] == 38
    inserts = [b for m, path, _, b in fake.writes if m == "POST" and path == "chore_completions"]
    assert inserts == [{"chore_id": NOON, "date": TODAY.isoformat(), "completed_by": ALEX, "points_awarded": 38}]
    # A top-level points field outside the payload is ignored too.
    fake.completions.clear()
    r = client.post("/chores/submit", json={"change_type": "completion_set", "points_awarded": 5000, "payload": {
        "chore_id": NOON, "date": TODAY.isoformat(), "done": True, "member_id": ALEX}})
    assert r.json()["points"] == 38


def test_no_change_type_can_set_points(fake, client):
    for kind in ("points_set", "points_adjust", "streak_set", "score_reset", "member_add", "member_edit"):
        assert submit(client, kind, {"member_id": ALEX, "points": 100}).status_code == 400


def test_unchecking_removes_the_completion(fake, client):
    complete(client, NOON, TODAY, ALEX)
    r = complete(client, NOON, TODAY, ALEX, done=False)
    assert r.status_code == 200
    assert (NOON, TODAY.isoformat()) not in fake.completions


def test_checking_twice_does_not_double_award(fake, client):
    complete(client, NOON, TODAY, ALEX)
    r = complete(client, NOON, TODAY, ALEX)
    assert r.json()["points"] == 38 and r.json()["already"] is True
    assert len(fake.completions) == 1


# ── Completion rules ─────────────────────────────────────────────────────────

def test_anyone_can_claim_an_open_chore(fake, client):
    assert complete(client, BATH, TODAY, ALEX).json()["points"] == 60
    assert fake.completions[(BATH, TODAY.isoformat())]["completed_by"] == ALEX


def test_claimed_chore_is_taken(fake, client):
    complete(client, BATH, TODAY, NATHAN)
    assert complete(client, BATH, TODAY, ALEX).status_code == 403
    assert fake.completions[(BATH, TODAY.isoformat())]["completed_by"] == NATHAN


def test_unknown_member_cannot_claim(fake, client):
    assert complete(client, NOON, TODAY, "66666666-6666-4666-8666-666666666666").status_code == 400


def test_cannot_uncheck_someone_elses_task(fake, client):
    complete(client, BATH, TODAY, NATHAN)
    assert complete(client, BATH, TODAY, ALEX, done=False).status_code == 403
    assert (BATH, TODAY.isoformat()) in fake.completions


def test_yesterday_allowed_future_and_older_rejected(fake, client):
    assert complete(client, NOON, YESTERDAY, NATHAN).status_code == 200
    assert complete(client, NOON, TODAY + timedelta(days=1), ALEX).status_code == 409
    assert complete(client, NOON, TODAY - timedelta(days=2), ALEX).status_code == 409


def test_unscheduled_day_rejected(fake, client):
    assert complete(client, BATH, YESTERDAY, NATHAN).status_code == 409


# ── Other changes apply immediately ──────────────────────────────────────────

def test_assignments_and_rotation_are_gone(fake, client):
    assert submit(client, "assignment_set", {"chore_id": BATH, "date": TODAY.isoformat(),
                                             "member_id": ALEX}).status_code == 400
    assert submit(client, "rotation_toggle", {"rotation_enabled": False}).status_code == 400


def test_delete_is_soft(fake, client):
    assert submit(client, "chore_delete", target_id=NOON).status_code == 200
    assert not any(m == "DELETE" and p == "chores" for m, p, _, _ in fake.writes)
    patch = [b for m, p, _, b in fake.writes if m == "PATCH" and p == "chores"][0]
    assert patch == {"active": False, "retired_on": TODAY.isoformat()}


CHORE = {"title": "Mop Floors", "frequency": "weekly", "zone": "General", "minutes": 25,
         "difficulty": "medium", "preferred_weekday": 6, "description": "", "time_of_day": None,
         "allowed_member_ids": None}


def test_edit_minutes_updates_in_place(fake, client):
    fake.chores[NOON].update(frequency="weekly", preferred_weekday=6)
    r = submit(client, "chore_edit", {**CHORE, "minutes": 40, "points_awarded": 1}, target_id=NOON)
    assert r.status_code == 200, r.text
    patch = [b for m, p, _, b in fake.writes if m == "PATCH" and p == "chores"][0]
    assert patch["minutes"] == 40 and "points_awarded" not in patch


def test_edit_schedule_starts_new_version_tomorrow(fake, client):
    r = submit(client, "chore_edit", CHORE, target_id=NOON)   # daily → weekly
    assert r.status_code == 200, r.text
    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    assert r.json()["starts_on"] == tomorrow
    retire = [b for m, p, _, b in fake.writes if m == "PATCH" and p == "chores"][0]
    assert retire == {"active": False, "retired_on": tomorrow}


def test_chore_validation(fake, client):
    assert submit(client, "chore_add", {**CHORE, "difficulty": "insane"}).status_code == 400
    assert submit(client, "chore_add", {**CHORE, "time_of_day": "25:00"}).status_code == 400
    r = submit(client, "chore_add", {**CHORE, "time_of_day": "19:00", "allowed_member_ids": [ALEX]})
    assert r.status_code == 200, r.text
    insert = [b for m, p, _, b in fake.writes if m == "POST" and p == "chores"][0]
    assert insert["time_of_day"] == "19:00:00" and insert["starts_on"] == TODAY.isoformat()
    assert insert["allowed_member_ids"] is None   # every chore is open to everyone


def test_review_endpoint_is_gone(client):
    assert client.post("/chores/review", json={}).status_code in (404, 405)


def test_rate_limit_per_ip(fake, client):
    codes = [submit(client, "reset_defaults").status_code for _ in range(21)]
    assert codes[:20] == [200] * 20 and codes[20] == 429


# ── America/New_York day boundary ────────────────────────────────────────────

@pytest.mark.parametrize("utc, expected", [
    ("2026-10-21T03:59:00", "2026-10-20"),   # EDT: 23:59 on the 20th
    ("2026-10-21T04:00:00", "2026-10-21"),
    ("2026-12-01T04:59:00", "2026-11-30"),   # EST
    ("2026-12-01T05:00:00", "2026-12-01"),
    ("2026-03-08T06:59:00", "2026-03-08"),   # DST starts 2026-03-08 07:00 UTC
    ("2026-11-01T05:30:00", "2026-11-01"),   # still EDT (01:30)
    ("2026-11-01T06:30:00", "2026-11-01"),   # EST again (01:30)
])
def test_ny_today(utc, expected):
    now = datetime.fromisoformat(utc).replace(tzinfo=timezone.utc)
    assert ny_today(now).isoformat() == expected


# ── Extreme tier / points_override ───────────────────────────────────────────

def test_points_override_replaces_formula():
    assert points_for(30, "extreme", 75) == 75
    assert points_for(30, "medium", None) == 45


def test_evening_kitchen_awards_exactly_75(fake, client):
    r = complete(client, EVENING, TODAY, ALEX)
    assert r.status_code == 200, r.text
    assert r.json()["points"] == 75
    assert fake.completions[(EVENING, TODAY.isoformat())]["points_awarded"] == 75


def test_extreme_chore_gets_fixed_override_not_client_value(fake, client):
    r = submit(client, "chore_add", {**CHORE, "difficulty": "extreme", "points_override": 9999})
    assert r.status_code == 200, r.text
    insert = [b for m, p, _, b in fake.writes if m == "POST" and p == "chores"][0]
    assert insert["difficulty"] == "extreme" and insert["points_override"] == 75
    fake.writes.clear()
    submit(client, "chore_add", {**CHORE, "points_override": 9999})
    insert = [b for m, p, _, b in fake.writes if m == "POST" and p == "chores"][0]
    assert insert["points_override"] is None


def test_past_completion_keeps_recorded_points(fake, client):
    complete(client, NOON, TODAY, ALEX)
    fake.chores[NOON].update(difficulty="extreme", points_override=75)
    assert fake.completions[(NOON, TODAY.isoformat())]["points_awarded"] == 38


# ── Chat ─────────────────────────────────────────────────────────────────────

def chat(client, body, member=ALEX):
    return client.post("/chores/chat", json={"member_id": member, "body": body})


def test_chat_trims_and_stores(fake, client):
    r = chat(client, "   hello family  \n")
    assert r.status_code == 200, r.text
    assert fake.messages[0]["body"] == "hello family" and fake.messages[0]["member_id"] == ALEX


def test_chat_length_cap(fake, client):
    assert chat(client, "x" * 500).status_code == 200
    assert chat(client, "  " + "x" * 500 + "  ").status_code == 200   # trimmed first
    r = chat(client, "x" * 501)
    assert r.status_code == 400 and "500" in r.json()["error"]
    assert len(fake.messages) == 2


def test_chat_rejects_empty(fake, client):
    for body in ("", "   ", "\n\t ", None, 42):
        assert chat(client, body).status_code == 400
    assert fake.messages == []


def test_chat_rejects_unknown_member(fake, client):
    assert chat(client, "hi", member="66666666-6666-4666-8666-666666666666").status_code == 400
    assert chat(client, "hi", member="nope").status_code == 400


def test_chat_rate_limit(fake, client):
    codes = [chat(client, f"msg {i}").status_code for i in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429
    assert len(fake.messages) == 10


def test_chat_html_is_kept_as_plain_text(fake, client):
    html = '<img src=x onerror="alert(1)"><b>hi</b>'
    r = chat(client, html)
    assert r.status_code == 200
    # Stored verbatim (not stripped, not interpreted); the UI renders it as text
    # (see frontend/src/chores/chat.test.js).
    assert fake.messages[0]["body"] == html
    assert r.json()["message"]["body"] == html


# ── Shop ─────────────────────────────────────────────────────────────────────

def shop(client, action, item_id=None, member=ALEX, **extra):
    return client.post("/chores/shop", json={"action": action, "member_id": member, "item_id": item_id, **extra})


def test_buy_uses_server_price(fake, client):
    r = shop(client, "buy", "theme-ocean", price=0)
    assert r.status_code == 200, r.text
    assert r.json()["coins"] == 85
    rpc = [b for m, p, _, b in fake.writes if p == "rpc/chore_buy"][0]
    assert rpc == {"p_member": ALEX, "p_item": "theme-ocean", "p_price": 15}


def test_buy_rules(fake, client):
    assert shop(client, "buy", "theme-ocean", member=NATHAN).status_code == 409   # 0 coins
    assert shop(client, "buy", "free-everything").status_code == 400
    assert shop(client, "buy", "theme-ocean").status_code == 200
    assert shop(client, "buy", "theme-ocean").status_code == 409                  # already owned
    assert shop(client, "refund", "theme-ocean").status_code == 400


def test_equip_requires_ownership(fake, client):
    assert shop(client, "equip", "avatar-fox").status_code == 403
    shop(client, "buy", "avatar-fox")
    assert shop(client, "equip", "avatar-fox").status_code == 200
    upsert = [b for m, p, _, b in fake.writes if p == "chore_member_cosmetics"][-1]
    assert upsert["avatar"] == "avatar-fox" and upsert["member_id"] == ALEX
    assert shop(client, "equip", None, slot="avatar").status_code == 200
    assert [b for m, p, _, b in fake.writes if p == "chore_member_cosmetics"][-1]["avatar"] is None
    assert shop(client, "equip", None, slot="points").status_code == 400


def test_shop_catalog_matches_frontend():
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[2] / "frontend/src/chores/shop.js").read_text(encoding="utf-8")
    front = {m[0]: int(m[1]) for m in re.findall(r"id: '([^']+)'[^}]*?price: (\d+)", src)}
    assert front == {k: v[1] for k, v in chore_routes.SHOP_ITEMS.items()}
