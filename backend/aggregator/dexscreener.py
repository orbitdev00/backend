import httpx
from config import DEXSCREENER_API
from aggregator.cache import get as cache_get, set as cache_set

DEX_TTL = 15  # 15 second cache


async def fetch_dexscreener(mint: str) -> dict:
    cached = cache_get(f"dex:{mint}", DEX_TTL)
    if cached:
        return cached

    url = f"{DEXSCREENER_API}/tokens/{mint}"

    async with httpx.AsyncClient(timeout=8) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        except Exception:
            return _empty()

    pairs = data.get("pairs") or []
    sol_pairs = [p for p in pairs if p.get("chainId") == "solana"]
    if not sol_pairs:
        return _empty()

    sol_pairs.sort(key=lambda p: (p.get("liquidity") or {}).get("usd") or 0, reverse=True)
    pair = sol_pairs[0]

    info     = pair.get("info") or {}
    socials  = info.get("socials") or []
    websites = info.get("websites") or []
    base     = pair.get("baseToken") or {}

    def has_social(platform: str) -> bool:
        for s in socials:
            t = (s.get("type") or s.get("platform") or "").lower()
            if platform in t:
                return True
        return False

    def get_social_url(platform: str) -> str:
        for s in socials:
            t = (s.get("type") or s.get("platform") or "").lower()
            if platform in t:
                return s.get("url") or ""
        return ""

    has_twitter  = has_social("twitter") or has_social("x")
    has_telegram = has_social("telegram")
    has_discord  = has_social("discord")
    has_website  = len(websites) > 0
    social_count = sum([has_twitter, has_telegram or has_discord, has_website])

    vol   = pair.get("volume")      or {}
    price = pair.get("priceChange") or {}
    txns  = pair.get("txns")        or {}

    result = {
        "name":   base.get("name",   ""),
        "symbol": base.get("symbol", ""),
        "price_usd":        float(pair.get("priceUsd") or 0),
        "market_cap_usd":   float(pair.get("marketCap") or pair.get("fdv") or 0),
        "liquidity_usd":    float((pair.get("liquidity") or {}).get("usd") or 0),
        "volume_5m":        float(vol.get("m5")  or 0),
        "volume_1h":        float(vol.get("h1")  or 0),
        "volume_6h":        float(vol.get("h6")  or 0),
        "volume_24h":       float(vol.get("h24") or 0),
        "price_change_5m":  float(price.get("m5")  or 0),
        "price_change_1h":  float(price.get("h1")  or 0),
        "price_change_24h": float(price.get("h24") or 0),
        "txns_5m_buys":  int((txns.get("m5") or {}).get("buys",  0)),
        "txns_5m_sells": int((txns.get("m5") or {}).get("sells", 0)),
        "txns_1h_buys":  int((txns.get("h1") or {}).get("buys",  0)),
        "txns_1h_sells": int((txns.get("h1") or {}).get("sells", 0)),
        "dex":          pair.get("dexId", "unknown"),
        "dex_banner":   bool(info.get("header")),
        "dex_logo":     bool(info.get("imageUrl")),
        "has_twitter":  has_twitter,
        "has_telegram": has_telegram or has_discord,
        "has_website":  has_website,
        "twitter_url":  get_social_url("twitter") or get_social_url("x"),
        "telegram_url": get_social_url("telegram"),
        "social_count": social_count,
        "_raw_socials":  socials,
        "_raw_websites": websites,
        "pair_created_at": pair.get("pairCreatedAt"),
        "pair_address":    pair.get("pairAddress"),
    }
    cache_set(f"dex:{mint}", result)
    return result


def _empty() -> dict:
    return {
        "name": "", "symbol": "",
        "price_usd": 0, "market_cap_usd": 0, "liquidity_usd": 0,
        "volume_5m": 0, "volume_1h": 0, "volume_6h": 0, "volume_24h": 0,
        "price_change_5m": 0, "price_change_1h": 0, "price_change_24h": 0,
        "txns_5m_buys": 0, "txns_5m_sells": 0,
        "txns_1h_buys": 0, "txns_1h_sells": 0,
        "dex": "unknown", "dex_banner": False, "dex_logo": False,
        "has_twitter": False, "has_telegram": False, "has_website": False,
        "twitter_url": "", "telegram_url": "",
        "social_count": 0,
        "_raw_socials": [], "_raw_websites": [],
        "pair_created_at": None, "pair_address": None,
    }
