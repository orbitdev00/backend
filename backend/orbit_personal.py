#!/usr/bin/env python3
"""
ORBIT - personal terminal analyzer.

Standalone CLI companion to the ORBIT backend. Paste a Solana mint, get the
same aggregator data + Claude narrative the web app produces, rendered in the
terminal with rich.

    cd backend
    python orbit_personal.py

Deliberately standalone: no FastAPI, no routes, nothing imported from main.py,
and it is never mounted anywhere. It talks to aggregator/ and reuses the
engine/ system prompt directly.

Scope notes (differs from engine/snapshot.build_snapshot on purpose):
  * Solana only - no chain detection, no Ethereum branch.
  * Runs dexscreener, solscan, helius, goplus. pumpfun is also called because
    solscan and helius need dev_wallet / total_supply / pair_address from it;
    without that stage the dev-wallet metrics come back empty.
  * devhistory and moralis are NOT called, so dev_prev_rugs / serial-rugger
    fields are absent from the snapshot rather than being sent to Claude as
    zeroes (zeroes would read to the model as "clean first-time dev").
"""

import asyncio
import json
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env and make backend/ importable before anything that reads
# config at import time (config.py resolves os.getenv on import).
BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Windows consoles default to cp1252, which cannot encode the box-drawing
# glyphs rich uses for rules and panels - it raises UnicodeEncodeError mid
# render (also hit whenever stdout is piped). Force UTF-8 and degrade any
# remaining unmappable glyph instead of crashing the run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

import httpx
from rich.align import Align
from rich.console import Console, Group
from rich.panel import Panel
from rich.prompt import Prompt
from rich.rule import Rule
from rich.table import Table
from rich.text import Text
from rich.theme import Theme

from config import ANTHROPIC_API_KEY
from aggregator.dexscreener import fetch_dexscreener
from aggregator.pumpfun import fetch_pumpfun
from aggregator.solscan import fetch_solscan
from aggregator.helius import fetch_helius
from aggregator.goplus import fetch_goplus

# Reuse the production system prompt verbatim - copying it here would fork a
# 200-line prompt and guarantee drift. The pure, side-effect-free detectors
# below are reused for the same reason.
from engine.claude import SYSTEM_PROMPT, MODEL, ANTHROPIC_URL
from engine.snapshot import (
    _buy_sell_ratio,
    _compute_age,
    _detect_fake_chart,
    _detect_mc_collapse,
    _detect_uniform_holders,
    _migration_countdown,
    _volume_velocity,
)

THEME = Theme({
    "accent":  "bold #a855f7",
    "accent2": "#c084fc",
    "dim2":    "#6b7280",
    "label":   "#9ca3af",
    "value":   "bold #e5e7eb",
    "good":    "bold #22c55e",
    "warn":    "bold #f59e0b",
    "bad":     "bold #ef4444",
})

console = Console(theme=THEME, highlight=False)

PANEL_KW = dict(border_style="bold purple", padding=(1, 2))

# Panels expand to the full terminal by default, which makes centering a
# no-op. Cap the width so Align.center() has room to work on wide terminals.
MAX_PANEL_WIDTH = 100


def centered(panel: Panel) -> Align:
    panel.width = min(console.width, MAX_PANEL_WIDTH)
    return Align.center(panel)


# ---------------------------------------------------------------- formatting

def usd(v) -> str:
    """Compact USD - $1.2M / $34.0K / $1,234 / $0.00004213."""
    try:
        v = float(v or 0)
    except (TypeError, ValueError):
        return "-"
    if v == 0:
        return "-"
    if abs(v) >= 1_000_000_000:
        return f"${v / 1_000_000_000:.2f}B"
    if abs(v) >= 1_000_000:
        return f"${v / 1_000_000:.2f}M"
    if abs(v) >= 1_000:
        return f"${v / 1_000:.1f}K"
    if abs(v) >= 1:
        return f"${v:,.2f}"
    return f"${v:.8f}".rstrip("0")


def pct(v, signed: bool = True) -> Text:
    """Percentage coloured by sign."""
    try:
        v = float(v or 0)
    except (TypeError, ValueError):
        return Text("-", style="dim2")
    style = "good" if v > 0 else "bad" if v < 0 else "dim2"
    sign = "+" if (signed and v > 0) else ""
    return Text(f"{sign}{v:.2f}%", style=style)


