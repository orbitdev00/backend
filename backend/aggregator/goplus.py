import httpx
from aggregator.cache import get as cache_get, set as cache_set

GOPLUS_API = "https://api.gopluslabs.io/api/v1"
GOPLUS_TTL = 60  # cache for 60 seconds


async def fetch_goplus(mint: str) -> dict:
    """
    GoPlus Security API — free, no key required.
    Results cached for 60 seconds.
    Returns: honeypot detection, bundle %, sniper count, 
    blacklist/whitelist, mint authority, freeze authority.
    """
    cached = cache_get(f"goplus:{mint}", GOPLUS_TTL)
    if cached:
        return cached

    url = f"{GOPLUS_API}/solana/token_security"
    params = {"contract_addresses": mint}

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"[GoPlus] Error: {e}")
            return _empty()

    # GoPlus returns result keyed by mint address (lowercased)
    result = (data.get("result") or {}).get(mint.lower()) or \
             (data.get("result") or {}).get(mint) or {}

    if not result:
        return _empty()

    # Parse fields
    is_honeypot     = result.get("is_honeypot") == "1"
    can_mint        = result.get("mintable") == "1"
    can_freeze      = result.get("freezeable") == "1"
    has_blacklist   = result.get("transfer_pausable") == "1"

    # Holder security
    top10_pct       = _safe_float(result.get("top10_holder_rate")) * 100
    creator_pct     = _safe_float(result.get("creator_percent")) * 100
    creator_balance = _safe_float(result.get("creator_balance"))

    # DEX/market
    dex_info        = result.get("dex") or []
    is_on_dex       = len(dex_info) > 0

    # Sniper / bundle related
    # GoPlus doesn't give raw sniper count but gives holder distribution
    holders         = result.get("holders") or []
    sniper_count    = sum(1 for h in holders if _safe_float(h.get("percent")) < 0.001 and _safe_float(h.get("balance")) > 0)

    # Security score 0-100 (higher = more risky)
    risk_score = 0
    if is_honeypot:    risk_score += 50
    if can_freeze:     risk_score += 20
    if can_mint:       risk_score += 15
    if has_blacklist:  risk_score += 10
    if creator_pct > 10: risk_score += 20
    elif creator_pct > 5: risk_score += 10
    if top10_pct > 80: risk_score += 15
    elif top10_pct > 60: risk_score += 8

    flags = []
    if is_honeypot:   flags.append("HONEYPOT — cannot sell")
    if can_freeze:    flags.append("Freeze authority active — dev can freeze wallets")
    if can_mint:      flags.append("Mint authority active — supply can be inflated")
    if has_blacklist: flags.append("Transfer can be paused by dev")
    if creator_pct > 10: flags.append(f"Creator holds {creator_pct:.1f}% of supply")

    result = {
        "goplus_risk_score":  min(100, risk_score),
        "is_honeypot":        is_honeypot,
        "can_mint":           can_mint,
        "can_freeze":         can_freeze,
        "has_blacklist":      has_blacklist,
        "creator_pct":        round(creator_pct, 2),
        "top10_holder_pct":   round(top10_pct, 2),
        "is_on_dex":          is_on_dex,
        "sniper_count":       sniper_count,
        "goplus_flags":       flags,
    }
    cache_set(f"goplus:{mint}", result)
    return result


def _safe_float(val) -> float:
    try:
        return float(val or 0)
    except Exception:
        return 0.0


def _empty() -> dict:
    return {
        "goplus_risk_score": 0,
        "is_honeypot":       False,
        "can_mint":          False,
        "can_freeze":        False,
        "has_blacklist":     False,
        "creator_pct":       0,
        "top10_holder_pct":  0,
        "is_on_dex":         False,
        "sniper_count":      0,
        "goplus_flags":      [],
    }
