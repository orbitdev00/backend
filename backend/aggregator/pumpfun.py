import httpx
from config import PUMPFUN_API

# Pump.fun frequently blocks non-browser requests.
# We do our best with browser headers; if it fails, snapshot.py
# will fall back to DexScreener for name/symbol/socials.

async def fetch_pumpfun(mint: str) -> dict:
    data = await _try_coins_endpoint(mint)
    if not data:
        return _empty_pumpfun()

    is_migrated = bool(data.get("complete") or data.get("raydium_pool"))
    bonding_curve_usd = float(data.get("usd_market_cap") or 0)

    twitter  = (data.get("twitter")  or "").strip()
    telegram = (data.get("telegram") or "").strip()
    website  = (data.get("website")  or "").strip()
    social_count = sum([bool(twitter), bool(telegram), bool(website)])

    name   = (data.get("name")   or "").strip()
    symbol = (data.get("symbol") or "").strip()

    return {
        "name": name,
        "symbol": symbol,
        "description": (data.get("description") or "").strip(),
        "image_uri": data.get("image_uri") or data.get("image") or "",
        "dev_wallet": data.get("creator") or "",
        "created_timestamp": data.get("created_timestamp"),
        "is_migrated": is_migrated,
        "raydium_pool": data.get("raydium_pool"),
        "bonding_curve_usd": bonding_curve_usd,
        "reply_count": int(data.get("reply_count") or 0),
        "has_twitter": bool(twitter),
        "has_telegram": bool(telegram),
        "has_website": bool(website),
        "twitter_url": twitter,
        "telegram_url": telegram,
        "website_url": website,
        "social_count": social_count,
        "total_supply": int(data.get("total_supply") or 1_000_000_000),
        "virtual_sol_reserves": float(data.get("virtual_sol_reserves") or 0),
        "virtual_token_reserves": float(data.get("virtual_token_reserves") or 0),
        "real_sol_reserves": float(data.get("real_sol_reserves") or 0),
        "real_token_reserves": float(data.get("real_token_reserves") or 0),
        "king_of_the_hill_timestamp": data.get("king_of_the_hill_timestamp"),
    }


async def _try_coins_endpoint(mint: str):
    url = f"{PUMPFUN_API}/coins/{mint}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://pump.fun",
        "Referer": "https://pump.fun/",
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
    }
    async with httpx.AsyncClient(timeout=10, headers=headers, follow_redirects=True) as client:
        try:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("mint") or data.get("name") or data.get("symbol"):
                    return data
        except Exception:
            pass
    return None


def _empty_pumpfun() -> dict:
    return {
        "name": "", "symbol": "", "description": "", "image_uri": "",
        "dev_wallet": "", "created_timestamp": None, "is_migrated": False,
        "raydium_pool": None, "bonding_curve_usd": 0, "reply_count": 0,
        "has_twitter": False, "has_telegram": False, "has_website": False,
        "twitter_url": "", "telegram_url": "", "website_url": "",
        "social_count": 0, "total_supply": 1_000_000_000,
        "virtual_sol_reserves": 0, "virtual_token_reserves": 0,
        "real_sol_reserves": 0, "real_token_reserves": 0,
        "king_of_the_hill_timestamp": None,
    }