def score(v, invert: bool = True) -> Text:
    """0-100 meter. invert=True means a high number is bad (risk)."""
    try:
        v = float(v or 0)
    except (TypeError, ValueError):
        return Text("-", style="dim2")
    if invert:
        style = "bad" if v >= 70 else "warn" if v >= 40 else "good"
    else:
        style = "good" if v >= 70 else "warn" if v >= 40 else "bad"
    return Text(f"{v:.0f}/100", style=style)


def age(seconds) -> str:
    s = int(seconds or 0)
    if s <= 0:
        return "unknown"
    d, rem = divmod(s, 86400)
    h, rem = divmod(rem, 3600)
    m, _ = divmod(rem, 60)
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


def addr(a: str, width: int = 4) -> str:
    a = a or ""
    return f"{a[:width]}..{a[-width:]}" if len(a) > width * 2 + 1 else (a or "-")


def kv_table() -> Table:
    t = Table.grid(padding=(0, 2))
    t.add_column(style="label", justify="right", no_wrap=True)
    t.add_column(style="value")
    return t


# ---------------------------------------------------------------- snapshot

async def _safe(coro, label: str, fallback):
    """One failing aggregator must not sink the whole run."""
    try:
        return await coro
    except Exception as exc:
        console.print(f"  [warn]![/warn] [label]{label} failed:[/label] {exc}")
        return fallback


