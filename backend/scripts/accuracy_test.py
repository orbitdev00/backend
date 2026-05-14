"""
ORBIT XGBoost Accuracy Test
============================
Pulls historical predictions from Supabase and scores the model.

Tests:
  1. Rug classifier — precision/recall/F1 on coins with known outcomes
  2. Peak MC regression — MAE, MAPE, within-range accuracy
  3. Probability band calibration — how often each band's stated % is correct

Run from backend/:
  python ml/accuracy_test.py
"""

import os, sys, json, asyncio
import httpx
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import SUPABASE_URL, SUPABASE_ANON_KEY

HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Content-Type": "application/json",
}

RUG_THRESHOLD   = 60   # rug_probability >= this = model predicted rug
ACTUAL_RUG_DROP = 70   # coin dropped >=70% from analysis MC = actual rug
MIN_RECORDS     = 10   # minimum records needed for meaningful stats


async def fetch_predictions(client):
    """Fetch all predictions that have actual_peak_mc recorded."""
    r = await client.get(
        f"{SUPABASE_URL}/rest/v1/predictions",
        params={
            "select": "mint,name,symbol,market_cap_at_analysis,estimated_peak_mc,"
                      "peak_mc_low,peak_mc_high,rug_probability,actual_peak_mc,"
                      "prob_100k,prob_250k,prob_500k,prob_1m,prob_5m,prob_10m,"
                      "prediction_accurate,snapshot_timestamp",
            "actual_peak_mc": "not.is.null",
            "order": "snapshot_timestamp.desc",
            "limit": "1000",
        },
        headers=HEADERS,
    )
    r.raise_for_status()
    return r.json()


async def fetch_all_for_rug_inference(client):
    """
    Fetch all predictions. For coins without actual_peak_mc, infer outcome
    from price signals logged at analysis time — if rug_probability was high
    and the coin was flagged with collapse signals, treat as likely rug.
    Also fetch recent ones and check if they're dead via DexScreener.
    """
    r = await client.get(
        f"{SUPABASE_URL}/rest/v1/predictions",
        params={
            "select": "mint,name,symbol,market_cap_at_analysis,estimated_peak_mc,"
                      "peak_mc_low,peak_mc_high,rug_probability,actual_peak_mc,"
                      "prob_100k,prob_500k,prob_1m,prediction_accurate,"
                      "snapshot_timestamp,price_change_24h,pct_from_24h_peak",
            "order": "snapshot_timestamp.desc",
            "limit": "500",
        },
        headers=HEADERS,
    )
    r.raise_for_status()
    return r.json()


def rug_stats(records):
    """Classifier accuracy on records with actual_peak_mc."""
    resolved = [r for r in records if r.get("actual_peak_mc") and r.get("market_cap_at_analysis")]
    if len(resolved) < MIN_RECORDS:
        return None, resolved

    tp = fp = tn = fn = 0
    for r in resolved:
        mc_at      = r["market_cap_at_analysis"]
        actual     = r["actual_peak_mc"]
        rug_pred   = (r.get("rug_probability") or 0) >= RUG_THRESHOLD
        actual_rug = actual < mc_at * (1 - ACTUAL_RUG_DROP / 100)

        if rug_pred and actual_rug:   tp += 1
        elif rug_pred and not actual_rug: fp += 1
        elif not rug_pred and actual_rug: fn += 1
        else:                             tn += 1

    precision = tp / max(tp + fp, 1)
    recall    = tp / max(tp + fn, 1)
    f1        = 2 * precision * recall / max(precision + recall, 1e-6)
    accuracy  = (tp + tn) / max(len(resolved), 1)

    return {
        "n":          len(resolved),
        "tp":         tp, "fp": fp, "tn": tn, "fn": fn,
        "precision":  round(precision * 100, 1),
        "recall":     round(recall * 100, 1),
        "f1":         round(f1 * 100, 1),
        "accuracy":   round(accuracy * 100, 1),
        "rug_rate_actual": round((tp + fn) / max(len(resolved), 1) * 100, 1),
        "rug_rate_predicted": round((tp + fp) / max(len(resolved), 1) * 100, 1),
    }, resolved


