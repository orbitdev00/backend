"""
KIKO XGBoost Inference Engine
================================
Drop-in replacement for engine/claude.py
Same input/output interface — just much faster and free.

Usage in main.py:
  from ml.predictor import predict_xgboost as analyze
  # instead of:
  from engine.claude import analyze
"""
import json, os, pickle, time
import numpy as np

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
_reg    = None
_clf    = None
_scaler = None
_meta   = None


def _load_models():
    global _reg, _clf, _scaler, _meta
    if _reg is not None and _scaler is not None:
        return True
    try:
        import xgboost as xgb
        reg_path  = os.path.join(MODELS_DIR, "peak_mc_regressor.json")
        scl_path  = os.path.join(MODELS_DIR, "feature_scaler.pkl")
        meta_path = os.path.join(MODELS_DIR, "metadata.json")

        # Classifier — prefer calibrated pkl, fall back to raw pkl, then json
        clf_pkl  = os.path.join(MODELS_DIR, "rug_classifier.pkl")
        clf_json = os.path.join(MODELS_DIR, "rug_classifier.json")

        missing = [p for p in [reg_path, scl_path, meta_path] if not os.path.exists(p)]
        if missing:
            print(f"[XGBoost] Missing model files: {missing}")
            return False

        _reg = xgb.XGBRegressor()
        _reg.load_model(reg_path)

        if os.path.exists(clf_pkl):
            with open(clf_pkl, "rb") as f: _clf = pickle.load(f)
        elif os.path.exists(clf_json):
            _clf = xgb.XGBClassifier()
            _clf.load_model(clf_json)
        else:
            print("[XGBoost] No classifier found — falling back to rules")
            return False

        with open(scl_path, "rb") as f: _scaler = pickle.load(f)
        with open(meta_path)       as f: _meta   = json.load(f)
        print(f"[XGBoost] Models loaded — features: {len(_meta.get('feature_cols', []))}")
        return True
    except Exception as e:
        print(f"[XGBoost] Failed to load models: {e}")
        import traceback; traceback.print_exc()
        import traceback; traceback.print_exc()
        return False


def _extract_features(snapshot: dict) -> list:
    """Extract features matching train.py's extract_features exactly."""
    import math
    features = _meta["features"] if _meta else []

    def safe(key, default=0.0):
        v = snapshot.get(key, default)
        if v is None: return default
        if isinstance(v, bool): return float(v)
        try: return float(v)
        except: return default

    mc       = safe("market_cap_usd") or 1
    vol_1h   = safe("volume_1h")
    vol_5m   = safe("volume_5m")
    liq      = safe("liquidity_usd") or 1
    buys     = safe("txns_5m_buys")
    sells    = safe("txns_5m_sells")
    age_s    = safe("age_seconds") or 1
    holders  = safe("total_holders")
    fresh    = safe("fresh_wallet_pct")
    bundle   = safe("bundle_confidence")
    dev_hold = safe("dev_holding_pct")
    dev_rug  = safe("dev_rug_rate_pct")
    social   = safe("social_count")
    insider  = safe("insider_pct")
    txns_1h  = safe("txns_1h_buys") + safe("txns_1h_sells")
    age_h    = max(age_s / 3600, 0.01)

    eng_map = {
        "_vol_mc_ratio":     min(vol_1h / mc, 100),
        "_liq_mc_ratio":     min(liq / mc, 10),
        "_vol_velocity":     min(vol_5m / max(vol_1h, 1), 10),
        "_buy_pressure":     (buys - sells) / max(buys + sells, 1),
        "_age_hours":        age_h,
        "_holders_per_hour": min(holders / age_h, 10000),
        "_fresh_x_bundle":   (fresh / 100) * (bundle / 100),
        "_dev_risk":         (dev_hold / 100) * (dev_rug / 100),
        "_social_x_mc":      social * math.log1p(mc),
        "_insider_x_fresh":  (insider / 100) * (fresh / 100),
        "_liq_per_holder":   min(liq / max(holders, 1), 10000),
        "_txn_rate":         min(txns_1h / age_h, 1000),
    }

    result = []
    for f in features:
        if f.startswith("_"):
            result.append(eng_map.get(f, 0.0))
        else:
            result.append(safe(f))
    return result


