"""
KIKO XGBoost Training Pipeline
================================
Trains two models from Supabase prediction history:
  1. peak_mc_regressor  — predicts estimated peak market cap
  2. rug_classifier     — predicts rug probability (0-100)

Run from backend/ directory:
  python ml/train.py

Outputs:
  ml/models/peak_mc_regressor.json
  ml/models/rug_classifier.json
  ml/models/feature_scaler.pkl
  ml/models/metadata.json
"""
import asyncio, httpx, json, os, sys, pickle
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL  = os.getenv("SUPABASE_URL")
SUPABASE_ANON = os.getenv("SUPABASE_ANON_KEY")
HEADERS = {"apikey": SUPABASE_ANON, "Authorization": f"Bearer {SUPABASE_ANON}"}
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


# ── Feature extraction ────────────────────────────────────────────────────────

FEATURES = [
    # Market
    "market_cap_usd", "liquidity_usd",
    "volume_5m", "volume_1h", "volume_24h",
    "price_change_5m", "price_change_1h", "price_change_24h",
    "buy_sell_ratio_5m", "txns_5m_buys", "txns_5m_sells",
    "pct_from_24h_peak",
    # Holders
    "top10_concentration_pct", "dev_holding_pct", "dev_sell_pct",
    "fresh_wallet_pct", "total_holders",
    # Bundle / farm
    "bundle_detected", "bundle_confidence", "bundled_wallet_count",
    "shared_funder_detected", "shared_funder_pct",
    "uniform_holders_detected", "uniform_holder_variance",
    # Security
    "fake_chart_score", "is_honeypot", "can_mint", "can_freeze",
    "goplus_risk_score", "sniper_count", "mc_collapse_detected",
    # Social / meta
    "social_count", "age_seconds", "is_migrated", "king_of_the_hill",
    "migration_pct_complete",
    # Dev history
    "dev_is_serial_rugger", "dev_rug_rate_pct",
    "dev_prev_launches", "dev_prev_rugs",
    # === ENGINEERED FEATURES (computed below) ===
    "_vol_mc_ratio",        # volume_1h / market_cap
    "_liq_mc_ratio",        # liquidity / MC
    "_vol_velocity",        # volume_5m / volume_1h
    "_buy_pressure",        # (buys - sells) / (buys + sells)
    "_age_hours",           # age in hours
    "_holders_per_hour",    # holders / age_hours
    "_fresh_x_bundle",      # fresh_wallet_pct * bundle_confidence
    "_dev_risk",            # dev_holding * dev_rug_rate
    "_social_x_mc",         # social_count * log(MC)
    "_insider_x_fresh",     # insider_pct * fresh_wallet_pct
    "_liq_per_holder",      # liquidity / holders
    "_txn_rate",            # txns_1h / age_hours
]


def extract_features(snapshot: dict) -> list:
    """Extract feature vector including engineered features."""
    def safe(key, default=0.0):
        v = snapshot.get(key, default)
        if v is None: return default
        if isinstance(v, bool): return float(v)
        try: return float(v)
        except: return default

    import math

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
    age_h    = max(age_s / 3600, 0.01)

    insider  = safe("insider_pct")
    txns_1h  = safe("txns_1h_buys") + safe("txns_1h_sells")

    engineered = [
        min(vol_1h / mc, 100),                             # _vol_mc_ratio
        min(liq / mc, 10),                                 # _liq_mc_ratio
        min(vol_5m / max(vol_1h, 1), 10),                  # _vol_velocity
        (buys - sells) / max(buys + sells, 1),             # _buy_pressure
        age_h,                                             # _age_hours
        min(holders / age_h, 10000),                       # _holders_per_hour
        (fresh / 100) * (bundle / 100),                    # _fresh_x_bundle
        (dev_hold / 100) * (dev_rug / 100),                # _dev_risk
        social * math.log1p(mc),                           # _social_x_mc
        # NEW features
        (insider / 100) * (fresh / 100),                   # _insider_x_fresh
        min(liq / max(holders, 1), 10000),                 # _liq_per_holder
        min(txns_1h / age_h, 1000),                        # _txn_rate
    ]

    # Build in exact FEATURES order
    eng_map = {
        "_vol_mc_ratio":     engineered[0],
        "_liq_mc_ratio":     engineered[1],
        "_vol_velocity":     engineered[2],
        "_buy_pressure":     engineered[3],
        "_age_hours":        engineered[4],
        "_holders_per_hour": engineered[5],
        "_fresh_x_bundle":   engineered[6],
        "_dev_risk":         engineered[7],
        "_social_x_mc":      engineered[8],
        "_insider_x_fresh":  engineered[9],
        "_liq_per_holder":   engineered[10],
        "_txn_rate":         engineered[11],
    }
    result = []
    for f in FEATURES:
        if f.startswith("_"):
            result.append(eng_map.get(f, 0.0))
        else:
            result.append(safe(f))
    return result


# ── Data loading ──────────────────────────────────────────────────────────────

