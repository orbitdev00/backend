import asyncio
import json
import time
import traceback
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
from engine.claude import analyze          # Claude Haiku — primary
from ml.predictor import predict_xgboost  # XGBoost — background signals
from config import REFRESH_INTERVAL, MAX_AUTO_REFRESHES

app = FastAPI(title="Pump Analyzer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:5173",
    "http://localhost:3000",
    "https://orbit-app.xyz",
    "https://www.orbit-app.xyz",
],
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
    try:
        body = await request.json()
        wallet = body.get("wallet", "").strip()
        user_id = body.get("user_id", "").strip()

        if not wallet or not user_id:
            return JSONResponse({"error": "wallet and user_id required"}, status_code=400)

        # Validate wallet looks like a Solana address
        if len(wallet) < 32 or len(wallet) > 44:
            return JSONResponse({"error": "Invalid wallet address"}, status_code=400)

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
    trial = is_trial.lower() == "true" 
    # Trial mode — check fingerprint before running
    if trial:
        if not fingerprint:
            return JSONResponse({"error": "trial_no_fingerprint"}, status_code=403)
        available = await check_trial(fingerprint)
        if not available:
            return JSONResponse({"error": "trial_used"}, status_code=403)

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

        async def _log():
            try:
                await log_prediction(snapshot, prediction, user_id or None)
            except Exception as e:
                print(f"[Supabase] Background log error: {e}")
        asyncio.create_task(_log())
        return JSONResponse(result)
    except Exception as e:
        tb = traceback.format_exc()
        print(f"ERROR in analyze_once: {e}\n{tb}")
        return JSONResponse({"error": str(e), "traceback": tb}, status_code=500)


@app.get("/debug/{mint}")
async def debug_snapshot(mint: str):
    """Debug endpoint — returns raw snapshot without AI analysis."""
    try:
        snapshot = await build_snapshot(mint)
        return JSONResponse({"snapshot": snapshot})
    except Exception as e:
        tb = traceback.format_exc()
        print(f"ERROR in debug: {e}\n{tb}")
        return JSONResponse({"error": str(e), "traceback": tb}, status_code=500)


def _calculate_pnl(snapshot: dict, prediction: dict) -> dict:
    """
    Calculate PnL scenarios mathematically from snapshot data.
    Never trusts Claude for numbers — pure math.
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

    # Dead/rugged coin — requires BOTH high risk AND dead price action
    # A coin with 91% rug prob but $500K volume is NOT dead — it's risky but active
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
async def preview(mint: str):
    """
    Returns just DexScreener data instantly (~1s).
    Frontend shows this immediately while full analysis loads.
    """
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
async def stream_analysis(websocket: WebSocket, mint: str):
    """
    Streaming analysis WebSocket.
    Pushes partial results as each aggregator completes.
    Client receives live updates instead of waiting for full result.
    """
    await websocket.accept()

    async def send(msg_type: str, source: str, data: dict):
        try:
            await websocket.send_json({"type": msg_type, "source": source, "data": data})
        except Exception:
            pass

    try:
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
        async def _log():
            try:
                _loop = asyncio.get_event_loop()
                uid = request.query_params.get("user_id") or None
                await log_prediction(snapshot, prediction, uid)
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


@app.get("/test-supabase")
async def test_supabase():
    """Test Supabase connectivity directly."""
    import httpx
    from config import SUPABASE_URL, SUPABASE_ANON_KEY
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    test_row = {
        "mint": "TEST_CONNECTION",
        "name": "Test",
        "symbol": "TEST",
        "snapshot_timestamp": 0,
        "market_cap_at_analysis": 0,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(
                f"{SUPABASE_URL}/rest/v1/predictions",
                json=test_row,
                headers=headers,
            )
            return JSONResponse({
                "status": resp.status_code,
                "body": resp.text[:300],
                "supabase_url": SUPABASE_URL[:40] + "...",
                "key_prefix": SUPABASE_ANON_KEY[:20] + "...",
            })
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/outcome/{mint}")
async def submit_outcome(mint: str, actual_peak_mc: float, notes: str = ""):
    """Record the actual outcome for a previously analyzed coin."""
    success = await record_outcome(mint, actual_peak_mc, notes)
    if success:
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
async def debug_dex(mint: str):
    """Shows raw DexScreener response for debugging socials."""
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
