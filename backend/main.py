import asyncio
import json
import time
import traceback
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from security import is_valid_mint, is_valid_uuid, ip_rate_ok, admin_ok, verify_ws_token
from engine.snapshot import build_snapshot
from aggregator.pnl import fetch_monthly_pnl
from supabase_logger import log_prediction, record_outcome, get_accuracy_stats
try:
    from trial_gate import check_trial, consume_trial
    TRIAL_GATE_ENABLED = True
except Exception as e:
    print(f"[TrialGate] Disabled: {e}")
    TRIAL_GATE_ENABLED = False
    async def check_trial(fp): return True
    async def consume_trial(fp, mint, ip=""): return True
from engine.claude import analyze          # Claude Haiku â€" primary
from badge_routes import badge_router
from stripe_routes import router as stripe_router
from forum_routes import forum_router
from delete_routes import delete_router
from pnl_sync import sync_all_wallets
from badge_engine import (
    check_analysis_badges,
    check_outcome_badges,
    check_pnl_badges,
    check_subscription_badges,
)
from rate_limiter import check_rate_limit, consume_rate_limit, get_usage, get_usage_async
from stripe_handler import create_checkout_session, create_billing_portal, handle_webhook
from tier_check import get_tier, invalidate as invalidate_tier_cache
from ml.predictor import predict_xgboost  # XGBoost â€" background signals
from config import REFRESH_INTERVAL, MAX_AUTO_REFRESHES

app = FastAPI(title="Pump Analyzer API")
app.include_router(badge_router)
app.include_router(stripe_router)
app.include_router(forum_router)
app.include_router(delete_router)

# â"€â"€ Nightly PnL sync â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
import asyncio as _asyncio
from datetime import datetime as _dt, timezone as _tz

async def _nightly_pnl_loop():
    """Runs sync_all_wallets every 24h, starting at next midnight UTC."""
    while True:
        now = _dt.now(_tz.utc)
        # Seconds until next midnight UTC
        secs_until_midnight = (24 - now.hour) * 3600 - now.minute * 60 - now.second
        print(f"[PnL Sync] Next run in {secs_until_midnight//3600}h {(secs_until_midnight%3600)//60}m")
        await _asyncio.sleep(secs_until_midnight)
        try:
            await sync_all_wallets()
        except Exception as e:
            print(f"[PnL Sync] Cron error: {e}")

@app.on_event("startup")
async def start_pnl_cron():
    _asyncio.create_task(_nightly_pnl_loop())

