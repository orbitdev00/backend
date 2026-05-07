import asyncio
import time
from aggregator.dexscreener import fetch_dexscreener
from aggregator.pumpfun import fetch_pumpfun
from aggregator.solscan import fetch_solscan
from aggregator.helius import fetch_helius, fetch_funding_sources, fetch_insider_signals
from aggregator.goplus import fetch_goplus
from aggregator.devhistory import fetch_dev_history


def detect_chain(address: str) -> str:
    """Detect chain from address format."""
    if address.startswith("0x") and len(address) == 42:
        return "ethereum"
    return "solana"


async def build_snapshot(mint: str, ws_broadcast=None) -> dict:
    """
    Build full token snapshot.
    ws_broadcast: optional async callable to push funding source update
                  after main result is returned (background task).
    All aggregators run in parallel.
    """
    chain = detect_chain(mint)
    print(f"[Snapshot] Detected chain: {chain} for {mint[:8]}...")

    # Stage 1: DexScreener always runs; Pump.fun only for Solana
    if chain == "solana":
        dex, pump = await asyncio.gather(
            fetch_dexscreener(mint),
            fetch_pumpfun(mint),
        )
    else:
        dex = await fetch_dexscreener(mint)
        pump = {}  # ETH has no pump.fun

    dev_wallet   = pump.get("dev_wallet") or ""
    total_supply = pump.get("total_supply") or 1_000_000_000
    pair_address = dex.get("pair_address") or ""

    # Stage 2: Solana-specific aggregators skipped for ETH
    import time as _t
    _ta = _t.time()
    if chain == "solana":
        sol, hel, gop, devhist = await asyncio.gather(
            fetch_solscan(mint, dev_wallet, total_supply, pair_address),
            fetch_helius(mint, dev_wallet),
            fetch_goplus(mint),
            fetch_dev_history(dev_wallet) if dev_wallet else _noop_devhist(),
        )
    else:
        # ETH: only GoPlus for security, skip Solana RPC calls
        try:
            gop = await fetch_goplus(mint, chain="eth")
        except TypeError:
            gop = await fetch_goplus(mint)  # fallback if chain param not supported yet
        sol = _empty_sol()
        hel = _empty_hel()
        devhist = _empty_devhist()
    print(f"[Timing] aggregators: {_t.time()-_ta:.2f}s")

    # solscan.py already filters out LP pools via DEX_OWNERS before returning.
    # top_holders here should be real trading wallets only. Do NOT skip again.
    top_holders = sol.get("top_holders", [])

    top5_conc  = round(min(sum(h["pct"] for h in top_holders[:5]),  100), 2)
    top10_conc = round(min(sum(h["pct"] for h in top_holders[:10]), 100), 2)

    name   = pump.get("name")   or dex.get("name")   or mint[:8]
    symbol = pump.get("symbol") or dex.get("symbol") or "???"

    has_twitter  = pump.get("has_twitter")  or dex.get("has_twitter",  False)
    has_telegram = pump.get("has_telegram") or dex.get("has_telegram", False)
    has_website  = pump.get("has_website")  or dex.get("has_website",  False)
    dex_banner   = dex.get("dex_banner", False)

    age_seconds     = _compute_age(pump.get("created_timestamp") or dex.get("pair_created_at"))
    buy_sell_ratio  = _buy_sell_ratio(dex)
    volume_velocity = _volume_velocity(dex, age_seconds)

    price_usd  = dex.get("price_usd", 0)
    change_24h = dex.get("price_change_24h", 0)
    change_1h  = dex.get("price_change_1h", 0)
    change_5m  = dex.get("price_change_5m", 0)

    # pct_from_peak: use best available signal
    # Try 24h price change first, then fall back to highest_mc_seen from DB
    pct_from_peak = 0.0
    if change_24h < -5 and price_usd > 0:
        estimated_peak = price_usd / (1 + change_24h / 100)
        if estimated_peak > 0:
            pct_from_peak = round((1 - price_usd / estimated_peak) * 100, 1)

    # Also check 1h change — if 1h shows a bigger drop, use that signal too
    if change_1h < -30 and price_usd > 0:
        estimated_peak_1h = price_usd / (1 + change_1h / 100)
        pct_from_peak_1h  = round((1 - price_usd / estimated_peak_1h) * 100, 1)
        pct_from_peak = max(pct_from_peak, pct_from_peak_1h)

    # Use DexScreener high24h vs current price if available
    high24h = dex.get("high24h") or 0
    if high24h > 0 and price_usd > 0 and high24h > price_usd:
        pct_from_high24h = round((1 - price_usd / high24h) * 100, 1)
        pct_from_peak = max(pct_from_peak, pct_from_high24h)

    # Uniform holder distribution detection (wallet farm signal)
    uniform_holders  = _detect_uniform_holders(top_holders)

    # Async cross-coin wallet check (fast — cached in Supabase)

    # Fake chart detection signals
    fake_chart_signals = _detect_fake_chart(dex, hel, top_holders, age_seconds)

    # Dev supply — try from helius first, fallback to solscan top holders
    dev_holding_pct = sol.get("dev_holding_pct", 0)
    if dev_holding_pct == 0 and dev_wallet:
        # Check if dev appears anywhere in raw holders list
        for h in raw_holders:
            if h.get("address", "").lower() == dev_wallet.lower():
                dev_holding_pct = h.get("pct", 0)
                break

    return {
        "mint":      mint,
        "timestamp": int(time.time()),
        "age_seconds": age_seconds,
        "chain":       chain,

        # Identity
        "name":        name,
        "symbol":      symbol,
        "description": pump.get("description", ""),
        "dev_wallet":  dev_wallet,
        "is_migrated": pump.get("is_migrated", False) or (dex.get("market_cap_usd") or 0) > 34_000,

        # Market
        "market_cap_usd":              dex.get("market_cap_usd") or pump.get("bonding_curve_usd") or 0,
        "price_usd":                   price_usd,
        "liquidity_usd":               dex.get("liquidity_usd", 0),
        "volume_5m":                   dex.get("volume_5m", 0),
        "volume_1h":                   dex.get("volume_1h", 0),
        "volume_24h":                  dex.get("volume_24h", 0),
        "volume_velocity_usd_per_min": volume_velocity,
        "vol_mc_ratio":  round(dex.get("volume_1h", 0) / max(dex.get("market_cap_usd", 1), 1), 4),
        "vol_liq_ratio": round(dex.get("volume_1h", 0) / max(dex.get("liquidity_usd", 1), 1), 4),
        "price_change_5m":             change_5m,
        "price_change_1h":             change_1h,
        "price_change_24h":            change_24h,
        "pct_from_24h_peak":           pct_from_peak,

        # Transactions
        "txns_5m_buys":    dex.get("txns_5m_buys", 0),
        "txns_5m_sells":   dex.get("txns_5m_sells", 0),
        "buy_sell_ratio_5m": buy_sell_ratio,

        # Socials
        "social_count":  sum([bool(has_twitter), bool(has_telegram), bool(has_website)]),
        "has_twitter":   has_twitter,
        "has_telegram":  has_telegram,
        "has_website":   has_website,
        "dex_banner":    dex_banner,

        # Holders
        "total_holders":           sol.get("total_holders", 0),
        "top_holders":             top_holders,
        "top10_concentration_pct": top10_conc,
        "top5_concentration_pct":  top5_conc,
        "dev_holding_pct":         dev_holding_pct,
        "rug_risk_score":          sol.get("rug_risk_score", 0),

        # Bundle / on-chain
        "bundle_detected":      hel.get("bundle_detected", False),
        "bundle_confidence":    hel.get("bundle_confidence", 0),
        "bundled_wallet_count": hel.get("bundled_wallet_count", 0),
        "fresh_wallet_count":   hel.get("fresh_wallet_count", 0),
        "fresh_wallet_pct":     hel.get("fresh_wallet_pct", 0),
        "dev_tokens_bought":    hel.get("dev_tokens_bought", 0),
        "dev_tokens_sold":      hel.get("dev_tokens_sold", 0),
        "dev_sell_pct":         hel.get("dev_sell_pct", 0),
        "dev_dumped":           hel.get("dev_dumped", False),

        # Funding source / wallet farm detection
        # Feature 2: Insider / sniper detection
        "insider_count":  hel.get("insider_count", 0),
        "insider_pct":    hel.get("insider_pct", 0),
        "sniper_count":   hel.get("sniper_count", 0),

        "shared_funder_detected": hel.get("shared_funder_detected", False),
        "uniform_holders_detected": uniform_holders["detected"],
        "uniform_holder_variance":  uniform_holders["variance"],
        "shared_funder_wallets":  hel.get("shared_funder_wallets", 0),
        "shared_funder_pct":      hel.get("shared_funder_pct", 0),
        "top_funder":             hel.get("top_funder"),

        # Fake chart signals
        "fake_chart_score":    fake_chart_signals["score"],
        "fake_chart_flags":    fake_chart_signals["flags"],
        "wash_trading_likely": fake_chart_signals["wash_trading"],

        "king_of_the_hill": bool(pump.get("king_of_the_hill_timestamp")),
        # Enhanced rug signals based on MC collapse
        "mc_collapse_detected": _detect_mc_collapse(dex, age_seconds),

        # Dev wallet history
        "dev_prev_launches":    devhist.get("dev_prev_launches", 0),
        "dev_prev_rugs":        devhist.get("dev_prev_rugs", 0),
        "dev_rug_rate_pct":     devhist.get("dev_rug_rate_pct", 0),
        "dev_avg_rug_minutes":  devhist.get("dev_avg_rug_minutes"),
        "dev_history_summary":  devhist.get("dev_history_summary", ""),
        "dev_is_serial_rugger": devhist.get("dev_is_serial_rugger", False),

        # Migration countdown
        **_migration_countdown(dex, pump, age_seconds),

        # GoPlus security
        "is_honeypot":       gop.get("is_honeypot", False),
        "can_mint":          gop.get("can_mint", False),
        "can_freeze":        gop.get("can_freeze", False),
        "has_blacklist":     gop.get("has_blacklist", False),
        "goplus_risk_score": gop.get("goplus_risk_score", 0),
        "goplus_flags":      gop.get("goplus_flags", []),
        "sniper_count":      gop.get("sniper_count", 0),
    }