async def load_training_data():
    """Load all resolved predictions from Supabase."""
    print("Loading training data from Supabase...")
    rows = []
    offset = 0
    limit  = 1000

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/predictions",
                params={
                    "select": "*",
                    "actual_peak_mc": "not.is.null",
                    "order": "snapshot_timestamp.desc",
                    "limit": limit,
                    "offset": offset,
                },
                headers=HEADERS,
            )
            batch = resp.json() or []
            rows.extend(batch)
            if len(batch) < limit:
                break
            offset += limit

    print(f"Loaded {len(rows)} resolved predictions")
    return rows


def prepare_datasets(rows: list):
    """Convert rows into X/y arrays for both models."""
    X, y_peak, y_rug = [], [], []

    for row in rows:
        # All fields are flat columns — use row directly as snapshot
        snap = row
        actual_peak = row.get("actual_peak_mc")
        if not actual_peak or actual_peak <= 0:
            continue

        try:
            features = extract_features(snap)
            # Skip rows with all-zero features (bad data)
            if sum(abs(f) for f in features) == 0:
                continue

            X.append(features)
            y_peak.append(float(actual_peak))

            # Rug label: coin rugged if it never pumped meaningfully from entry
            mc_at_analysis = snap.get("market_cap_usd") or row.get("market_cap_at_analysis") or 0
            if mc_at_analysis > 0 and actual_peak > 0:
                # How much did the coin pump from entry to peak?
                pump_ratio = actual_peak / mc_at_analysis
                # Clean coin: pumped 2x+ from entry
                # Rug: peaked below 1.5x entry (went nowhere or immediately dumped)
                is_rug = int(pump_ratio < 1.5)
            else:
                is_rug = 1  # no data = assume rug

            y_rug.append(is_rug)

        except Exception as e:
            continue

    return np.array(X), np.array(y_peak), np.array(y_rug)


# ── Training ──────────────────────────────────────────────────────────────────

def train_models(X, y_peak, y_rug):
    try:
        import xgboost as xgb
        from sklearn.preprocessing import RobustScaler
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import mean_absolute_percentage_error, accuracy_score
    except ImportError:
        print("Installing dependencies...")
        os.system(f"{sys.executable} -m pip install xgboost scikit-learn --quiet")
        import xgboost as xgb
        from sklearn.preprocessing import RobustScaler
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import mean_absolute_percentage_error, accuracy_score

    print(f"\nTraining on {len(X)} samples, {len(FEATURES)} features")

    # Scale features
    scaler = RobustScaler()
    X_scaled = scaler.fit_transform(X)

    # Log-transform peak MC (heavy right skew)
    y_peak_log = np.log1p(y_peak)

    # Split
    X_tr, X_te, yp_tr, yp_te, yr_tr, yr_te = train_test_split(
        X_scaled, y_peak_log, y_rug, test_size=0.2, random_state=42
    )

    # ── Model 1: Peak MC Regressor ────────────────────────────────────────────
    print("\nTraining peak MC regressor...")
    reg = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42,
        verbosity=0,
    )
    reg.fit(X_tr, yp_tr, eval_set=[(X_te, yp_te)], verbose=False)

    yp_pred = np.expm1(reg.predict(X_te))
    yp_actual = np.expm1(yp_te)
    mape = mean_absolute_percentage_error(yp_actual, yp_pred) * 100
    print(f"Peak MC regressor — MAPE: {mape:.1f}%")

    # ── Model 2: Rug Classifier ───────────────────────────────────────────────
    print("\nTraining rug classifier...")

    # Class imbalance handling — weight rugs higher so we catch more of them
    n_neg = max(int((yr_tr == 0).sum()), 1)
    n_pos = max(int((yr_tr == 1).sum()), 1)
    # Cap scale_pos_weight at 1.0 minimum to avoid over-penalizing rugs
    # But also don't let it be too low — clamp between 0.5 and 3.0
    scale_pos = max(0.5, min(3.0, n_neg / n_pos))
    print(f"  Class balance — clean: {n_neg} | rug: {n_pos} | scale_pos_weight: {scale_pos:.2f}")

    clf_raw = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.03,
        subsample=0.8,
        colsample_bytree=0.7,
        min_child_weight=3,
        scale_pos_weight=scale_pos,
        gamma=0.1,
        random_state=42,
        verbosity=0,
        eval_metric="auc",
    )
    clf_raw.fit(X_tr, yr_tr, eval_set=[(X_te, yr_te)], verbose=False)

    # ── Calibration (Platt scaling) ───────────────────────────────────────────
    # Raw XGBoost probabilities are often overconfident.
    # Calibration makes 70% rug score = actually rugs 70% of the time.
    print("\nCalibrating rug classifier...")
    from sklearn.calibration import CalibratedClassifierCV
    clf_raw.fit(X_tr, yr_tr)
    clf = CalibratedClassifierCV(clf_raw, method="isotonic", cv=3)
    clf.fit(X_tr, yr_tr)
    clf.fit(X_te, yr_te)

    yr_proba = clf.predict_proba(X_te)[:, 1]

    # Find optimal threshold using F1 score on validation set
    from sklearn.metrics import f1_score
    best_thresh, best_f1 = 0.5, 0.0
    for thresh in [i/20 for i in range(5, 16)]:  # 0.25 to 0.75
        preds = (yr_proba >= thresh).astype(int)
        f1 = f1_score(yr_te, preds, zero_division=0)
        if f1 > best_f1:
            best_f1, best_thresh = f1, thresh

    print(f"  Optimal threshold: {best_thresh:.2f} (F1={best_f1:.3f})")
    yr_pred  = (yr_proba >= best_thresh).astype(int)
    acc      = accuracy_score(yr_te, yr_pred) * 100

    # Also compute AUC — better metric than accuracy for imbalanced classes
    from sklearn.metrics import roc_auc_score, classification_report
    try:
        auc = roc_auc_score(yr_te, yr_proba)
        print(f"Rug classifier — Accuracy: {acc:.1f}% | AUC: {auc:.3f}")
        print(classification_report(yr_te, yr_pred, target_names=["clean","rug"], zero_division=0))
    except Exception:
        print(f"Rug classifier — Accuracy: {acc:.1f}%")

    # ── Feature importance ────────────────────────────────────────────────────
    feat_names = [f for f in FEATURES if not f.startswith("_")] + [
        "_vol_mc_ratio","_liq_mc_ratio","_vol_velocity","_buy_pressure",
        "_age_hours","_holders_per_hour","_fresh_x_bundle","_dev_risk","_social_x_mc"
    ]
    importances = sorted(zip(feat_names, clf_raw.feature_importances_),
                         key=lambda x: x[1], reverse=True)
    print("\nTop 10 features:")
    for name, imp in importances[:10]:
        print(f"  {name:35} {imp:.4f}")

    return reg, clf, clf_raw, scaler, {
        "peak_mape": round(mape, 1),
        "rug_accuracy": round(acc, 1),
        "n_samples": len(X),
    }