async def build_snapshot(mint: str) -> dict:
    """
    Solana-only replication of engine/snapshot.build_snapshot, assembling the
    exact field names the system prompt expects.
    """
    # Stage 1 - identity + market. solscan/helius depend on this output.
    console.print("  [accent2]*[/accent2] [label]dexscreener + pump.fun[/label]")
    dex, pump = await asyncio.gather(
        _safe(fetch_dexscreener(mint), "dexscreener", {}),
        _safe(fetch_pumpfun(mint), "pump.fun", {}),
    )

    dev_wallet = pump.get("dev_wallet") or ""
    total_supply = pump.get("total_supply") or 1_000_000_000
    pair_address = dex.get("pair_address") or ""

    # Stage 2 - holders, on-chain behaviour, security. Parallel, like prod.
    console.print("  [accent2]*[/accent2] [label]solscan + helius + goplus[/label]")
    sol, hel, gop = await asyncio.gather(
        _safe(fetch_solscan(mint, dev_wallet, total_supply, pair_address), "solscan", {}),
        _safe(fetch_helius(mint, dev_wallet), "helius", {}),
        _safe(fetch_goplus(mint), "goplus", {}),
    )

    # solscan already strips LP vaults via DEX_OWNERS - do not filter again.
    top_holders = sol.get("top_holders", []) or []

    top5 = round(min(sum(h.get("pct", 0) for h in top_holders[:5]), 100), 2)
    top10 = round(min(sum(h.get("pct", 0) for h in top_holders[:10]), 100), 2)

    age_seconds = _compute_age(pump.get("created_timestamp") or dex.get("pair_created_at"))
    price_usd = dex.get("price_usd", 0)
    change_1h = dex.get("price_change_1h", 0)
    change_24h = dex.get("price_change_24h", 0)

    # pct_from_24h_peak - best available signal, same precedence as prod.
    pct_from_peak = 0.0
    if change_24h < -5 and price_usd > 0:
        peak = price_usd / (1 + change_24h / 100)
        if peak > 0:
            pct_from_peak = round((1 - price_usd / peak) * 100, 1)
    if change_1h < -30 and price_usd > 0:
        peak_1h = price_usd / (1 + change_1h / 100)
        if peak_1h > 0:
            pct_from_peak = max(pct_from_peak, round((1 - price_usd / peak_1h) * 100, 1))
    high24h = dex.get("high24h") or 0
    if high24h > price_usd > 0:
        pct_from_peak = max(pct_from_peak, round((1 - price_usd / high24h) * 100, 1))

    uniform = _detect_uniform_holders(top_holders)
    fake = _detect_fake_chart(dex, hel, top_holders, age_seconds)

    # Dev supply - helius first, else locate the dev in the holder list.
    dev_holding_pct = sol.get("dev_holding_pct", 0)
    if not dev_holding_pct and dev_wallet:
        for h in top_holders:
            if (h.get("address") or "").lower() == dev_wallet.lower():
                dev_holding_pct = h.get("pct", 0)
                break

    has_twitter = pump.get("has_twitter") or dex.get("has_twitter", False)
    has_telegram = pump.get("has_telegram") or dex.get("has_telegram", False)
    has_website = pump.get("has_website") or dex.get("has_website", False)

    return {
        "mint": mint,
        "timestamp": int(time.time()),
        "age_seconds": age_seconds,
        "chain": "solana",

        # Identity
        "name": pump.get("name") or dex.get("name") or mint[:8],
        "symbol": pump.get("symbol") or dex.get("symbol") or "???",
        "description": pump.get("description", ""),
        "dev_wallet": dev_wallet,
        "is_migrated": pump.get("is_migrated", False)
                       or (dex.get("market_cap_usd") or 0) > 34_000,

        # Market
        "market_cap_usd": dex.get("market_cap_usd") or pump.get("bonding_curve_usd") or 0,
        "price_usd": price_usd,
        "liquidity_usd": dex.get("liquidity_usd", 0),
        "volume_5m": dex.get("volume_5m", 0),
        "volume_1h": dex.get("volume_1h", 0),
        "volume_24h": dex.get("volume_24h", 0),
        "volume_velocity_usd_per_min": _volume_velocity(dex, age_seconds),
        "vol_mc_ratio": round(dex.get("volume_1h", 0) / max(dex.get("market_cap_usd", 1), 1), 4),
        "vol_liq_ratio": round(dex.get("volume_1h", 0) / max(dex.get("liquidity_usd", 1), 1), 4),
        "price_change_5m": dex.get("price_change_5m", 0),
        "price_change_1h": change_1h,
        "price_change_24h": change_24h,
        "pct_from_24h_peak": pct_from_peak,

        # Transactions
        "txns_5m_buys": dex.get("txns_5m_buys", 0),
        "txns_5m_sells": dex.get("txns_5m_sells", 0),
        "buy_sell_ratio_5m": _buy_sell_ratio(dex),

        # Socials
        "social_count": sum([bool(has_twitter), bool(has_telegram), bool(has_website)]),
        "has_twitter": has_twitter,
        "has_telegram": has_telegram,
        "has_website": has_website,
        "dex_banner": dex.get("dex_banner", False),

        # Holders
        "total_holders": sol.get("total_holders", 0),
        "top_holders": top_holders,
        "top10_concentration_pct": top10,
        "top5_concentration_pct": top5,
        "dev_holding_pct": dev_holding_pct,
        "rug_risk_score": sol.get("rug_risk_score", 0),

        # Bundle / on-chain
        "bundle_detected": hel.get("bundle_detected", False),
        "bundle_confidence": hel.get("bundle_confidence", 0),
        "bundled_wallet_count": hel.get("bundled_wallet_count", 0),
        "fresh_wallet_count": hel.get("fresh_wallet_count", 0),
        "fresh_wallet_pct": hel.get("fresh_wallet_pct", 0),
        "dev_tokens_bought": hel.get("dev_tokens_bought", 0),
        "dev_tokens_sold": hel.get("dev_tokens_sold", 0),
        "dev_sell_pct": hel.get("dev_sell_pct", 0),
        "dev_dumped": hel.get("dev_dumped", False),

        # Insider / funding
        "insider_count": hel.get("insider_count", 0),
        "insider_pct": hel.get("insider_pct", 0),
        "shared_funder_detected": hel.get("shared_funder_detected", False),
        "shared_funder_wallets": hel.get("shared_funder_wallets", 0),
        "shared_funder_pct": hel.get("shared_funder_pct", 0),
        "top_funder": hel.get("top_funder"),
        "uniform_holders_detected": uniform["detected"],
        "uniform_holder_variance": uniform["variance"],

        # Fake chart
        "fake_chart_score": fake["score"],
        "fake_chart_flags": fake["flags"],
        "wash_trading_likely": fake["wash_trading"],

        "king_of_the_hill": bool(pump.get("king_of_the_hill_timestamp")),
        "mc_collapse_detected": _detect_mc_collapse(dex, age_seconds),

        # Migration countdown
        **_migration_countdown(dex, pump, age_seconds),

        # GoPlus security
        "is_honeypot": gop.get("is_honeypot", False),
        "can_mint": gop.get("can_mint", False),
        "can_freeze": gop.get("can_freeze", False),
        "has_blacklist": gop.get("has_blacklist", False),
        "goplus_risk_score": gop.get("goplus_risk_score", 0),
        "goplus_flags": gop.get("goplus_flags", []) or [],
        "sniper_count": gop.get("sniper_count", 0) or hel.get("sniper_count", 0),
    }