def _probability_bands(peak_mc: float, current_mc: float) -> dict:
    """Generate probability bands based on predicted peak.
    Caps at 75% max — nothing is ever certain in memecoins."""
    milestones = {"100k": 100_000, "250k": 250_000, "500k": 500_000,
                  "1m": 1_000_000, "5m": 5_000_000, "10m": 10_000_000}
    bands = {}
    for label, target in milestones.items():
        if current_mc >= target:
            # Already passed this milestone — still not 95%, could reverse
            bands[label] = 65
        elif peak_mc >= target * 2:
            # Peak is 2x+ above target — high confidence but capped at 75
            ratio = min(peak_mc / target, 4.0)
            bands[label] = min(75, int(ratio * 20))
        elif peak_mc >= target:
            ratio = peak_mc / target
            bands[label] = min(60, int(ratio * 35))
        else:
            bands[label] = max(0, int((peak_mc / target) * 15))
    return bands


def _momentum_label(snapshot: dict) -> str:
    change_5m = snapshot.get("price_change_5m", 0) or 0
    change_1h = snapshot.get("price_change_1h", 0) or 0
    bsr       = snapshot.get("buy_sell_ratio_5m", 1) or 1
    if change_1h < -15: return "dead"
    if change_1h < -5:  return "weak"
    if change_5m > 20 and bsr > 2: return "parabolic"
    if change_5m > 5 or bsr > 1.5: return "strong"
    if change_5m > 0: return "building"
    return "weak"


def _stage_label(snapshot: dict, predicted_peak: float) -> str:
    mc          = snapshot.get("market_cap_usd", 0) or 0
    is_migrated = snapshot.get("is_migrated", False)
    change_1h   = snapshot.get("price_change_1h", 0) or 0
    pct_from_pk = snapshot.get("pct_from_24h_peak", 0) or 0

    if pct_from_pk > 40 and change_1h < -15: return "declining"
    if is_migrated or mc > 34_000:
        if change_1h > 10: return "post_migration_pump"
        return "migrated"
    return "bonding_curve" if mc < 20_000 else "pre_migration"


