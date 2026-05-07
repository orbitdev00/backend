"""
etherscan.py — Ethereum token data via Etherscan API
Fetches: top holders, deployer wallet, dev holding %
Free tier: 5 calls/sec, 100k/day
"""
import httpx
import os
from aggregator.cache import get as cache_get, set as cache_set

ETHERSCAN_API = "https://api.etherscan.io/api"
TTL = 60


def _key() -> str:
    return os.getenv("ETHERSCAN_API_KEY", "")


async def fetch_etherscan_holders(contract: str) -> dict:
    cached = cache_get(f"eth:{contract}", TTL)
    if cached:
        return cached

    key = _key()
    if not key:
        print("[Etherscan] No API key — skipping")
        return _empty()

    async with httpx.AsyncClient(timeout=12) as client:
        # Deployer address
        deployer = ""
        try:
            r = await client.get(ETHERSCAN_API, params={
                "module": "contract", "action": "getcontractcreation",
                "contractaddresses": contract, "apikey": key,
            })
            res = (r.json().get("result") or [{}])
            deployer = (res[0] if isinstance(res, list) and res else {}).get("contractCreator", "")
        except Exception as e:
            print(f"[Etherscan] deployer error: {e}")

        # Token info (supply + decimals)
        total_supply = 1
        decimals = 18
        try:
            r = await client.get(ETHERSCAN_API, params={
                "module": "token", "action": "tokeninfo",
                "contractaddress": contract, "apikey": key,
            })
            ti = (r.json().get("result") or [{}])
            ti = ti[0] if isinstance(ti, list) and ti else {}
            decimals = int(ti.get("divisor") or ti.get("decimals") or 18)
            total_supply = max(1, int(ti.get("totalSupply") or 1) / (10 ** decimals))
        except Exception as e:
            print(f"[Etherscan] tokeninfo error: {e}")

        # Top holders
        top_holders = []
        top5_conc = top10_conc = 0.0
        holder_count = 0
        try:
            r = await client.get(ETHERSCAN_API, params={
                "module": "token", "action": "tokenholderlist",
                "contractaddress": contract, "page": 1, "offset": 20, "apikey": key,
            })
            holders_raw = r.json().get("result") or []
            if isinstance(holders_raw, list):
                for h in holders_raw[:20]:
                    addr = h.get("TokenHolderAddress", "")
                    try:
                        qty = int(h.get("TokenHolderQuantity", 0)) / (10 ** decimals)
                        pct = round(qty / total_supply * 100, 2)
                    except Exception:
                        pct = 0.0
                    top_holders.append({"address": addr, "pct": pct})
                holder_count = len(holders_raw)
                top5_conc  = round(sum(h["pct"] for h in top_holders[:5]),  2)
                top10_conc = round(sum(h["pct"] for h in top_holders[:10]), 2)
        except Exception as e:
            print(f"[Etherscan] holders error: {e}")

        # Dev holding %
        dev_holding_pct = 0.0
        if deployer:
            for h in top_holders:
                if h["address"].lower() == deployer.lower():
                    dev_holding_pct = h["pct"]
                    break
            if not dev_holding_pct:
                try:
                    r = await client.get(ETHERSCAN_API, params={
                        "module": "account", "action": "tokenbalance",
                        "contractaddress": contract, "address": deployer,
                        "tag": "latest", "apikey": key,
                    })
                    bal = int(r.json().get("result") or 0) / (10 ** decimals)
                    dev_holding_pct = round(bal / total_supply * 100, 2)
                except Exception:
                    pass

    result = {
        "dev_wallet":              deployer,
        "dev_holding_pct":         dev_holding_pct,
        "top_holders":             top_holders,
        "total_holders":           holder_count,
        "top5_concentration_pct":  top5_conc,
        "top10_concentration_pct": top10_conc,
    }
    cache_set(f"eth:{contract}", result)
    return result


def _empty() -> dict:
    return {
        "dev_wallet": "", "dev_holding_pct": 0.0,
        "top_holders": [], "total_holders": 0,
        "top5_concentration_pct": 0.0, "top10_concentration_pct": 0.0,
    }