# ---------------------------------------------------------------- claude

async def analyze(snapshot: dict) -> dict:
    """Replicates engine/claude.analyze - same prompt, model and JSON recovery."""
    if not ANTHROPIC_API_KEY:
        return {"_error": "ANTHROPIC_API_KEY missing from backend/.env"}

    # top_holders is long and the prompt reasons over aggregates, not rows.
    lean = {k: v for k, v in snapshot.items() if k != "top_holders"}
    lean["top_holders"] = [
        {"address": h.get("address"), "pct": h.get("pct")}
        for h in snapshot.get("top_holders", [])[:10]
    ]

    payload = {
        "model": MODEL,
        "max_tokens": 1500,
        "system": SYSTEM_PROMPT,
        "messages": [{
            "role": "user",
            "content": "Analyze this token and return prediction JSON:\n\n"
                       f"SNAPSHOT:\n{json.dumps(lean, indent=2)}",
        }],
    }
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    data = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(ANTHROPIC_URL, json=payload, headers=headers)
            if resp.status_code == 429:
                wait = 10 * (attempt + 1)
                console.print(f"  [warn]rate limited - retrying in {wait}s[/warn]")
                await asyncio.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            break
        except Exception as exc:
            if attempt == 2:
                return {"_error": f"Anthropic request failed: {exc}"}
            await asyncio.sleep(5)
    if data is None:
        return {"_error": "Rate limited after 3 retries"}

    try:
        raw = data["content"][0]["text"].strip()
    except (KeyError, IndexError) as exc:
        return {"_error": f"Unexpected response shape: {exc}"}

    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw).strip()
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"_error": f"JSON parse failed: {exc}"}


# ---------------------------------------------------------------- panels

def market_panel(s: dict) -> Panel:
    t = Table(box=None, show_edge=False, pad_edge=False, expand=True,
              header_style="bold purple")
    t.add_column("Metric", style="label", no_wrap=True)
    t.add_column("Value", style="dim", justify="right")

    t.add_row("Market Cap", usd(s["market_cap_usd"]))
    t.add_row("Price", usd(s["price_usd"]))
    t.add_row("Liquidity", usd(s["liquidity_usd"]))
    t.add_row("Age", age(s["age_seconds"]))
    t.add_row("Stage", "Migrated" if s["is_migrated"]
              else f"Bonding - {s.get('migration_pct_complete', 0)}%")
    if not s["is_migrated"]:
        t.add_row("Migration ETA", str(s.get("migration_eta_label", "-")))
    t.add_row("Change 5m", pct(s["price_change_5m"]))
    t.add_row("Change 1h", pct(s["price_change_1h"]))
    t.add_row("Change 24h", pct(s["price_change_24h"]))
    t.add_row("From 24h peak", pct(-abs(s["pct_from_24h_peak"] or 0)))
    t.add_row("Vol 1h / 24h", f"{usd(s['volume_1h'])} / {usd(s['volume_24h'])}")
    t.add_row("Buy:Sell 5m",
              f"{s['buy_sell_ratio_5m']}  "
              f"({s['txns_5m_buys']}B / {s['txns_5m_sells']}S)")

    return Panel(t, title="[accent]Market Data[/accent]", title_align="left", **PANEL_KW)


def holders_panel(s: dict) -> Panel:
    holders = s.get("top_holders", [])
    if not holders:
        return Panel(Text("No holder data returned by solscan.", style="dim2"),
                     title="[accent]Top Holders[/accent]", title_align="left", **PANEL_KW)

    t = Table(box=None, expand=True, header_style="accent2", pad_edge=False)
    t.add_column("#", style="dim2", width=3, justify="right")
    t.add_column("Wallet", style="value", no_wrap=True)
    t.add_column("Share", justify="right")
    t.add_column("Tokens", style="label", justify="right")
    t.add_column("Tag", style="dim2")

    dev = (s.get("dev_wallet") or "").lower()
    for i, h in enumerate(holders[:10], 1):
        p = h.get("pct", 0) or 0
        a = h.get("address") or ""
        tag = h.get("name") or ""
        if dev and a.lower() == dev:
            tag = "DEV"
        amt = h.get("amount") or 0
        t.add_row(
            str(i),
            addr(a, 5),
            Text(f"{p:.2f}%", style="bad" if p >= 10 else "warn" if p >= 5 else "value"),
            f"{amt:,.0f}" if amt else "-",
            tag[:18],
        )

    summary = kv_table()
    summary.add_row("Holders", f"{s.get('total_holders', 0):,}")
    summary.add_row("Top 5 / Top 10",
                    f"{s['top5_concentration_pct']}%  /  {s['top10_concentration_pct']}%")
    summary.add_row("Dev holds",
                    f"{s.get('dev_holding_pct', 0)}%"
                    + (f"  ({addr(s['dev_wallet'], 4)})" if s.get("dev_wallet") else ""))
    if s.get("fresh_wallet_pct"):
        summary.add_row("Fresh wallets",
                        f"{s['fresh_wallet_pct']}%  ({s.get('fresh_wallet_count', 0)} wallets)")
    if s.get("uniform_holders_detected"):
        summary.add_row("Uniformity",
                        Text(f"UNIFORM (cv={s.get('uniform_holder_variance')})", style="bad"))

    return Panel(Group(t, Text(""), summary),
                 title="[accent]Top Holders[/accent]", title_align="left", **PANEL_KW)


