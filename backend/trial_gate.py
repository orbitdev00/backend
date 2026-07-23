"""
Free trial gate — checks and records fingerprint usage.
One analysis per fingerprint, enforced server-side.
"""
import httpx
from config import SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY

# Use the service key so trial_uses can be locked down with RLS (no client
# policies). With the anon key a guest could delete/forge their own trial_uses
# rows via the REST API and farm unlimited "free" analyses.
_KEY = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
HEADERS = {
    "apikey": _KEY,
    "Authorization": f"Bearer {_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


async def check_trial(fingerprint: str) -> bool:
    """Returns True if fingerprint has NOT used trial yet."""
    if not fingerprint or len(fingerprint) < 8:
        return False
    async with httpx.AsyncClient(timeout=8) as client:
        try:
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/trial_uses",
                params={"fingerprint": f"eq.{fingerprint}", "select": "id"},
                headers=HEADERS,
            )
            data = resp.json()
            return len(data) == 0  # No record = trial available
        except Exception as e:
            print(f"[TrialGate] check error: {e}")
            return False


async def consume_trial(fingerprint: str, mint: str, ip_hint: str = "") -> bool:
    """Records trial use. Returns True on success."""
    async with httpx.AsyncClient(timeout=8) as client:
        try:
            resp = await client.post(
                f"{SUPABASE_URL}/rest/v1/trial_uses",
                json={
                    "fingerprint": fingerprint,
                    "mint": mint,
                    "ip_hint": ip_hint[:8] if ip_hint else "",  # store only first 8 chars
                },
                headers=HEADERS,
            )
            return resp.status_code in (200, 201)
        except Exception as e:
            print(f"[TrialGate] consume error: {e}")
            return False