def peak_mc_stats(resolved):
    """Regression accuracy on records with actual_peak_mc."""
    valid = [r for r in resolved
             if r.get("estimated_peak_mc") and r.get("actual_peak_mc")
             and r["market_cap_at_analysis"]]
    if len(valid) < MIN_RECORDS:
        return None

    errors, pct_errors, in_range = [], [], 0
    for r in valid:
        pred   = r["estimated_peak_mc"]
        actual = r["actual_peak_mc"]
        low    = r.get("peak_mc_low") or pred * 0.6
        high   = r.get("peak_mc_high") or pred * 1.4

        errors.append(abs(pred - actual))
        pct_errors.append(abs(pred - actual) / max(actual, 1) * 100)
        if low <= actual <= high:
            in_range += 1

    mae  = sum(errors) / len(errors)
    mape = sum(pct_errors) / len(pct_errors)

    # Direction accuracy: did model predict higher than current MC when actual was too?
    direction_correct = 0
    for r in valid:
        mc     = r["market_cap_at_analysis"]
        pred   = r["estimated_peak_mc"]
        actual = r["actual_peak_mc"]
        if (pred > mc) == (actual > mc):
            direction_correct += 1

    return {
        "n":               len(valid),
        "mae":             f"${mae:,.0f}",
        "mape":            f"{mape:.1f}%",
        "in_range":        f"{in_range}/{len(valid)} ({in_range/len(valid)*100:.0f}%)",
        "direction_acc":   f"{direction_correct/len(valid)*100:.0f}%",
    }


def band_calibration(resolved):
    """How well-calibrated are the probability bands?"""
    bands = [
        ("prob_100k", 100_000, "100K"),
        ("prob_500k", 500_000, "500K"),
        ("prob_1m",   1_000_000, "1M"),
    ]
    results = []
    for col, target, label in bands:
        subset = [r for r in resolved
                  if r.get(col) is not None
                  and r.get("actual_peak_mc")
                  and r.get("market_cap_at_analysis")]
        if len(subset) < MIN_RECORDS:
            continue

        buckets = {"0-25": [], "25-50": [], "50-75": [], "75-100": []}
        for r in subset:
            p      = r[col]
            hit    = r["actual_peak_mc"] >= target
            bucket = "0-25" if p < 25 else "25-50" if p < 50 else "50-75" if p < 75 else "75-100"
            buckets[bucket].append(hit)

        calib = {}
        for bkt, hits in buckets.items():
            if hits:
                calib[bkt] = f"{sum(hits)}/{len(hits)} ({sum(hits)/len(hits)*100:.0f}% actually hit)"

        results.append({"milestone": f"${label}", "calibration": calib, "n": len(subset)})
    return results


def distribution_stats(all_records):
    """Basic stats on all predictions."""
    n = len(all_records)
    if n == 0:
        return None
    rug_preds = [r.get("rug_probability") or 0 for r in all_records]
    avg_rug = sum(rug_preds) / n
    high_rug = sum(1 for p in rug_preds if p >= RUG_THRESHOLD)
    resolved = sum(1 for r in all_records if r.get("actual_peak_mc"))
    return {
        "total_predictions":  n,
        "resolved":           resolved,
        "unresolved":         n - resolved,
        "avg_rug_probability": f"{avg_rug:.1f}%",
        "predicted_rug_pct":  f"{high_rug/n*100:.1f}% ({high_rug} coins)",
    }


def print_section(title):
    print(f"\n{'='*56}")
    print(f"  {title}")
    print('='*56)


