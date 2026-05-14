"""
ORBIT Outcome Recorder
=======================
Fetches current MC from DexScreener for all unresolved predictions
and records actual_peak_mc in Supabase so accuracy_test.py can score them.

A prediction is considered "resolved" when the coin is old enough
that its price trajectory is mostly complete (>= 24h old at analysis time).

Run from backend/:
  python ml/record_outcomes.py
"""

import os, sys, json, asyncio, time
import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import SUPABASE_URL, SUPABASE_ANON_KEY

HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}
DEX_BATCH = 30   # DexScreener allows up to 30 addresses per call
MIN_AGE_H = 24   # only resolve predictions >= 24h old


async def fetch_unresolved(client):
    r = await client.get(
        f"{SUPABASE_URL}/rest/v1/predictions",
        params={
            "select": "id,mint,name,symbol,market_cap_at_analysis,estimated_peak_mc,snapshot_timestamp",
            "actual_peak_mc": "is.null",
            "order": "snapshot_timestamp.asc",
            "limit": "500",
        },
        headers=HEADERS,
    )
    r.raise_for_status()
    rows = r.json()

    # Filter to only old enough coins
    now = time.time()
    eligible = []
    for row in rows:
        ts = row.get("snapshot_timestamp")
        if not ts:
            continue
        try:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
            if age_h >= MIN_AGE_H:
                eligible.append(row)
        except Exception:
            continue
    return eligible


async def fetch_dex(client, mints):
    """Fetch current MC from DexScreener for up to 30 mints."""
    addresses = ",".join(mints)
    try:
        r = await client.get(
            f"https://api.dexscreener.com/latest/dex/tokens/{addresses}",
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        pairs = data.get("pairs") or []
        # Group by base token address, take highest MC pair (main liquidity)
        mc_by_mint = {}
        for p in pairs:
            mint = (p.get("baseToken") or {}).get("address", "").lower()
            mc   = p.get("fdv") or p.get("marketCap") or 0
            if mint and mc:
                mc_by_mint[mint] = max(mc_by_mint.get(mint, 0), mc)
        return mc_by_mint
    except Exception as e:
        print(f"  DexScreener error: {e}")
        return {}


async def record_outcome(client, row_id, actual_peak_mc, prediction_accurate):
    await client.patch(
        f"{SUPABASE_URL}/rest/v1/predictions",
        params={"id": f"eq.{row_id}"},
        headers=HEADERS,
        json={
            "actual_peak_mc":      actual_peak_mc,
            "prediction_accurate": prediction_accurate,
            "outcome_recorded_at": "now()",
        },
    )


async def main():
    print("\nORBIT Outcome Recorder")
    print(f"Resolving predictions >= {MIN_AGE_H}h old with no actual_peak_mc\n")

    async with httpx.AsyncClient(timeout=30) as client:
        unresolved = await fetch_unresolved(client)
        print(f"Found {len(unresolved)} unresolved eligible predictions")

        if not unresolved:
            print("Nothing to resolve. Run accuracy_test.py to score the model.")
            return

        # Batch into groups of DEX_BATCH
        batches = [unresolved[i:i+DEX_BATCH] for i in range(0, len(unresolved), DEX_BATCH)]
        recorded = 0
        dead     = 0
        skipped  = 0

        for batch in batches:
            mints    = [r["mint"].lower() for r in batch if r.get("mint")]
            mc_map   = await fetch_dex(client, mints)
            await asyncio.sleep(0.5)  # rate limit

            for row in batch:
                mint = (row.get("mint") or "").lower()
                mc_at = row.get("market_cap_at_analysis") or 0
                est   = row.get("estimated_peak_mc") or 0

                current_mc = mc_map.get(mint)

                if current_mc is None:
                    # Not found on DexScreener — coin is likely dead/delisted
                    # Record as 0 (dead) if it was analyzed at > $5K MC
                    if mc_at > 5000:
                        current_mc = mc_at * 0.05  # assume 95% collapse
                        dead += 1
                    else:
                        skipped += 1
                        continue

                # Prediction accurate = actual >= 80% of estimated peak
                accurate = current_mc >= est * 0.8 if est > 0 else None

                await record_outcome(client, row["id"], current_mc, accurate)
                recorded += 1

                status = "dead" if mc_map.get(mint) is None else f"${current_mc:,.0f}"
                print(f"  {row.get('symbol','?'):>8}  MC@analysis: ${mc_at:>10,.0f}  current: {status:>14}  accurate: {accurate}")

        print(f"\nDone. Recorded: {recorded}  Dead coins: {dead}  Skipped: {skipped}")
        print("Run python ml/accuracy_test.py to score the model.")


if __name__ == "__main__":
    asyncio.run(main())
