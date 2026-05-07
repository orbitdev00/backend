"""
moralis.py — Ethereum token holder data via Moralis API
Free tier includes getTokenOwners — top holders for any ERC-20
"""
import httpx
import os
from aggregator.cache import get as cache_get, set as cache_set

MORALIS_API = "https://deep-index.moralis.io/api/v2.2"
TTL = 60


def _key() -> str:
    return os.getenv("MORALIS_API_KEY", "")


async def fetch_moralis_holders(contract: str) -> dict:
    cached = cache_get(f"moralis:{contract}", TTL)
    if cached:
        return cached

    key = _key()
    if not key:
        print("[Moralis] No API key — skipping")
        return _empty()

    headers = {"X-API-Key": key, "accept": "application/json"}

    async with httpx.AsyncClient(timeout=12) as client:
        # 1. Token metadata (supply, decimals, deployer)
        deployer = ""
        total_supply = 1
        decimals = 18
        try:
            r = await client.get(
                f"{MORALIS_API}/erc20/metadata",
                params={"chain": "eth", "addresses[0]": contract},
                headers=headers,
            )
            meta_list = r.json() if r.status_code == 200 else []
            meta = meta_list[0] if isinstance(meta_list, list) and meta_list else {}
            decimals = int(meta.get("decimals") or 18)
            raw_supply = meta.get("total_supply") or "0"
            total_supply = max(1, int(raw_supply) / (10 ** decimals))
            deployer = meta.get("deployer_address") or ""
            print(f"[Moralis] {contract[:10]} supply={total_supply:.0f} decimals={decimals} deployer={deployer[:10] if deployer else 'none'}")
        except Exception as e:
            print(f"[Moralis] metadata error: {e}")

        # 2. Top token holders
        top_holders = []
        top5_conc = top10_conc = 0.0
        holder_count = 0
        dev_holding_pct = 0.0
        try:
            r = await client.get(
                f"{MORALIS_API}/erc20/{contract}/owners",
                params={"chain": "eth", "limit": 20, "order": "DESC"},
                headers=headers,
            )
            if r.status_code == 200:
                data = r.json()
                holders_raw = data.get("result") or []
                holder_count = len(holders_raw)

                for h in holders_raw[:20]:
                    addr = h.get("owner_address", "")
                    bal_raw = h.get("balance") or "0"
                    try:
                        bal = int(bal_raw) / (10 ** decimals)
                        pct = round(bal / total_supply * 100, 2)
                    except Exception:
                        pct = 0.0
                    top_holders.append({"address": addr, "pct": pct})
                    if deployer and addr.lower() == deployer.lower():
                        dev_holding_pct = pct

                top5_conc  = round(sum(h["pct"] for h in top_holders[:5]),  2)
                top10_conc = round(sum(h["pct"] for h in top_holders[:10]), 2)
                print(f"[Moralis] {contract[:10]} holders={holder_count} top5={top5_conc}% top10={top10_conc}%")
            else:
                print(f"[Moralis] holders error: {r.status_code} {r.text[:100]}")
        except Exception as e:
            print(f"[Moralis] holders fetch error: {e}")

    result = {
        "dev_wallet":              deployer,
        "dev_holding_pct":         dev_holding_pct,
        "top_holders":             top_holders,
        "total_holders":           holder_count,
        "top5_concentration_pct":  top5_conc,
        "top10_concentration_pct": top10_conc,
    }
    cache_set(f"moralis:{contract}", result)
    return result


def _empty() -> dict:
    return {
        "dev_wallet": "", "dev_holding_pct": 0.0,
        "top_holders": [], "total_holders": 0,
        "top5_concentration_pct": 0.0, "top10_concentration_pct": 0.0,
    }