def _detect_mc_collapse(dex: dict, age_seconds: int) -> bool:
    """
    Detects MC collapse even when the peak was outside the 24h window.
    Uses multiple timeframe price changes to detect rugs.
    """
    change_1h  = dex.get("price_change_1h", 0) or 0
    change_24h = dex.get("price_change_24h", 0) or 0
    vol_1h     = dex.get("volume_1h", 0) or 0
    vol_24h    = dex.get("volume_24h", 0) or 0
    mc         = dex.get("market_cap_usd", 0) or 0
    liquidity  = dex.get("liquidity_usd", 0) or 0

    # Obvious rug: price down 70%+ in 24h with dead volume
    if change_24h < -70 and vol_1h < 2000:
        return True
    # Price down 50%+ in 1h = very fast collapse
    if change_1h < -50:
        return True
    # MC extremely low with near-zero volume and liquidity (coin is dead)
    if mc > 0 and mc < 3000 and vol_24h < 5000 and liquidity < 500:
        return True
    # Volume completely dead after age > 2h
    if age_seconds > 7200 and vol_1h == 0 and vol_24h < 100:
        return True
    return False


def _migration_countdown(dex: dict, pump: dict, age_seconds: int) -> dict:
    """
    Estimates time to migration based on bonding curve progress and buy velocity.
    Pump.fun migrates at ~$34K MC. Uses recent volume to project arrival time.
    """
    mc       = dex.get("market_cap_usd") or pump.get("bonding_curve_usd") or 0
    target   = 34_000
    is_migrated = pump.get("is_migrated", False) or mc >= target

    if is_migrated:
        return {
            "migration_target_mc":       target,
            "migration_pct_complete":    100.0,
            "migration_eta_minutes":     0,
            "migration_eta_label":       "Migrated",
        }

    if mc <= 0:
        return {
            "migration_target_mc":       target,
            "migration_pct_complete":    0.0,
            "migration_eta_minutes":     None,
            "migration_eta_label":       "Unknown",
        }

    pct_complete = round(min(mc / target * 100, 99.9), 1)

    # Use volume velocity to estimate remaining time
    remaining_mc  = target - mc
    vol_1h        = dex.get("volume_1h", 0)
    vol_5m        = dex.get("volume_5m", 0)

    # Weight recent volume more heavily
    velocity_per_min = 0
    if vol_5m > 0:
        velocity_per_min = vol_5m / 5
    elif vol_1h > 0:
        velocity_per_min = vol_1h / 60

    if velocity_per_min > 0:
        eta_minutes = round(remaining_mc / velocity_per_min)
        if eta_minutes < 1:
            label = "< 1 min"
        elif eta_minutes < 60:
            label = f"~{eta_minutes}m"
        else:
            hrs  = eta_minutes // 60
            mins = eta_minutes % 60
            label = f"~{hrs}h {mins}m" if mins else f"~{hrs}h"
    else:
        eta_minutes = None
        label       = "Slow / stalled"

    return {
        "migration_target_mc":    target,
        "migration_pct_complete": pct_complete,
        "migration_eta_minutes":  eta_minutes,
        "migration_eta_label":    label,
    }