def _build_reasoning(snap: dict, peak_mc: float, rug_proba: float, bands: dict, risk_score: int, elapsed: float) -> str:
    mc       = snap.get("market_cap_usd", 0) or 0
    momentum = _momentum_label(snap)
    stage    = snap.get("stage", "")
    bsr      = snap.get("buy_sell_ratio_5m", 0) or 0
    vol_1h   = snap.get("volume_1h", 0) or 0
    age_s    = snap.get("age_seconds", 0) or 0
    age_min  = age_s // 60

    parts = []

    # Stage / momentum context
    if stage in ("migrated", "post_migration_pump"):
        parts.append(f"Coin has migrated to Raydium at ${mc:,.0f} MC.")
    elif stage == "bonding_curve":
        parts.append(f"Coin is on the bonding curve at ${mc:,.0f} MC ({age_min}m old).")
    elif stage == "declining":
        parts.append(f"Coin appears to be declining — down significantly from peak.")

    # Buy pressure
    if bsr >= 2:
        parts.append(f"Strong buy pressure ({bsr:.1f}x buys vs sells).")
    elif bsr < 1 and bsr > 0:
        parts.append(f"More sells than buys ({bsr:.1f}x ratio) — bearish.")

    # Volume
    if vol_1h > 100_000:
        parts.append(f"High 1h volume (${vol_1h:,.0f}).")
    elif vol_1h < 1_000:
        parts.append(f"Very low 1h volume (${vol_1h:,.0f}) — low interest.")

    # Rug signals
    if snap.get("is_honeypot"):
        parts.append("HONEYPOT detected — cannot sell.")
    if snap.get("dev_is_serial_rugger"):
        parts.append(snap.get("dev_history_summary", "Dev has rug history."))
    if snap.get("uniform_holders_detected"):
        parts.append(f"Uniform holder distribution (variance {snap.get('uniform_holder_variance', 0):.3f}) — possible wallet farm.")
    if snap.get("shared_funder_detected") and snap.get("shared_funder_wallets", 0) > 0:
        parts.append(f"{snap.get('shared_funder_wallets')} buyers share same funding source.")
    if snap.get("bundle_detected") and snap.get("bundle_confidence", 0) > 40:
        parts.append(f"Bundle detected ({snap.get('bundle_confidence')}% confidence).")
    if snap.get("fake_chart_score", 0) > 40:
        parts.append(f"Suspicious chart activity (score {snap.get('fake_chart_score')}/100).")

    # Peak outlook
    chance_1m = bands.get("1m", 0)
    if chance_1m >= 40:
        parts.append(f"Estimated peak ${peak_mc:,.0f} — {chance_1m}% chance of reaching $1M.")
    elif chance_1m >= 10:
        parts.append(f"Estimated peak ${peak_mc:,.0f} ({chance_1m}% chance of $1M).")
    else:
        parts.append(f"Estimated peak ${peak_mc:,.0f} — low probability of major upside.")

    parts.append(f"Risk score {risk_score}/100. Rug probability {rug_proba:.0f}%. Inference: {elapsed}ms.")

    return " ".join(parts)


async def predict_xgboost(snapshot: dict) -> dict:
    """
    Main prediction function — replaces analyze() from engine/claude.py.
    Returns same dict structure so no other code needs to change.
    """
    if not _load_models():
        # Fallback to rule-based if models not trained yet
        return _rule_based_fallback(snapshot)

    t0 = time.time()
    features = _extract_features(snapshot)
    if _scaler is None:
        print("[XGBoost] Scaler is None — falling back to rules")
        return _rule_based_fallback(snapshot)
    X = _scaler.transform([features])

    # Peak MC prediction
    peak_log  = _reg.predict(X)[0]
    peak_mc   = float(np.expm1(peak_log))

    # Rug probability — apply prior correction for class imbalance
    # Raw probability is biased toward rug because 80% of training data is rug
    # Correct for this: P(rug|features) adjusted for true base rate
    raw_prob  = float(_clf.predict_proba(X)[0][1])

    # Training rug rate from metadata (e.g. 0.8 = 80% of training was rug)
    train_rug_rate = _meta.get("rug_rate", 0.8)
    # Assume real-world rug rate is lower (~50% of all coins)
    true_prior = 0.50
    # Bayes correction: rescale probability
    if train_rug_rate > 0 and train_rug_rate < 1:
        odds_raw       = raw_prob / max(1 - raw_prob, 1e-6)
        prior_ratio    = (true_prior / (1 - true_prior)) / (train_rug_rate / (1 - train_rug_rate))
        corrected_odds = odds_raw * prior_ratio
        corrected_prob = corrected_odds / (1 + corrected_odds)
    else:
        corrected_prob = raw_prob

    rug_proba = corrected_prob * 100

    current_mc = snapshot.get("market_cap_usd", 0) or 0

    # Clamp peak to reasonable bounds
    peak_mc = max(peak_mc, current_mc * 1.05)
    peak_mc = min(peak_mc, current_mc * 20)

    risk_score = min(100, int(rug_proba * 0.6 + snapshot.get("goplus_risk_score", 0) * 0.4))
    bands      = _probability_bands(peak_mc, current_mc)
    momentum   = _momentum_label(snapshot)
    stage      = _stage_label(snapshot, peak_mc)

    # Entry/exit suggestions
    entry_mc = current_mc * 1.05
    exit_mc  = peak_mc * 0.75  # take profit before full peak

    elapsed = round((time.time() - t0) * 1000, 1)
    print(f"[XGBoost] Prediction in {elapsed}ms — peak: ${peak_mc:,.0f}, rug: {rug_proba:.0f}%")

    return {
        "estimated_peak_mc":   round(peak_mc),
        "peak_mc_range":       {"low": round(peak_mc * 0.6), "high": round(peak_mc * 1.4)},
        "probability_bands":   bands,
        "dip_likely":          momentum in ("building", "strong"),
        "dip_estimated_depth_pct": 20 if momentum == "strong" else 10,
        "risk_score":          risk_score,
        "rug_probability":     round(rug_proba),
        "bundle_impact":       "high" if snapshot.get("bundle_confidence", 0) > 60 else
                               "medium" if snapshot.get("bundle_confidence", 0) > 30 else "none",
        "recommended_entry_mc":  round(entry_mc),
        "recommended_exit_mc":   round(exit_mc),
        "pnl_scenarios": {
            "conservative": round(peak_mc * 0.5 / max(current_mc, 1), 2),
            "moderate":     round(peak_mc * 0.75 / max(current_mc, 1), 2),
            "aggressive":   round(peak_mc / max(current_mc, 1), 2),
        },
        "flags":        _build_flags(snapshot, rug_proba),
        "bullish_flags": _build_bullish(snapshot),
        "momentum":     momentum,
        "stage":        stage,
        "reasoning":    _build_reasoning(snapshot, peak_mc, rug_proba, bands, risk_score, elapsed),
        "model":        "xgboost",
        "mint":         snapshot.get("mint"),
        "snapshot_timestamp": snapshot.get("timestamp"),
        "current_mc":   current_mc,
    }


