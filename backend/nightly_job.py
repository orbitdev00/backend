"""
Outcome tracker — run this as often as possible (hourly via Task Scheduler).
Resolves predictions once coins have clearly peaked or died.
"""
import asyncio, httpx, time
from config import SUPABASE_URL, SUPABASE_ANON_KEY, DEXSCREENER_API

HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Content-Type": "application/json",
}


async def run_nightly_job():
    print(f"[Job] Starting at {time.strftime('%Y-%m-%d %H:%M:%S')}")

    predictions = await _get_unresolved()
    print(f"[Job] Found {len(predictions)} unresolved predictions")

    if not predictions:
        print("[Job] Nothing to process.")
        return

    resolved = updated = skipped = 0

    async with httpx.AsyncClient(timeout=15) as client:
        for pred in predictions:
            try:
                r = await _process(client, pred)
                if r == "resolved": resolved += 1
                elif r == "updated": updated += 1
                else: skipped += 1
                await asyncio.sleep(0.3)
            except Exception as e:
                print(f"[Job] Error {pred.get('mint','')[:8]}: {e}")

    print(f"[Job] Done. Resolved: {resolved} | Updated: {updated} | Skipped: {skipped}")


async def _get_unresolved() -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/predictions",
            params={
                "actual_peak_mc": "is.null",
                "select": "id,mint,symbol,name,estimated_peak_mc,market_cap_at_analysis,snapshot_timestamp,highest_mc_seen",
                "order": "snapshot_timestamp.asc",
                "limit": "500",
            },
            headers=HEADERS,
        )
        return resp.json() if resp.status_code == 200 else []


async def _process(client: httpx.AsyncClient, pred: dict) -> str:
    mint         = pred.get("mint", "")
    pred_id      = pred.get("id")
    snapshot_ts  = pred.get("snapshot_timestamp") or 0
    highest_seen = float(pred.get("highest_mc_seen") or pred.get("market_cap_at_analysis") or 0)
    age_hours    = (time.time() - snapshot_ts) / 3600 if snapshot_ts else 9999

    # Force-resolve only truly invalid entries (no mint or placeholder)
    if not mint or mint.lower() in ("test", "") or len(mint) < 20:
        await _resolve(pred_id, 0, 0, f"Force-resolved: invalid mint")
        print(f"[Job] ✗ Force-resolved invalid entry: {pred.get('name','?')}")
        return "resolved"

    current_mc, high_24h = await _fetch_mc(client, mint)

    # Coin is dead / not on DexScreener anymore
    if current_mc <= 0 and high_24h <= 0:
        if age_hours > 24:
            # Dead coin — resolve with whatever highest we saw
            await _resolve(pred_id, highest_seen, highest_seen, f"Resolved: no DexScreener data after {age_hours:.0f}h")
            print(f"[Job] ✗ Dead coin resolved: {pred.get('symbol','?')}")
            return "resolved"
        return "skip"

    new_highest = max(highest_seen, current_mc, high_24h)
    peaked      = False

    if new_highest > 0 and current_mc > 0:
        drop = (new_highest - current_mc) / new_highest * 100
        # Tighter thresholds — memecoins peak fast
        if age_hours > 6  and drop >= 60: peaked = True
        if age_hours > 12 and drop >= 45: peaked = True
        if age_hours > 24 and drop >= 35: peaked = True
        if age_hours > 48 and drop >= 25: peaked = True

    if age_hours > 72:
        peaked = True  # Force after 3 days no matter what

    if peaked:
        estimated = float(pred.get("estimated_peak_mc") or 0)
        accurate  = None
        if estimated > 0 and new_highest > 0:
            error_pct = abs(estimated - new_highest) / new_highest * 100
            accurate  = error_pct <= 50
        drop_pct = (new_highest - current_mc) / new_highest * 100 if new_highest > 0 else 0
        await _resolve(pred_id, new_highest, new_highest,
                       f"Resolved after {age_hours:.1f}h. Drop: {drop_pct:.0f}%")
        print(f"[Job] ✓ {pred.get('symbol','?'):10} peak: ${new_highest:>10,.0f} | predicted: ${estimated:>10,.0f} | {'✓' if accurate else '✗'}")

        # If confirmed rug (dropped >60%), record top holders for cross-coin tracking
        if drop_pct >= 60:
            top_holders = pred.get("top_holders_json") or []
            if top_holders:
                await record_rug_wallets(mint, top_holders)

        return "resolved"

    # Update watermark
    await _patch(pred_id, {"highest_mc_seen": new_highest})
    return "updated"


async def _resolve(pred_id, highest, actual, note):
    estimated = None
    accurate  = None
    await _patch(pred_id, {
        "highest_mc_seen":     highest,
        "actual_peak_mc":      actual,
        "outcome_recorded_at": "now()",
        "prediction_accurate": accurate,
        "notes":               note,
    })


async def _fetch_mc(client, mint):
    try:
        resp = await client.get(f"{DEXSCREENER_API}/tokens/{mint}", timeout=10)
        if resp.status_code != 200: return 0, 0
        pairs = [p for p in (resp.json().get("pairs") or []) if p.get("chainId") == "solana"]
        if not pairs: return 0, 0
        pairs.sort(key=lambda p: (p.get("liquidity") or {}).get("usd") or 0, reverse=True)
        pair       = pairs[0]
        current_mc = float(pair.get("marketCap") or pair.get("fdv") or 0)
        price_usd  = float(pair.get("priceUsd") or 0)
        change_24h = float((pair.get("priceChange") or {}).get("h24") or 0)
        high_24h   = (current_mc / (1 + change_24h / 100)) if price_usd > 0 and change_24h < 0 else 0
        return current_mc, high_24h
    except Exception:
        return 0, 0


async def _patch(pred_id, data):
    async with httpx.AsyncClient(timeout=10) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/predictions",
            params={"id": f"eq.{pred_id}"},
            json=data,
            headers=HEADERS,
        )


if __name__ == "__main__":
    asyncio.run(run_nightly_job())