def _empty_sol() -> dict:
    return {
        "top_holders": [], "total_holders": 0,
        "dev_holding_pct": 0, "rug_risk_score": 0,
    }


def _empty_hel() -> dict:
    return {
        "bundle_detected": False, "bundle_confidence": 0, "bundled_wallet_count": 0,
        "fresh_wallet_count": 0, "fresh_wallet_pct": 0,
        "dev_tokens_bought": 0, "dev_tokens_sold": 0, "dev_sell_pct": 0, "dev_dumped": False,
        "insider_count": 0, "insider_pct": 0, "sniper_count": 0,
        "shared_funder_detected": False, "shared_funder_wallets": 0,
        "shared_funder_pct": 0, "top_funder": None,
    }


async def _noop_devhist() -> dict:
    return _empty_devhist()


def _empty_devhist() -> dict:
    return {
        "dev_prev_launches": 0, "dev_prev_rugs": 0, "dev_rug_rate_pct": 0,
        "dev_avg_rug_minutes": None, "dev_history_summary": "No history found",
        "dev_is_serial_rugger": False,
    }


def _detect_uniform_holders(holders: list) -> dict:
    """
    Detects wallet farms by checking if top holders all have nearly
    identical token percentages — a statistical impossibility in organic trading.
    In the wild, holder distribution follows a power law (big holders, many small).
    If everyone holds 0.20-0.23%, it's coordinated.

    Note: holders list already has LP pools filtered out upstream (solscan.py).
    """
    if len(holders) < 10:
        return {"detected": False, "variance": 0}

    # Look at top 10 real holders
    pcts = [h["pct"] for h in holders[:10] if h.get("pct", 0) > 0]
    if len(pcts) < 8:
        return {"detected": False, "variance": 0}

    mean = sum(pcts) / len(pcts)
    if mean == 0:
        return {"detected": False, "variance": 0}

    # Coefficient of variation — low value = suspiciously uniform
    variance = (sum((p - mean) ** 2 for p in pcts) / len(pcts)) ** 0.5
    cv = variance / mean

    # Organic distributions have CV > 0.30 typically (power law).
    # CV < 0.12 with 10 holders = strong wallet farm signal
    # CV < 0.08 with 8+ holders = near certain
    # Additional guard: require at least some absolute holding size
    # to avoid flagging tokens where everyone is dust (< 0.5%)
    min_pct_passes = sum(1 for p in pcts if p >= 0.5) >= 5

    detected = min_pct_passes and (
        (cv < 0.12 and len(pcts) >= 10) or
        (cv < 0.08 and len(pcts) >= 8)
    )

    return {"detected": detected, "variance": round(cv, 3)}