def flags_panel(s: dict, p: dict) -> Panel:
    # Two columns so a long flag wraps aligned under its own text, not back
    # out to the panel's left edge.
    rows = Table.grid(padding=(0, 1))
    rows.add_column(width=3, justify="right", no_wrap=True)
    rows.add_column(overflow="fold")
    count = 0

    def flag(marker: str, text: str, style: str) -> None:
        nonlocal count
        rows.add_row(Text(marker, style=style), Text(text, style=style))
        count += 1

    hard = [
        ("Honeypot - cannot sell", s.get("is_honeypot")),
        ("Mint authority live - supply inflatable", s.get("can_mint")),
        ("Freeze authority live", s.get("can_freeze")),
        ("Blacklist function present", s.get("has_blacklist")),
        ("Dev has dumped", s.get("dev_dumped")),
        ("Bundle detected", s.get("bundle_detected")),
        ("Shared funder / wallet farm", s.get("shared_funder_detected")),
        ("Uniform holder distribution", s.get("uniform_holders_detected")),
        ("Wash trading likely", s.get("wash_trading_likely")),
        ("Market cap collapse", s.get("mc_collapse_detected")),
    ]
    for label, on in hard:
        if on:
            flag("X", label, "bad")

    for f in (s.get("goplus_flags") or [])[:5]:
        flag("X", str(f), "bad")
    for f in (s.get("fake_chart_flags") or [])[:5]:
        flag("!", str(f), "warn")
    for f in (p.get("flags") or [])[:8]:
        flag("!", str(f), "warn")
    for f in (p.get("bullish_flags") or [])[:4]:
        flag("+", str(f), "good")

    if not count:
        flag(" ", "No flags raised.", "good")

    meters = kv_table()
    meters.add_row("Risk", score(p.get("risk_score")))
    meters.add_row("Rug probability", score(p.get("rug_probability")))
    meters.add_row("Fake chart", score(s.get("fake_chart_score")))
    meters.add_row("GoPlus risk", score(s.get("goplus_risk_score")))
    if s.get("sniper_count"):
        meters.add_row("Snipers", Text(str(s["sniper_count"]), style="warn"))

    return Panel(Group(meters, Text(""), rows),
                 title="[accent]Signal Flags[/accent]", title_align="left", **PANEL_KW)


def ai_panel(p: dict) -> Panel:
    if p.get("_error"):
        return Panel(Text(p["_error"], style="bad"),
                     title="[accent]AI Analysis[/accent]", title_align="left", **PANEL_KW)

    head = kv_table()
    head.add_row("Momentum", Text(str(p.get("momentum", "-")).upper(), style="accent2"))
    head.add_row("Stage", str(p.get("stage", "-")).replace("_", " ").title())
    rng = p.get("peak_mc_range") or {}
    head.add_row("Est. peak MC",
                 f"{usd(p.get('estimated_peak_mc'))}   "
                 f"[dim2]range {usd(rng.get('low'))} - {usd(rng.get('high'))}[/dim2]")
    head.add_row("Suggested entry / exit",
                 f"{usd(p.get('recommended_entry_mc'))}  ->  "
                 f"{usd(p.get('recommended_exit_mc'))}")
    if p.get("dip_likely"):
        head.add_row("Dip expected",
                     Text(f"yes, ~{p.get('dip_estimated_depth_pct', 0)}% deep", style="warn"))

    bands = p.get("probability_bands") or {}
    keys = ["100k", "250k", "500k", "1m", "5m", "10m"]
    bt = Table(box=None, header_style="accent2", pad_edge=False)
    for b in keys:
        bt.add_column(b.upper(), justify="center")
    bt.add_row(*[
        Text(f"{bands.get(b, 0)}%",
             style="good" if bands.get(b, 0) >= 50
             else "warn" if bands.get(b, 0) >= 20 else "dim2")
        for b in keys
    ])

    reasoning = Text(p.get("reasoning") or "-", style="value")
    return Panel(
        Group(head, Text(""), Text("Odds of reaching", style="label"), bt,
              Text(""), Rule(style="#4c1d95"), Text(""), reasoning),
        title="[accent]AI Analysis[/accent]", title_align="left", **PANEL_KW,
    )


