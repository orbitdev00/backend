"""
Tests for /usage endpoint and daily analysis counter rate limiting.

Hits the live backend at https://backend-production-a427a.up.railway.app.
Uses SUPABASE_URL + SUPABASE_SERVICE_KEY to write/tear-down test fixtures
directly in user_reputation. All test rows use fixed UUIDs with an
0xffff... prefix so they are clearly non-production data.

Required env vars:
    SUPABASE_URL            — your Supabase project URL
    SUPABASE_SERVICE_KEY    — service-role key (bypasses RLS)

Optional env vars (Test 6 only):
    TEST_USER_ID            — UUID of an existing Supabase auth user
    TEST_MINT               — valid Solana mint address to analyze
                              (defaults to USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)

Response shape returned by /usage:
    { count, limit, remaining, tier, unlimited }
    "blocked" is derived: remaining == 0
"""
import os
import time
import pytest
import httpx
from datetime import datetime, timezone, timedelta

BASE_URL = "https://backend-production-a427a.up.railway.app"

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    pytest.skip(
        "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set",
        allow_module_level=True,
    )

SB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}

FREE_USER_ID  = "ffffffff-ffff-0000-0000-000000000001"
DEGEN_USER_ID = "ffffffff-ffff-0000-0000-000000000002"
OMEGA_USER_ID = "ffffffff-ffff-0000-0000-000000000003"
ALL_TEST_IDS  = [FREE_USER_ID, DEGEN_USER_ID, OMEGA_USER_ID]

TEST_USER_ID  = os.environ.get("TEST_USER_ID", "")
TEST_MINT     = os.environ.get("TEST_MINT", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _yesterday() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")


def _upsert(row: dict):
    with httpx.Client(timeout=10) as c:
        r = c.post(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            json=row,
            headers={**SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        assert r.status_code in (200, 201), f"upsert failed {r.status_code}: {r.text}"


def _delete(user_id: str):
    with httpx.Client(timeout=10) as c:
        c.delete(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"user_id": f"eq.{user_id}"},
            headers=SB_HEADERS,
        )


@pytest.fixture(autouse=True)
def cleanup():
    yield
    for uid in ALL_TEST_IDS:
        _delete(uid)


# ── Test 1: Free user — under limit ───────────────────────────────────────────

def test_free_user_under_limit():
    _upsert({"user_id": FREE_USER_ID, "tier": "free",
             "daily_analysis_count": 2, "daily_reset_date": _today()})

    r = httpx.get(f"{BASE_URL}/usage?user_id={FREE_USER_ID}", timeout=10)
    assert r.status_code == 200
    data = r.json()

    assert data["count"] == 2
    assert data["limit"] == 5
    assert data["remaining"] == 3
    assert data["unlimited"] is False


# ── Test 2: Free user — at limit (blocked) ────────────────────────────────────

def test_free_user_at_limit():
    _upsert({"user_id": FREE_USER_ID, "tier": "free",
             "daily_analysis_count": 5, "daily_reset_date": _today()})

    r = httpx.get(f"{BASE_URL}/usage?user_id={FREE_USER_ID}", timeout=10)
    assert r.status_code == 200
    data = r.json()

    assert data["count"] == 5
    assert data["limit"] == 5
    assert data["remaining"] == 0
    assert data["unlimited"] is False
    # blocked is derived from remaining == 0
    assert data["remaining"] == 0


# ── Test 3: Degen — no limit ──────────────────────────────────────────────────

def test_degen_unlimited():
    _upsert({"user_id": DEGEN_USER_ID, "tier": "degen",
             "daily_analysis_count": 99, "daily_reset_date": _today()})

    r = httpx.get(f"{BASE_URL}/usage?user_id={DEGEN_USER_ID}", timeout=10)
    assert r.status_code == 200
    data = r.json()

    assert data["unlimited"] is True
    assert data["tier"] == "degen"


# ── Test 4: Omega — no limit ──────────────────────────────────────────────────

def test_omega_unlimited():
    _upsert({"user_id": OMEGA_USER_ID, "tier": "omega",
             "daily_analysis_count": 99, "daily_reset_date": _today()})

    r = httpx.get(f"{BASE_URL}/usage?user_id={OMEGA_USER_ID}", timeout=10)
    assert r.status_code == 200
    data = r.json()

    assert data["unlimited"] is True
    assert data["tier"] == "omega"


# ── Test 5: Daily reset — stale date returns 0 and persists ──────────────────

def test_daily_reset():
    _upsert({"user_id": FREE_USER_ID, "tier": "free",
             "daily_analysis_count": 4, "daily_reset_date": _yesterday()})

    r = httpx.get(f"{BASE_URL}/usage?user_id={FREE_USER_ID}", timeout=10)
    assert r.status_code == 200
    data = r.json()

    assert data["count"] == 0, "stale daily_reset_date must return count 0"
    assert data["remaining"] == 5

    # Second call should also return 0 (reset was persisted, not just in-memory)
    r2 = httpx.get(f"{BASE_URL}/usage?user_id={FREE_USER_ID}", timeout=10)
    assert r2.json()["count"] == 0, "reset should be persisted to DB"


# ── Test 6: Counter increments after /analyze ─────────────────────────────────
# Requires TEST_USER_ID env var (must be a real Supabase auth user).
# Calls the live /analyze endpoint — external APIs (Helius, DexScreener) must
# be reachable. consume_rate_limit runs as a background task so we wait 3s.

@pytest.mark.skipif(
    not TEST_USER_ID,
    reason="TEST_USER_ID env var required for counter-increment test",
)
def test_counter_increments_after_analyze():
    # Seed a known starting count for this user
    _upsert({"user_id": TEST_USER_ID, "tier": "free",
             "daily_analysis_count": 1, "daily_reset_date": _today()})
    ALL_TEST_IDS.append(TEST_USER_ID)

    r0 = httpx.get(f"{BASE_URL}/usage?user_id={TEST_USER_ID}", timeout=10)
    before = r0.json()["count"]
    assert before == 1

    # Fire analysis — counter is incremented as a background task on success
    ra = httpx.get(
        f"{BASE_URL}/analyze/{TEST_MINT}",
        params={"user_id": TEST_USER_ID},
        timeout=60,
    )
    assert ra.status_code == 200, f"/analyze returned {ra.status_code}: {ra.text[:200]}"

    # Wait for background consume_rate_limit task to write to Supabase
    time.sleep(3)

    r1 = httpx.get(f"{BASE_URL}/usage?user_id={TEST_USER_ID}", timeout=10)
    after = r1.json()["count"]

    assert after == before + 1, f"expected count {before + 1}, got {after}"