def _detect_fake_chart(dex: dict, hel: dict, holders: list, age_seconds: int) -> dict:
    """
    Detects fake/manipulated chart patterns.
    Returns a score 0-100 and list of specific flags.
    """
    score = 0
    flags = []

    vol_5m  = dex.get("volume_5m", 0)
    vol_1h  = dex.get("volume_1h", 0)
    vol_24h = dex.get("volume_24h", 0)
    buys_5m  = dex.get("txns_5m_buys", 0)
    sells_5m = dex.get("txns_5m_sells", 0)
    change_5m  = dex.get("price_change_5m", 0)
    change_1h  = dex.get("price_change_1h", 0)
    liquidity  = dex.get("liquidity_usd", 0)
    mc         = dex.get("market_cap_usd", 0)

    # 1. Volume with no price movement = wash trading
    if vol_5m > 10_000 and abs(change_5m) < 0.5:
        score += 25
        flags.append("High volume with near-zero price movement — likely wash trading")

    # 2. Volume >> liquidity ratio (impossible without manipulation)
    if liquidity > 0 and vol_1h > liquidity * 5:
        score += 20
        flags.append(f"1h volume is {round(vol_1h/liquidity, 1)}x the liquidity — suspicious")

    # 3. Perfect buy/sell ratio (too clean = bots)
    if buys_5m > 10 and sells_5m > 10:
        ratio = buys_5m / sells_5m if sells_5m > 0 else 0
        if 0.95 <= ratio <= 1.05:
            score += 15
            flags.append("Buy/sell ratio suspiciously close to 1:1 — possible bot activity")

    # 4. Price pumped but volume extremely low (ghost pump)
    if change_1h > 50 and vol_1h < 5_000:
        score += 30
        flags.append(f"Price up {change_1h:.0f}% on only ${vol_1h:,.0f} volume — ghost pump")

    # 5. MC >> liquidity by extreme ratio (low liquidity manipulation)
    if liquidity > 0 and mc > 0:
        mc_liq_ratio = mc / liquidity
        if mc_liq_ratio > 50:
            score += 20
            flags.append(f"MC is {round(mc_liq_ratio, 0):.0f}x liquidity — extremely thin, easy to manipulate")

    # 6. Very young coin with huge price move (pump and dump setup)
    if age_seconds < 300 and change_5m > 100:
        score += 25
        flags.append(f"Under 5 min old with +{change_5m:.0f}% move — likely coordinated pump")

    # 7. Shared funder + price pump = coordinated fake activity
    if hel.get("shared_funder_detected") and change_1h > 20:
        score += 20
        flags.append("Coordinated wallet farm buying while price pumps")

    # 8. Zero sells despite significant volume (no organic selling = bots only buying)
    if vol_5m > 5_000 and sells_5m == 0:
        score += 15
        flags.append("Zero sells despite active volume — unnatural buy pressure")

    return {
        "score": min(100, score),
        "flags": flags,
        "wash_trading": score >= 40,
    }


def _compute_age(ts) -> int:
    if not ts:
        return 0
    ts = ts / 1000 if ts > 1e10 else ts
    return max(0, int(time.time() - ts))


def _buy_sell_ratio(dex: dict) -> float:
    buys  = dex.get("txns_5m_buys", 0)
    sells = dex.get("txns_5m_sells", 0)
    if sells == 0:
        return float(buys) if buys > 0 else 0.0
    return round(buys / sells, 2)


def _volume_velocity(dex: dict, age_seconds: int) -> float:
    vol = dex.get("volume_1h", 0) or dex.get("volume_24h", 0)
    minutes = max(1, age_seconds / 60)
    return round(vol / minutes, 2)