# ---------------------------------------------------------------- main

BANNER = r"""
  ___  ___  ___ ___ _____
 / _ \| _ \| _ ) __|_   _|
| (_) |   /| _ \ _ \  | |     personal terminal analyzer
 \___/|_|_\|___/___/  |_|
"""


def looks_like_mint(v: str) -> bool:
    return bool(re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}", v or ""))


async def run(mint: str) -> None:
    console.print()
    console.print(f"[label]Analyzing[/label] [accent]{mint}[/accent]")
    t0 = time.time()

    snap = await build_snapshot(mint)

    if not snap["market_cap_usd"] and not snap.get("top_holders"):
        console.print(centered(Panel(
            Text("No market or holder data found. Check the mint - it may be "
                 "brand new, delisted, or not a Solana token.", style="warn"),
            title="[accent]Nothing to analyze[/accent]", title_align="left", **PANEL_KW)))
        return

    console.print("  [accent2]*[/accent2] [label]claude narrative[/label]")
    pred = await analyze(snap)

    console.print()
    console.print(Rule(
        f"[accent]{snap['name']}[/accent] [dim2]-[/dim2] [accent2]${snap['symbol']}[/accent2]",
        style="#4c1d95"))
    console.print()
    console.print(centered(market_panel(snap)))
    console.print(centered(holders_panel(snap)))
    console.print(centered(flags_panel(snap, pred)))
    console.print(centered(ai_panel(pred)))
    console.print(Align.center(Text(f"done in {time.time() - t0:.1f}s - "
                                    f"{time.strftime('%H:%M:%S')}", style="dim2")))


QUIT_WORDS = {"q", "quit", "exit"}


def show_header() -> None:
    """Fresh screen: title bar, centered banner, missing-key warning."""
    console.clear()
    console.print(Rule("[bold purple]ORBIT PERSONAL[/bold purple]", style="bold purple"))
    console.print(Align.center(Text(BANNER.strip("\n"), style="accent")))
    console.print()
    if not ANTHROPIC_API_KEY:
        console.print(Align.center(Text(
            "ANTHROPIC_API_KEY not found in backend/.env - "
            "aggregators will run but the AI panel will be empty.", style="warn")))
        console.print()


def ask_mint() -> str:
    return Prompt.ask("[bold purple]  Token mint[/bold purple] [dim](q to exit)[/dim]",
                      console=console).strip()


async def main() -> None:
    show_header()

    # A mint on argv runs once and exits; otherwise loop so you can paste several.
    if len(sys.argv) > 1:
        await run(sys.argv[1].strip())
        return

    mint = ask_mint()
    while True:
        if not mint or mint.lower() in QUIT_WORDS:
            console.print("[dim2]  bye[/dim2]\n")
            return
        if not looks_like_mint(mint):
            console.print("[warn]  That doesn't look like a Solana mint "
                          "(expected 32-44 base58 chars).[/warn]\n")
            mint = ask_mint()
            continue
        try:
            await run(mint)
        except Exception as exc:
            console.print(f"[bad]  Analysis failed: {exc}[/bad]\n")

        console.print()
        console.print(Rule("[bold purple]next[/bold purple]", style="bold purple"))
        answer = Prompt.ask(
            "[bold purple]  Analyze another token?[/bold purple] "
            "[dim](paste a mint, Enter to continue, q to exit)[/dim]",
            console=console, default="", show_default=False,
        ).strip()
        if answer.lower() in QUIT_WORDS | {"n", "no"}:
            console.print("[dim2]  bye[/dim2]\n")
            return

        show_header()
        mint = answer if looks_like_mint(answer) else ask_mint()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, EOFError):
        console.print("\n[dim2]  interrupted[/dim2]\n")