def _build_flags(snapshot: dict, rug_proba: float) -> list:
    flags = []
    if snapshot.get("is_honeypot"):        flags.append("HONEYPOT — cannot sell")
    if snapshot.get("dev_is_serial_rugger"): flags.append(snapshot.get("dev_history_summary","Serial rugger dev"))
    if snapshot.get("shared_funder_detected"): flags.append(f"Wallet farm — {snapshot.get('shared_funder_wallets',0)} coordinated buyers")
    if snapshot.get("bundle_detected") and snapshot.get("bundle_confidence",0) > 50:
        flags.append(f"Bundle detected ({snapshot.get('bundle_confidence',0)}% confidence)")
    if snapshot.get("can_freeze"):         flags.append("Freeze authority active")
    if snapshot.get("can_mint"):           flags.append("Mint authority active")
    if snapshot.get("dev_holding_pct",0) > 10: flags.append(f"Dev holds {snapshot.get('dev_holding_pct',0):.1f}%")
    if snapshot.get("fake_chart_score",0) > 50: flags.append("Suspicious chart activity detected")
    if rug_proba >= 85 and not flags:      flags.append(f"High rug probability ({rug_proba:.0f}%) — model detects manipulation signals")
    elif rug_proba >= 70:                  flags.append(f"Elevated rug probability ({rug_proba:.0f}%)")
    return flags[:8]


def _build_bullish(snapshot: dict) -> list:
    flags = []
    if snapshot.get("king_of_the_hill"):   flags.append("King of the Hill on Pump.fun")
    if snapshot.get("buy_sell_ratio_5m",0) > 2: flags.append(f"Strong buy pressure ({snapshot.get('buy_sell_ratio_5m',0):.1f}x buys vs sells)")
    if snapshot.get("social_count",0) >= 2: flags.append("Active social presence")
    if snapshot.get("dev_prev_rugs",0) == 0 and snapshot.get("dev_prev_launches",0) > 0:
        flags.append(f"Dev has {snapshot.get('dev_prev_launches',0)} previous coins with no rugs")
    return flags[:4]