async def main():
    print("\nORBIT XGBoost Accuracy Test")
    print(f"Supabase: {SUPABASE_URL[:40]}...")
    print(f"Rug threshold: >={RUG_THRESHOLD}% = predicted rug")
    print(f"Actual rug: coin dropped >={ACTUAL_RUG_DROP}% from analysis MC")

    async with httpx.AsyncClient(timeout=30) as client:
        print("\nFetching predictions...")
        all_records = await fetch_all_for_rug_inference(client)
        resolved    = [r for r in all_records if r.get("actual_peak_mc")]

    # Distribution
    print_section("DATASET OVERVIEW")
    dist = distribution_stats(all_records)
    if dist:
        for k, v in dist.items():
            print(f"  {k:<28} {v}")
    else:
        print("  No predictions found in Supabase.")
        return

    if len(resolved) < MIN_RECORDS:
        print(f"\n  Only {len(resolved)} resolved predictions found.")
        print(f"  Need at least {MIN_RECORDS} with actual_peak_mc to score accuracy.")
        print("\n  To record an outcome, call:")
        print("  POST /outcome?mint=<CA>&actual_peak_mc=<value>")
        print("\n  Or run: python ml/record_outcomes.py (fetches current MC from DexScreener)")
        return

    # Rug classifier
    print_section("RUG CLASSIFIER")
    rug_s, resolved = rug_stats(resolved)
    if rug_s:
        print(f"  Records evaluated:   {rug_s['n']}")
        print(f"  Actual rug rate:     {rug_s['rug_rate_actual']}%")
        print(f"  Predicted rug rate:  {rug_s['rug_rate_predicted']}%")
        print(f"  Accuracy:            {rug_s['accuracy']}%")
        print(f"  Precision:           {rug_s['precision']}%  (of predicted rugs, % that actually rugged)")
        print(f"  Recall:              {rug_s['recall']}%  (of actual rugs, % the model caught)")
        print(f"  F1 Score:            {rug_s['f1']}%")
        print(f"  True positives:      {rug_s['tp']}  (caught rugs)")
        print(f"  False positives:     {rug_s['fp']}  (flagged clean coins)")
        print(f"  True negatives:      {rug_s['tn']}  (correctly cleared)")
        print(f"  False negatives:     {rug_s['fn']}  (missed rugs)")
    else:
        print("  Not enough resolved records.")

    # Peak MC regression
    print_section("PEAK MC REGRESSION")
    peak_s = peak_mc_stats(resolved)
    if peak_s:
        print(f"  Records evaluated:   {peak_s['n']}")
        print(f"  Mean Absolute Error: {peak_s['mae']}")
        print(f"  Mean Abs % Error:    {peak_s['mape']}")
        print(f"  Actual in range:     {peak_s['in_range']}")
        print(f"  Direction accuracy:  {peak_s['direction_acc']}  (predicted up/down correctly)")
    else:
        print("  Not enough resolved records.")

    # Band calibration
    print_section("PROBABILITY BAND CALIBRATION")
    calib = band_calibration(resolved)
    if calib:
        for c in calib:
            print(f"\n  Milestone {c['milestone']}  (n={c['n']})")
            for bkt, result in c["calibration"].items():
                print(f"    Stated {bkt}% → {result}")
    else:
        print("  Not enough data for calibration.")

    # Summary verdict
    print_section("VERDICT")
    if rug_s and float(rug_s["f1"]) >= 70:
        print("  Rug classifier: GOOD  (F1 >= 70%)")
    elif rug_s and float(rug_s["f1"]) >= 50:
        print("  Rug classifier: OK    (F1 >= 50% — usable but retraining recommended)")
    elif rug_s:
        print("  Rug classifier: POOR  (F1 < 50% — retrain before charging users)")
    else:
        print("  Rug classifier: UNSCORED (need more resolved outcomes)")

    if peak_s:
        mape_val = float(peak_s["mape"].replace("%",""))
        if mape_val < 50:
            print("  Peak MC model:  GOOD  (MAPE < 50%)")
        elif mape_val < 100:
            print("  Peak MC model:  OK    (MAPE < 100%)")
        else:
            print("  Peak MC model:  POOR  (MAPE >= 100% — predictions are rough estimates)")
    else:
        print("  Peak MC model:  UNSCORED")

    print()


if __name__ == "__main__":
    asyncio.run(main())
