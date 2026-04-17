"""
Dev wallet history tracker.
Uses Helius enriched transactions to find all tokens the dev wallet
has previously launched on Pump.fun, and checks how many rugged.
"""
import httpx
import asyncio
from config import HELIUS_API_KEY, HELIUS_API_URL

PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"


async def fetch_dev_history(dev_wallet: str) -> dict:
    if not dev_wallet:
        return _empty()

    try:
        prev_coins = await _get_previous_launches(dev_wallet)
        if not prev_coins:
            return _empty()

        # Analyze each coin for rug behavior
        rug_count   = 0
        total_count = len(prev_coins)
        rug_times   = []

        async with httpx.AsyncClient(timeout=15) as client:
            tasks = [_check_coin_outcome(client, mint, dev_wallet) for mint in prev_coins[:8]]
            results = await asyncio.gather(*tasks, return_exceptions=True)

        for r in results:
            if isinstance(r, dict) and r.get("rugged"):
                rug_count += 1
                if r.get("time_to_rug_minutes"):
                    rug_times.append(r["time_to_rug_minutes"])

        avg_rug_time = round(sum(rug_times) / len(rug_times)) if rug_times else None
        rug_rate     = round(rug_count / total_count * 100) if total_count > 0 else 0

        # Build summary line
        if total_count == 0:
            summary = "First coin from this dev"
        elif rug_count == 0:
            summary = f"Dev launched {total_count} coin{'s' if total_count > 1 else ''} — no rugs detected"
        elif avg_rug_time:
            hrs = avg_rug_time // 60
            mins = avg_rug_time % 60
            time_str = f"{hrs}h {mins}m" if hrs > 0 else f"{mins}m"
            summary = f"Dev launched {total_count} coins — {rug_count} rugged (avg {time_str})"
        else:
            summary = f"Dev launched {total_count} coins — {rug_count} rugged"

        return {
            "dev_prev_launches":    total_count,
            "dev_prev_rugs":        rug_count,
            "dev_rug_rate_pct":     rug_rate,
            "dev_avg_rug_minutes":  avg_rug_time,
            "dev_history_summary":  summary,
            "dev_is_serial_rugger": rug_count >= 2 and rug_rate >= 50,
        }

    except Exception as e:
        print(f"[DevHistory] Error: {e}")
        return _empty()


async def _get_previous_launches(dev_wallet: str) -> list:
    """Get mints of tokens previously created by this dev wallet."""
    url = f"{HELIUS_API_URL}/addresses/{dev_wallet}/transactions"
    params = {
        "api-key": HELIUS_API_KEY,
        "limit": 50,
        "type": "CREATE_POOL",
    }
    mints = []
    async with httpx.AsyncClient(timeout=12) as client:
        try:
            resp = await client.get(url, params=params)
            txs  = resp.json() or []
            for tx in txs:
                # Look for token mint in token transfers
                for transfer in (tx.get("tokenTransfers") or []):
                    mint = transfer.get("mint", "")
                    if mint and mint not in mints and mint.endswith("pump"):
                        mints.append(mint)
        except Exception:
            pass

    # Also check SWAP transactions for coins they launched
    params["type"] = "SWAP"
    async with httpx.AsyncClient(timeout=12) as client:
        try:
            resp = await client.get(url, params=params)
            txs  = resp.json() or []
            seen_mints = set()
            for tx in txs[:30]:
                swap = (tx.get("events") or {}).get("swap", {})
                if not swap:
                    continue
                for out in swap.get("tokenOutputs", []):
                    mint = out.get("mint", "")
                    if mint and mint not in mints and mint not in seen_mints:
                        seen_mints.add(mint)
                        mints.append(mint)
        except Exception:
            pass

    return list(set(mints))[:10]


async def _check_coin_outcome(client: httpx.AsyncClient, mint: str, dev_wallet: str) -> dict:
    """Check if a coin rugged by looking at price change and dev sell activity."""
    try:
        resp = await client.get(
            f"https://api.dexscreener.com/latest/dex/tokens/{mint}",
            timeout=8
        )
        pairs = (resp.json().get("pairs") or [])
        sol_pairs = [p for p in pairs if p.get("chainId") == "solana"]
        if not sol_pairs:
            return {"rugged": False}

        pair = max(sol_pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)
        change_24h = float((pair.get("priceChange") or {}).get("h24") or 0)
        liquidity  = float((pair.get("liquidity") or {}).get("usd") or 0)

        # Rug signals: down 80%+ in 24h OR near-zero liquidity
        rugged = change_24h < -80 or (liquidity < 500 and change_24h < -50)

        # Estimate time to rug from pair created timestamp
        created = pair.get("pairCreatedAt")
        rug_minutes = None
        if rugged and created:
            import time
            age_minutes = (time.time() - created / 1000) / 60
            if age_minutes < 1440:  # within 24h
                rug_minutes = int(age_minutes)

        return {"rugged": rugged, "time_to_rug_minutes": rug_minutes}
    except Exception:
        return {"rugged": False}


def _empty() -> dict:
    return {
        "dev_prev_launches":    0,
        "dev_prev_rugs":        0,
        "dev_rug_rate_pct":     0,
        "dev_avg_rug_minutes":  None,
        "dev_history_summary":  "No history found",
        "dev_is_serial_rugger": False,
    }