def _rule_based_fallback(snapshot: dict) -> dict:
    """
    Used before models are trained.
    Simple weighted heuristic — deterministic, no Claude needed.
    """
    mc      = snapshot.get("market_cap_usd", 0) or 0
    age_s   = snapshot.get("age_seconds", 0) or 0
    bsr     = snapshot.get("buy_sell_ratio_5m", 1) or 1
    vol_1h  = snapshot.get("volume_1h", 0) or 0

    # Risk score — weighted flags
    risk = 0
    if snapshot.get("is_honeypot"):              risk += 80
    if snapshot.get("dev_is_serial_rugger"):     risk += 30
    if snapshot.get("can_freeze"):               risk += 15
    if snapshot.get("can_mint"):                 risk += 10
    if snapshot.get("dev_holding_pct",0) > 15:  risk += 15
    if snapshot.get("bundle_confidence",0) > 70: risk += 15
    if snapshot.get("fake_chart_score",0) > 60: risk += 15
    if snapshot.get("shared_funder_detected") and snapshot.get("shared_funder_wallets",0) >= 5: risk += 20
    if snapshot.get("uniform_holders_detected"): risk += 20
    if snapshot.get("mc_collapse_detected"):     risk += 30
    risk = min(100, risk)

    # Rug probability — separate from risk, weighted differently
    # Actual rug = price collapse + dead volume, not just flags
    rug = 0
    if snapshot.get("is_honeypot"):             rug += 85
    if snapshot.get("mc_collapse_detected"):    rug += 60
    if snapshot.get("dev_is_serial_rugger"):    rug += 25
    if snapshot.get("uniform_holders_detected"): rug += 20
    if snapshot.get("shared_funder_detected") and snapshot.get("shared_funder_wallets",0) >= 5: rug += 20
    if snapshot.get("can_freeze"):              rug += 10
    # Volume/price signals reduce rug score on active coins
    if vol_1h > 50_000:                         rug = max(0, rug - 20)
    if bsr > 2.0:                               rug = max(0, rug - 15)
    if snapshot.get("price_change_1h",0) > 20:  rug = max(0, rug - 10)
    rug = min(100, rug)

    # Peak MC estimate
    multiplier = 3.0
    if bsr > 2 and vol_1h > 10_000: multiplier = 6.0
    elif bsr > 1.5:                  multiplier = 4.0
    elif bsr < 1.0:                  multiplier = 1.5
    if risk > 60: multiplier *= 0.5
    peak_mc = mc * multiplier

    bands = _probability_bands(peak_mc, mc)
    stage = _stage_label(snapshot, peak_mc)

    return {
        "estimated_peak_mc": round(peak_mc),
        "peak_mc_range": {"low": round(peak_mc*0.5), "high": round(peak_mc*2)},
        "probability_bands": bands,
        "dip_likely": bsr > 1.5,
        "dip_estimated_depth_pct": 20,
        "risk_score": risk,
        "rug_probability": rug,
        "bundle_impact": "high" if snapshot.get("bundle_confidence",0) > 60 else "none",
        "recommended_entry_mc": round(mc*1.05),
        "recommended_exit_mc": round(peak_mc*0.75),
        "pnl_scenarios": {
            "conservative": round(multiplier * 0.5, 2),
            "moderate":     round(multiplier * 0.75, 2),
            "aggressive":   round(multiplier, 2),
        },
        "flags":        _build_flags(snapshot, risk),
        "bullish_flags": _build_bullish(snapshot),
        "momentum":     _momentum_label(snapshot),
        "stage":        stage,
        "reasoning":    _build_reasoning(snapshot, peak_mc, float(risk), {
                            "100k": bands.get("100k",0), "250k": bands.get("250k",0),
                            "500k": bands.get("500k",0), "1m": bands.get("1m",0),
                            "5m": bands.get("5m",0), "10m": bands.get("10m",0),
                        }, risk, 0.1),
        "model":        "rules",
        "mint":         snapshot.get("mint"),
        "snapshot_timestamp": snapshot.get("timestamp"),
        "current_mc":   mc,
    }