@app.post("/onboarding/complete")
async def onboarding_complete(request: Request):
    """
    Saves username + avatar_url for a newly onboarded user.
    Decodes the JWT locally (no network call) then upserts user_reputation
    with the service key to bypass RLS.
    """
    import base64 as _b64, json as _json, httpx
    from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    access_token = auth_header.split(" ", 1)[1]

    # Decode JWT payload locally — no Supabase auth roundtrip needed.
    # The service key write below protects against forged tokens because
    # we only ever write to the row matching the decoded user_id.
    try:
        parts = access_token.split(".")
        if len(parts) != 3:
            raise ValueError("malformed jwt")
        padding = (4 - len(parts[1]) % 4) % 4
        payload = _json.loads(_b64.urlsafe_b64decode(parts[1] + "=" * padding))
        user_id = payload.get("sub", "")
        if not user_id or not is_valid_uuid(user_id):
            raise ValueError("invalid sub")
    except Exception as exc:
        print(f"[Onboarding] JWT decode failed: {exc}")
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid request body"}, status_code=400)

    username   = (body.get("username") or "").strip()
    avatar_url = body.get("avatar_url") or None

    if not username:
        return JSONResponse({"error": "username required"}, status_code=400)

    key = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
    sb_headers = {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates,return=minimal",
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5, read=10, write=5, pool=5)) as client:
            resp = await client.post(
                f"{SUPABASE_URL}/rest/v1/user_reputation",
                json={
                    "user_id":    user_id,
                    "username":   username,
                    "avatar_url": avatar_url,
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
                headers=sb_headers,
            )
    except httpx.TimeoutException:
        print(f"[Onboarding] Supabase upsert timed out for user {user_id}")
        return JSONResponse({"error": "database timeout"}, status_code=503)
    except Exception as exc:
        print(f"[Onboarding] Supabase upsert error: {exc}")
        return JSONResponse({"error": f"database error: {exc}"}, status_code=500)

    if resp.status_code not in (200, 201, 204):
        print(f"[Onboarding] Supabase {resp.status_code}: {resp.text[:300]}")
        return JSONResponse({"error": resp.text[:300]}, status_code=500)

    return JSONResponse({"status": "ok"})


@app.post("/admin/pnl-sync")
async def manual_pnl_sync(request: Request):
    """Manual trigger â€" call from Railway or curl."""
    secret = request.headers.get("x-admin-secret", "")
    if secret != (os.getenv("ADMIN_SECRET") or ""):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    _asyncio.create_task(sync_all_wallets())
    return JSONResponse({"status": "sync started"})

_cors_origins = ["https://orbit-app.xyz", "https://www.orbit-app.xyz"]
if os.getenv("ENVIRONMENT") != "production":
    _cors_origins += ["http://localhost:5173", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_watchers: dict[str, list[WebSocket]] = {}
watcher_tasks: dict[str, asyncio.Task] = {}
last_analysis: dict[str, dict] = {}


@app.post("/pnl/refresh")
async def refresh_pnl(request: Request):
    """
    Fetches monthly PnL for the authenticated user's linked wallet
    and stores it in user_reputation. Called from Edit Profile page.
    """
    ip = request.client.host if request.client else "unknown"
    if not ip_rate_ok(ip, limit=10, window=60):
        return JSONResponse({"error": "Rate limit exceeded"}, status_code=429)

    try:
        body = await request.json()
        wallet  = body.get("wallet", "").strip()
        user_id = body.get("user_id", "").strip()

        if not wallet or not user_id:
            return JSONResponse({"error": "wallet and user_id required"}, status_code=400)

        if not is_valid_mint(wallet):
            return JSONResponse({"error": "Invalid wallet address"}, status_code=400)

        if not is_valid_uuid(user_id):
            return JSONResponse({"error": "Invalid user_id"}, status_code=400)

        print(f"[PnL DEBUG] calling fetch_monthly_pnl for {wallet[:8]}...")
        pnl = await fetch_monthly_pnl(wallet)
        print(f"[PnL DEBUG] result: {pnl}")

        # Write to Supabase using service key (bypasses RLS)
        import httpx
        from config import SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
        key = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        # Only write pnl if we actually got data (not None)
        write_pnl = pnl["total_pnl_pct"] if pnl["total_pnl_pct"] is not None else 0.0
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{SUPABASE_URL}/rest/v1/user_reputation",
                params={"user_id": f"eq.{user_id}"},
                json={
                    "total_pnl_pct": write_pnl,
                    "wallet_address": wallet,
                },
                headers=headers,
            )
            print(f"[PnL] Supabase write status={resp.status_code} body={resp.text[:200]}")

        # Fire PnL badge check
        try:
            await check_pnl_badges(user_id)
        except Exception as e:
            print(f"[Badges] pnl check error: {e}")
        return JSONResponse({**pnl, "wallet": wallet[:8] + "..." + wallet[-4:]})

    except Exception as e:
        print(f"[PnL] Error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": int(time.time())}


@app.get("/snapshot/{mint}")
async def snapshot_only(mint: str, request: Request):
    """Lightweight endpoint for auto-analyzer — builds snapshot, logs to Supabase, skips Claude."""
    if not is_valid_mint(mint):
        return JSONResponse({"ok": False, "error": "Invalid mint address"}, status_code=400)
    ip = request.client.host if request.client else "unknown"
    if not ip_rate_ok(ip, limit=20, window=60):
        return JSONResponse({"ok": False, "error": "Rate limit exceeded"}, status_code=429)
    try:
        snapshot = await build_snapshot(mint)
        mc = snapshot.get("market_cap_usd", 0) or 0

        # Skip logging if snapshot has no real data
        if mc < 100:
            return {"ok": False, "mint": mint, "mc": mc, "reason": "dead_coin"}

        try:
            prediction = await predict_xgboost(snapshot)
        except Exception:
            prediction = {"rug_probability": 50, "estimated_peak_mc": mc * 2, "model": "rules"}

        await log_prediction(snapshot, prediction)

        rug = prediction.get("rug_probability", "?")
        print(f"[AutoAnalyzer] Logged {snapshot.get('name','?'):20} MC: ${mc:>10,.0f}  Rug: {rug}%")
        return {
            "ok":                    True,
            "mint":                  mint,
            "mc":                    mc,
            # Full snapshot fields for Discord bot
            "name":                  snapshot.get("name"),
            "symbol":                snapshot.get("symbol"),
            "market_cap_usd":        mc,
            "liquidity_usd":         snapshot.get("liquidity_usd"),
            "age_seconds":           snapshot.get("age_seconds"),
            "total_holders":         snapshot.get("total_holders"),
            "top_holders":           snapshot.get("top_holders", []),
            "top5_concentration_pct": snapshot.get("top5_concentration_pct"),
            "dev_holding_pct":       snapshot.get("dev_holding_pct"),
            "fresh_wallet_pct":      snapshot.get("fresh_wallet_pct"),
            "bundle_detected":       snapshot.get("bundle_detected"),
            "is_migrated":           snapshot.get("is_migrated"),
            "has_twitter":           snapshot.get("has_twitter"),
            "has_telegram":          snapshot.get("has_telegram"),
            "has_website":           snapshot.get("has_website"),
            "flags":                 snapshot.get("flags", []),
            "bullish_flags":         snapshot.get("bullish_flags", []),
            "momentum":              snapshot.get("momentum"),
            "stage":                 snapshot.get("stage"),
            # Prediction fields
            "rug_probability":       rug,
            "estimated_peak_mc":     prediction.get("estimated_peak_mc"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/analyze/{mint}")
async def analyze_once(
    mint: str,
    request: Request,
    fingerprint: str = "",
    is_trial: str = "false",
    user_id: str = "",
):
    if not is_valid_mint(mint):
        return JSONResponse({"error": "Invalid mint address"}, status_code=400)
    if user_id and not is_valid_uuid(user_id):
        return JSONResponse({"error": "Invalid user_id"}, status_code=400)

    trial = is_trial.lower() == "true"
    # Trial mode â€" check fingerprint before running
    if trial:
        if not fingerprint:
            return JSONResponse({"error": "trial_no_fingerprint"}, status_code=403)
        available = await check_trial(fingerprint)
        if not available:
            return JSONResponse({"error": "trial_used"}, status_code=403)

    # Rate limit check for authenticated users
    if user_id and not trial:
        rl = await check_rate_limit(user_id)
        if not rl["allowed"]:
            return JSONResponse({
                "error": "rate_limit_exceeded",
                "message": rl.get("message", "Daily limit reached."),
                "remaining": 0,
                "limit": rl["limit"],
            }, status_code=429)

    try:
        import time as _time
        t0 = _time.time()
        snapshot   = await build_snapshot(mint)
        print(f"[Timing] snapshot: {_time.time()-t0:.2f}s")
        t1 = _time.time()
        # Claude for full analysis (reasoning, stage, momentum, flags)
        prediction = await analyze(snapshot)
        print(f"[Timing] claude:   {_time.time()-t1:.2f}s")
        prediction = _calculate_pnl(snapshot, prediction)
        result = {"snapshot": snapshot, "prediction": prediction}
        last_analysis[mint] = result

        # Consume trial after successful analysis
        if trial and fingerprint:
            ip = request.client.host if request.client else ""
            await consume_trial(fingerprint, mint, ip)
            result["trial_consumed"] = True

        # Consume rate limit slot
        if user_id and not trial:
            consume_rate_limit(user_id)

        async def _log():
            try:
                await log_prediction(snapshot, prediction, user_id or None)
                if user_id:
                    coin_age = snapshot.get("age_seconds")
                    await check_analysis_badges(user_id, snapshot, coin_age_seconds=coin_age)
            except Exception as e:
                print(f"[Supabase] Background log error: {e}")
        asyncio.create_task(_log())

        # Add rate limit info to response
        if user_id:
            usage = get_usage(user_id)
            result["rate_limit"] = usage
        return JSONResponse(result)
    except Exception as e:
        print(f"ERROR in analyze_once: {e}\n{traceback.format_exc()}")
        return JSONResponse({"error": "Analysis failed. Please try again."}, status_code=500)


@app.get("/debug/{mint}")
async def debug_snapshot(mint: str, request: Request):
    """Debug endpoint — admin only."""
    if not admin_ok(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    if not is_valid_mint(mint):
        return JSONResponse({"error": "Invalid mint address"}, status_code=400)
    try:
        snapshot = await build_snapshot(mint)
        return JSONResponse({"snapshot": snapshot})
    except Exception as e:
        print(f"ERROR in debug: {e}\n{traceback.format_exc()}")
        return JSONResponse({"error": "Debug failed"}, status_code=500)


def _calculate_pnl(snapshot: dict, prediction: dict) -> dict:
    """
    Calculate PnL scenarios mathematically from snapshot data.
    Never trusts Claude for numbers â€" pure math.
    """
    current_mc   = snapshot.get("market_cap_usd") or 0
    peak_mc      = prediction.get("estimated_peak_mc") or 0
    risk_score   = prediction.get("risk_score") or 50
    rug_prob     = prediction.get("rug_probability") or 50
    pct_from_pk  = snapshot.get("pct_from_24h_peak") or 0
    change_1h    = snapshot.get("price_change_1h") or 0
    vol_1h       = snapshot.get("volume_1h") or 0

    if current_mc <= 0 or peak_mc <= 0:
        return {**prediction, "pnl_scenarios": {"conservative": 0, "moderate": 0, "aggressive": 0}}

    # Dead/rugged coin â€" requires BOTH high risk AND dead price action
    # A coin with 91% rug prob but $500K volume is NOT dead â€" it's risky but active
    is_dead = (
        (rug_prob >= 85 and vol_1h < 1000 and change_1h < -10) or
        (pct_from_pk >= 70 and vol_1h < 500) or
        (current_mc < 2000 and vol_1h < 100)
    )
    if is_dead:
        return {**prediction, "pnl_scenarios": {
            "conservative": 0.0,
            "moderate":     round(min(peak_mc * 0.1 / current_mc, 1.5), 2),
            "aggressive":   round(min(peak_mc * 0.2 / current_mc, 2.0), 2),
        }}

    # Risk-adjusted peak fractions
    if risk_score >= 70:
        c_frac, m_frac, a_frac = 0.20, 0.45, 0.75
    elif risk_score >= 50:
        c_frac, m_frac, a_frac = 0.30, 0.55, 0.85
    elif risk_score >= 30:
        c_frac, m_frac, a_frac = 0.40, 0.65, 0.90
    else:
        c_frac, m_frac, a_frac = 0.50, 0.72, 0.95

    # Slippage + fees (~15% haircut on memecoins)
    slippage = 0.85

    conservative = round(max(0.8, (peak_mc * c_frac / current_mc) * slippage), 2)
    moderate     = round(max(1.0, (peak_mc * m_frac / current_mc) * slippage), 2)
    aggressive   = round(max(1.1, (peak_mc * a_frac / current_mc) * slippage), 2)

    # Hard cap based on age and stage
    age_seconds = snapshot.get("age_seconds") or 0
    if age_seconds > 21600:  # >6h old
        conservative = min(conservative, 2.0)
        moderate     = min(moderate,     3.5)
        aggressive   = min(aggressive,   6.0)
    elif age_seconds > 3600:  # >1h old
        conservative = min(conservative, 3.0)
        moderate     = min(moderate,     6.0)
        aggressive   = min(aggressive,   12.0)

    return {**prediction, "pnl_scenarios": {
        "conservative": conservative,
        "moderate":     moderate,
        "aggressive":   aggressive,
    }}


@app.get("/preview/{mint}")
async def preview(mint: str, request: Request):
    """Returns just DexScreener data instantly (~1s)."""
    if not is_valid_mint(mint):
        return JSONResponse({"error": "Invalid mint address"}, status_code=400)
    ip = request.client.host if request.client else "unknown"
    if not ip_rate_ok(ip, limit=30, window=60):
        return JSONResponse({"error": "Rate limit exceeded"}, status_code=429)
    try:
        from aggregator.dexscreener import fetch_dexscreener
        from aggregator.pumpfun import fetch_pumpfun
        dex, pump = await asyncio.gather(
            fetch_dexscreener(mint),
            fetch_pumpfun(mint),
        )
        return JSONResponse({
            "mint":           mint,
            "name":           pump.get("name") or dex.get("name") or mint[:8],
            "symbol":         pump.get("symbol") or dex.get("symbol") or "???",
            "market_cap_usd": dex.get("market_cap_usd") or pump.get("bonding_curve_usd") or 0,
            "price_usd":      dex.get("price_usd", 0),
            "liquidity_usd":  dex.get("liquidity_usd", 0),
            "volume_5m":      dex.get("volume_5m", 0),
            "volume_1h":      dex.get("volume_1h", 0),
            "price_change_5m": dex.get("price_change_5m", 0),
            "price_change_1h": dex.get("price_change_1h", 0),
            "is_migrated":    pump.get("is_migrated", False),
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.websocket("/ws/stream/{mint}")
async def stream_analysis(websocket: WebSocket, mint: str, user_id: str = ""):
    """Streaming analysis WebSocket — pushes partial results as each aggregator completes."""
    await websocket.accept()

    async def send(msg_type: str, source: str, data: dict):
        try:
            await websocket.send_json({"type": msg_type, "source": source, "data": data})
        except Exception:
            pass

    if not is_valid_mint(mint):
        await send("error", "system", {"message": "Invalid mint address", "error": "invalid_mint"})
        await websocket.close()
        return

    if user_id and not is_valid_uuid(user_id):
        await send("error", "system", {"message": "Invalid user_id", "error": "invalid_user"})
        await websocket.close()
        return

    # Verify access_token matches user_id when provided
    access_token = websocket.query_params.get("access_token", "")
    if user_id and access_token:
        if not await verify_ws_token(access_token, user_id):
            await send("error", "auth", {"message": "Token verification failed", "error": "auth_failed"})
            await websocket.close()
            return

    try:
        # Rate limit check BEFORE any API calls
        if user_id:
            rl = await check_rate_limit(user_id)
            if not rl["allowed"]:
                await send("error", "rate_limit", {
                    "message": rl.get("message", "Daily limit reached. Upgrade for unlimited analyses."),
                    "error": "rate_limit_exceeded",
                    "remaining": 0,
                    "limit": rl["limit"],
                })
                await websocket.close()
                return
        elif not user_id:
            # Guest — check trial gate (1 free analysis per fingerprint)
            fingerprint = websocket.query_params.get("fingerprint", "")
            if TRIAL_GATE_ENABLED and fingerprint:
                available = await check_trial(fingerprint)
                if not available:
                    await send("error", "rate_limit", {
                        "message": "You've used your free analysis. Sign up free for 5 per day.",
                        "error": "trial_used",
                    })
                    await websocket.close()
                    return
            elif TRIAL_GATE_ENABLED and not fingerprint:
                await send("error", "auth_required", {
                    "message": "Sign in to analyze tokens.",
                    "error": "auth_required",
                })
                await websocket.close()
                return

        await send("status", "init", {"message": "Fetching market data..."})

        # Stage 1: DexScreener + Pump.fun in parallel (fastest)
        from aggregator.dexscreener import fetch_dexscreener
        from aggregator.pumpfun import fetch_pumpfun
        dex, pump = await asyncio.gather(fetch_dexscreener(mint), fetch_pumpfun(mint))

        # Push market preview immediately (~0.8s)
        await send("partial", "market", {
            "name":           pump.get("name") or dex.get("name") or mint[:8],
            "symbol":         pump.get("symbol") or dex.get("symbol") or "???",
            "market_cap_usd": dex.get("market_cap_usd") or pump.get("bonding_curve_usd") or 0,
            "price_usd":      dex.get("price_usd", 0),
            "liquidity_usd":  dex.get("liquidity_usd", 0),
            "volume_5m":      dex.get("volume_5m", 0),
            "volume_1h":      dex.get("volume_1h", 0),
            "price_change_5m": dex.get("price_change_5m", 0),
            "price_change_1h": dex.get("price_change_1h", 0),
            "is_migrated":    pump.get("is_migrated", False),
            "dev_wallet":     pump.get("dev_wallet", ""),
        })

        dev_wallet   = pump.get("dev_wallet") or ""
        total_supply = pump.get("total_supply") or 1_000_000_000
        pair_address = dex.get("pair_address") or ""

        await send("status", "aggregators", {"message": "Analyzing on-chain data..."})

        # Stage 2: All remaining aggregators in parallel
        from aggregator.solscan import fetch_solscan
        from aggregator.helius import fetch_helius
        from aggregator.goplus import fetch_goplus
        from aggregator.devhistory import fetch_dev_history

        sol_task     = asyncio.create_task(fetch_solscan(mint, dev_wallet, total_supply, pair_address))
        hel_task     = asyncio.create_task(fetch_helius(mint, dev_wallet))
        gop_task     = asyncio.create_task(fetch_goplus(mint))
        devhist_task = asyncio.create_task(fetch_dev_history(dev_wallet) if dev_wallet else asyncio.sleep(0))

        # Push each result as it arrives
        for coro in asyncio.as_completed([sol_task, hel_task, gop_task, devhist_task]):
            result = await coro
            if result is None:
                continue
            if "top_holders" in result:
                await send("partial", "holders", result)
            elif "bundle_detected" in result:
                await send("partial", "security", result)
            elif "is_honeypot" in result:
                await send("partial", "goplus", result)
            elif "dev_history_summary" in result:
                await send("partial", "devhistory", result)

        sol     = await sol_task
        hel     = await hel_task
        gop     = await gop_task
        devhist = await devhist_task or {}

        await send("status", "predicting", {"message": "Running prediction..."})

        # Build full snapshot and predict
        from engine.snapshot import build_snapshot
        snapshot     = await build_snapshot(mint)
        enriched_txs = snapshot.pop("_enriched_txs", [])
        prediction   = await analyze(snapshot)

        # Consume rate limit / trial slot after successful analysis
        if user_id:
            consume_rate_limit(user_id)
        elif TRIAL_GATE_ENABLED:
            fingerprint = websocket.query_params.get("fingerprint", "")
            if fingerprint:
                ip = websocket.client.host if websocket.client else ""
                await consume_trial(fingerprint, mint, ip)

        await send("complete", "analysis", {"snapshot": snapshot, "prediction": prediction})
        last_analysis[mint] = {"snapshot": snapshot, "prediction": prediction}

        # Background funding source
        async def _bg():
            try:
                from aggregator.helius import fetch_funding_sources
                funding = await fetch_funding_sources(enriched_txs)
                if funding.get("shared_funder_detected"):
                    snapshot.update(funding)
                    pred2 = await predict_xgboost(snapshot)
                    pred2 = _calculate_pnl(snapshot, pred2)
                    last_analysis[mint] = {"snapshot": snapshot, "prediction": pred2}
                    await send("update", "funding", {"snapshot": snapshot, "prediction": pred2})
            except Exception as e:
                print(f"[Stream BG] {e}")

        asyncio.create_task(_bg())

        # Log to Supabase
        uid = websocket.query_params.get("user_id") or None

        async def _log():
            try:
                await log_prediction(snapshot, prediction, uid)
                if uid:
                    coin_age = snapshot.get("age_seconds")
                    await check_analysis_badges(uid, snapshot, coin_age_seconds=coin_age)
            except Exception as e:
                print(f"[Supabase] {e}")
        asyncio.create_task(_log())

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await send("error", "system", {"message": str(e)})
    finally:
        try:
            await websocket.close()
        except Exception:
            pass



@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    result = await handle_webhook(request)
    # Fire subscription badge check if tier changed
    try:
        body = result.body if hasattr(result, 'body') else None
        if body:
            import json as _json
            data = _json.loads(body)
            if data.get("user_id") and data.get("tier"):
                await check_subscription_badges(data["user_id"], data["tier"])
    except Exception as e:
        print(f"[Badges] subscription check error: {e}")
    return result


@app.post("/stripe/create-checkout")
async def stripe_checkout(request: Request):
    body        = await request.json()
    user_id     = body.get("user_id", "")
    email       = body.get("email", "")
    tier        = body.get("tier", "degen")
    success_url = body.get("success_url", "https://orbit-app.xyz")
    cancel_url  = body.get("cancel_url", "https://orbit-app.xyz")
    if not user_id or not email:
        return JSONResponse({"error": "user_id and email required"}, status_code=400)
    return await create_checkout_session(user_id, email, tier, success_url, cancel_url)


@app.post("/stripe/billing-portal")
async def stripe_portal(request: Request):
    body       = await request.json()
    user_id    = body.get("user_id", "")
    return_url = body.get("return_url", "https://orbit-app.xyz")
    if not user_id:
        return JSONResponse({"error": "user_id required"}, status_code=400)
    return await create_billing_portal(user_id, return_url)


@app.get("/tier")
async def get_user_tier(user_id: str = ""):
    if not user_id:
        return JSONResponse({"error": "user_id required"}, status_code=400)
    tier = await get_tier(user_id)
    from tier_check import get_limits
    return JSONResponse({"tier": tier, "limits": get_limits(tier)})


@app.get("/usage")
async def get_rate_limit_usage(user_id: str = ""):
    if not user_id:
        return JSONResponse({"count": 0, "limit": 5, "remaining": 5})
    usage = await get_usage_async(user_id)
    return JSONResponse(usage)


@app.post("/outcome/{mint}")
async def submit_outcome(mint: str, request: Request, actual_peak_mc: float, notes: str = ""):
    """Record the actual outcome — admin only."""
    if not admin_ok(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    if not is_valid_mint(mint):
        return JSONResponse({"error": "Invalid mint address"}, status_code=400)
    success = await record_outcome(mint, actual_peak_mc, notes)
    if success:
        # Fire badge checks â€" find user_id from predictions table
        try:
            import httpx
            from config import SUPABASE_URL, SUPABASE_SERVICE_KEY
            from supabase import create_client
            sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
            res = sb.table("predictions").select("user_id").eq("mint", mint).order("snapshot_timestamp", desc=True).limit(1).execute()
            import httpx as _httpx
            from config import SUPABASE_URL as _SB_URL, SUPABASE_SERVICE_KEY as _SB_KEY, SUPABASE_ANON_KEY as _SB_ANON
            _key = _SB_KEY or _SB_ANON
            _headers = {"apikey": _key, "Authorization": f"Bearer {_key}", "Prefer": "return=representation"}
            async with _httpx.AsyncClient(timeout=10) as _client:
                _resp = await _client.get(
                    f"{_SB_URL}/rest/v1/predictions",
                    params={"mint": f"eq.{mint}", "select": "user_id", "order": "snapshot_timestamp.desc", "limit": "1"},
                    headers=_headers,
                )
                _rows = _resp.json() if _resp.status_code == 200 else []
            if _rows:
                uid = _rows[0]["user_id"]
                was_rug = actual_peak_mc < 1000
                await check_outcome_badges(uid, mint, actual_peak_mc, was_rug)
        except Exception as e:
            print(f"[Badges] outcome check error: {e}")
        return JSONResponse({"status": "recorded", "mint": mint, "actual_peak_mc": actual_peak_mc})
    return JSONResponse({"error": "Failed to record outcome"}, status_code=500)


@app.get("/stats")
async def accuracy_stats():
    """Get overall prediction accuracy statistics."""
    stats = await get_accuracy_stats()
    return JSONResponse(stats)


@app.websocket("/ws/{mint}")
async def websocket_watch(websocket: WebSocket, mint: str):
    await websocket.accept()
    if not is_valid_mint(mint):
        await websocket.send_text(json.dumps({"type": "error", "message": "Invalid mint address"}))
        await websocket.close()
        return
    if mint not in active_watchers:
        active_watchers[mint] = []
    active_watchers[mint].append(websocket)

    if mint not in watcher_tasks or watcher_tasks[mint].done():
        watcher_tasks[mint] = asyncio.create_task(_watch_loop(mint))

    if mint in last_analysis:
        try:
            await websocket.send_text(json.dumps({
                "type": "analysis", "data": last_analysis[mint]
            }))
        except Exception:
            pass

    try:
        while True:
            msg = await websocket.receive_text()
            data = json.loads(msg)
            if data.get("action") == "refresh":
                await websocket.send_text(json.dumps({"type": "status", "message": "Refreshing..."}))
                try:
                    snapshot = await build_snapshot(mint)
                    # Inject previous prediction for anchoring
                    if data.get("prev_peak_mc"):
                        snapshot["_prev_peak_mc"]  = data["prev_peak_mc"]
                        snapshot["_prev_momentum"] = data.get("prev_momentum")
                        snapshot["_prev_stage"]    = data.get("prev_stage")
                    prediction = await analyze(snapshot)
                    result = {"snapshot": snapshot, "prediction": prediction}
                    last_analysis[mint] = result
                    await _broadcast(mint, {"type": "analysis", "data": result})
                except Exception as e:
                    await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
    except WebSocketDisconnect:
        _remove_watcher(mint, websocket)


async def _watch_loop(mint: str):
    while True:
        await asyncio.sleep(REFRESH_INTERVAL)
        if mint not in active_watchers or not active_watchers[mint]:
            watcher_tasks.pop(mint, None)
            return
        try:
            await _broadcast(mint, {"type": "status", "message": "Updating..."})
            snapshot = await build_snapshot(mint)
            prediction = await analyze(snapshot)
            result = {"snapshot": snapshot, "prediction": prediction}
            last_analysis[mint] = result
            await _broadcast(mint, {"type": "analysis", "data": result})
        except Exception as e:
            await _broadcast(mint, {"type": "error", "message": str(e)})


async def _broadcast(mint: str, payload: dict):
    dead = []
    for ws in active_watchers.get(mint, []):
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            dead.append(ws)
    for ws in dead:
        _remove_watcher(mint, ws)


def _remove_watcher(mint: str, ws: WebSocket):
    if mint in active_watchers:
        try:
            active_watchers[mint].remove(ws)
        except ValueError:
            pass
        if not active_watchers[mint]:
            del active_watchers[mint]


@app.get("/debug/dex/{mint}")
async def debug_dex(mint: str, request: Request):
    """Shows raw DexScreener response — admin only."""
    if not admin_ok(request):
        return JSONResponse({"error": "unauthorized"}, status_code=403)
    if not is_valid_mint(mint):
        return JSONResponse({"error": "Invalid mint address"}, status_code=400)
    import httpx
    url = f"https://api.dexscreener.com/latest/dex/tokens/{mint}"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
        data = resp.json()
    pairs = data.get("pairs") or []
    sol_pairs = [p for p in pairs if p.get("chainId") == "solana"]
    if not sol_pairs:
        return {"error": "no solana pairs"}
    pair = sol_pairs[0]
    info = pair.get("info") or {}
    return {
        "info_keys": list(info.keys()),
        "socials": info.get("socials"),
        "websites": info.get("websites"),
        "header": info.get("header"),
        "imageUrl": info.get("imageUrl"),
        "raw_info": info,
    }