def save_models(reg, clf, clf_raw, scaler, metrics):
    os.makedirs(MODELS_DIR, exist_ok=True)

    reg.save_model(os.path.join(MODELS_DIR, "peak_mc_regressor.json"))
    # CalibratedClassifierCV is a sklearn wrapper — use pickle
    import pickle
    with open(os.path.join(MODELS_DIR, "rug_classifier.pkl"), "wb") as f:
        pickle.dump(clf, f)

    with open(os.path.join(MODELS_DIR, "feature_scaler.pkl"), "wb") as f:
        pickle.dump(scaler, f)

    meta = {
        "features": FEATURES,
        "metrics":  metrics,
        "n_features": len(FEATURES),
    }
    with open(os.path.join(MODELS_DIR, "metadata.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\n✓ Models saved to ml/models/")
    print(f"  Peak MC MAPE:    {metrics['peak_mape']}%")
    print(f"  Rug accuracy:    {metrics['rug_accuracy']}%")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    rows = await load_training_data()

    if len(rows) < 20:
        print(f"\n⚠ Only {len(rows)} resolved predictions — need at least 20 to train.")
        print("Keep using KIKO and let the nightly job accumulate outcomes.")
        print("Come back when you have 50+ resolved predictions for a prototype model.")
        return

    X, y_peak, y_rug = prepare_datasets(rows)
    print(f"Samples after filtering: {len(X)}")

    # Balance classes — cap majority class at 3x minority to prevent bias
    n_rug   = int((y_rug == 1).sum())
    n_clean = int((y_rug == 0).sum())
    print(f"Raw class balance — clean: {n_clean} | rug: {n_rug}")

    if n_rug > 0 and n_clean > 0:
        majority   = max(n_rug, n_clean)
        minority   = min(n_rug, n_clean)
        cap        = min(majority, minority * 3)  # max 3:1 ratio
        rug_idx    = np.where(y_rug == 1)[0]
        clean_idx  = np.where(y_rug == 0)[0]
        np.random.seed(42)
        if n_rug > n_clean:
            rug_idx = np.random.choice(rug_idx, min(cap, n_rug), replace=False)
        else:
            clean_idx = np.random.choice(clean_idx, min(cap, n_clean), replace=False)
        keep = np.concatenate([rug_idx, clean_idx])
        np.random.shuffle(keep)
        X, y_peak, y_rug = X[keep], y_peak[keep], y_rug[keep]
        print(f"Balanced — clean: {int((y_rug==0).sum())} | rug: {int((y_rug==1).sum())}")

    print(f"Clean samples after filtering: {len(X)}")

    if len(X) < 20:
        print("⚠ Not enough clean samples after filtering. Check snapshot data quality.")
        return

    reg, clf, clf_raw, scaler, metrics = train_models(X, y_peak, y_rug)
    save_models(reg, clf, clf_raw, scaler, metrics)
    print("\n✓ Training complete. Run ml/test_model.py to verify predictions.")

if __name__ == "__main__":
    asyncio.run(main())
