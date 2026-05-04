"""
pnl_sync.py — Nightly PnL sync for all users with wallets
Run via Railway cron: python pnl_sync.py
Or call sync_all_wallets() from main.py on a schedule.
"""
import asyncio
import httpx
from datetime import datetime, timezone
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY
from aggregator.pnl import fetch_monthly_pnl

KEY = SUPABASE_SERVICE_KEY
HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


async def _get_users_with_wallets() -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"select": "user_id,wallet_address", "wallet_address": "not.is.null"},
            headers={**HEADERS, "Prefer": "return=representation"},
        )
        if resp.status_code == 200:
            return [r for r in resp.json() if r.get("wallet_address")]
        print(f"[PnL Sync] Failed to fetch users: {resp.status_code}")
        return []


async def _update_user_pnl(user_id: str, pnl_data: dict):
    if pnl_data.get("total_pnl_pct") is None:
        return
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(
            f"{SUPABASE_URL}/rest/v1/user_reputation",
            params={"user_id": f"eq.{user_id}"},
            json={
                "total_pnl_pct": pnl_data["total_pnl_pct"],
                "trade_count":   pnl_data.get("trade_count", 0),
                "tokens_traded": pnl_data.get("tokens_traded", 0),
                "pnl_updated_at": datetime.now(timezone.utc).isoformat(),
            },
            headers=HEADERS,
        )
        if resp.status_code in (200, 204):
            print(f"[PnL Sync] Updated {user_id[:8]}... pnl={pnl_data['total_pnl_pct']}")
        else:
            print(f"[PnL Sync] Update failed for {user_id[:8]}: {resp.status_code}")


async def sync_all_wallets():
    print(f"[PnL Sync] Starting sync — {datetime.now(timezone.utc).isoformat()}")
    users = await _get_users_with_wallets()
    print(f"[PnL Sync] {len(users)} users with wallets")

    for user in users:
        user_id = user["user_id"]
        wallet  = user["wallet_address"]
        print(f"[PnL Sync] Processing {user_id[:8]}... wallet={wallet[:8]}...")
        try:
            pnl = await fetch_monthly_pnl(wallet)
            await _update_user_pnl(user_id, pnl)
        except Exception as e:
            print(f"[PnL Sync] Error for {user_id[:8]}: {e}")
        # Small delay between users to avoid RPC rate limits
        await asyncio.sleep(2)

    print(f"[PnL Sync] Done — {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    asyncio.run(sync_all_wallets())
