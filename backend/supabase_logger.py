import httpx
import time
from config import SUPABASE_URL, SUPABASE_ANON_KEY

HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


async def log_prediction(snapshot: dict, prediction: dict, user_id: str = None) -> bool:
    """
    Logs a full prediction + snapshot to Supabase.
    Called automatically after every analysis.
    Returns True on success, False on failure (silently — never crashes the app).
    """
    try:
        row = {
            # Identity
            "user_id":                 user_id,
            "mint":                    snapshot.get("mint"),
            "name":                    snapshot.get("name"),
            "symbol":                  snapshot.get("symbol"),

            # Snapshot state at time of analysis
            "snapshot_timestamp":      snapshot.get("timestamp"),
            "market_cap_at_analysis":  snapshot.get("market_cap_usd"),
            "age_seconds":             snapshot.get("age_seconds"),
            "social_count":            snapshot.get("social_count"),
            "total_holders":           snapshot.get("total_holders"),
            "dev_holding_pct":         snapshot.get("dev_holding_pct"),
            "bundle_detected":         snapshot.get("bundle_detected"),
            "bundle_confidence":       snapshot.get("bundle_confidence"),
            "rug_risk_score":          snapshot.get("rug_risk_score"),
            "is_migrated":             snapshot.get("is_migrated"),
            "volume_1h":               snapshot.get("volume_1h"),
            "buy_sell_ratio":          snapshot.get("buy_sell_ratio_5m"),
            "price_change_1h":         snapshot.get("price_change_1h"),
            "price_change_24h":        snapshot.get("price_change_24h"),
            "pct_from_24h_peak":       snapshot.get("pct_from_24h_peak"),
            "top10_concentration_pct": snapshot.get("top10_concentration_pct"),
            "dev_sell_pct":            snapshot.get("dev_sell_pct"),
            "liquidity_usd":           snapshot.get("liquidity_usd"),

            # Prediction output
            "estimated_peak_mc":    prediction.get("estimated_peak_mc"),
            "peak_mc_low":          (prediction.get("peak_mc_range") or {}).get("low"),
            "peak_mc_high":         (prediction.get("peak_mc_range") or {}).get("high"),
            "prob_100k":            (prediction.get("probability_bands") or {}).get("100k"),
            "prob_250k":            (prediction.get("probability_bands") or {}).get("250k"),
            "prob_500k":            (prediction.get("probability_bands") or {}).get("500k"),
            "prob_1m":              (prediction.get("probability_bands") or {}).get("1m"),
            "prob_5m":              (prediction.get("probability_bands") or {}).get("5m"),
            "prob_10m":             (prediction.get("probability_bands") or {}).get("10m"),
            "dip_likely":           prediction.get("dip_likely"),
            "dip_depth_pct":        prediction.get("dip_estimated_depth_pct"),
            "risk_score":           prediction.get("risk_score"),
            "rug_probability":      prediction.get("rug_probability"),
            "bundle_impact":        prediction.get("bundle_impact"),
            "recommended_entry_mc": prediction.get("recommended_entry_mc"),
            "recommended_exit_mc":  prediction.get("recommended_exit_mc"),
            "pnl_conservative":     (prediction.get("pnl_scenarios") or {}).get("conservative"),
            "pnl_moderate":         (prediction.get("pnl_scenarios") or {}).get("moderate"),
            "pnl_aggressive":       (prediction.get("pnl_scenarios") or {}).get("aggressive"),
            "flags":                prediction.get("flags", []),
            "bullish_flags":        prediction.get("bullish_flags", []),
            "momentum":             prediction.get("momentum"),
            "stage":                prediction.get("stage"),
            "reasoning":            prediction.get("reasoning"),

            # Outcome fields — filled in later
            "actual_peak_mc":         None,
            "outcome_recorded_at":    None,
            "prediction_accurate":    None,
            "notes":                  None,
        }

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{SUPABASE_URL}/rest/v1/predictions",
                json=row,
                headers=HEADERS,
            )
            if resp.status_code in (200, 201):
                print(f"[Supabase] Logged prediction for {snapshot.get('symbol')} ({snapshot.get('mint', '')[:8]}...)")
                return True
            else:
                print(f"[Supabase] Log failed: {resp.status_code} {resp.text[:200]}")
                return False

    except Exception as e:
        print(f"[Supabase] Log error: {e}")
        return False


async def record_outcome(mint: str, actual_peak_mc: float, notes: str = "") -> bool:
    """
    Records the actual outcome for a previously logged prediction.
    Finds the most recent prediction for this mint and updates it.
    """
    try:
        # Find the most recent prediction for this mint
        async with httpx.AsyncClient(timeout=10) as client:
            # Get the most recent row for this mint
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/predictions",
                params={
                    "mint": f"eq.{mint}",
                    "order": "snapshot_timestamp.desc",
                    "limit": "1",
                    "select": "id,estimated_peak_mc",
                },
                headers={**HEADERS, "Prefer": "return=representation"},
            )

            if resp.status_code != 200 or not resp.json():
                print(f"[Supabase] No prediction found for {mint}")
                return False

            row = resp.json()[0]
            row_id = row["id"]
            estimated = row.get("estimated_peak_mc") or 0

            # Calculate accuracy
            accurate = None
            if estimated > 0 and actual_peak_mc > 0:
                error_pct = abs(estimated - actual_peak_mc) / actual_peak_mc * 100
                accurate = error_pct <= 50  # within 50% = accurate

            # Update the row
            update_resp = await client.patch(
                f"{SUPABASE_URL}/rest/v1/predictions",
                params={"id": f"eq.{row_id}"},
                json={
                    "actual_peak_mc":      actual_peak_mc,
                    "outcome_recorded_at": "now()",
                    "prediction_accurate": accurate,
                    "notes":               notes,
                },
                headers=HEADERS,
            )

            if update_resp.status_code in (200, 204):
                print(f"[Supabase] Outcome recorded for {mint[:8]}... actual: ${actual_peak_mc:,.0f}")
                return True
            else:
                print(f"[Supabase] Outcome update failed: {update_resp.status_code}")
                return False

    except Exception as e:
        print(f"[Supabase] Outcome error: {e}")
        return False


async def get_accuracy_stats() -> dict:
    """Returns overall accuracy statistics from logged predictions."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/predictions",
                params={
                    "select": "prediction_accurate,estimated_peak_mc,actual_peak_mc,stage,momentum",
                    "outcome_recorded_at": "not.is.null",
                },
                headers=HEADERS,
            )

            if resp.status_code != 200:
                return {}

            rows = resp.json()
            if not rows:
                return {"total_with_outcomes": 0}

            total     = len(rows)
            accurate  = sum(1 for r in rows if r.get("prediction_accurate") is True)
            inaccurate = sum(1 for r in rows if r.get("prediction_accurate") is False)

            # Average error %
            errors = []
            for r in rows:
                est = r.get("estimated_peak_mc") or 0
                act = r.get("actual_peak_mc") or 0
                if est > 0 and act > 0:
                    errors.append(abs(est - act) / act * 100)

            avg_error = round(sum(errors) / len(errors), 1) if errors else None

            return {
                "total_with_outcomes": total,
                "accurate":            accurate,
                "inaccurate":          inaccurate,
                "accuracy_pct":        round(accurate / total * 100, 1) if total > 0 else 0,
                "avg_error_pct":       avg_error,
            }

    except Exception as e:
        print(f"[Supabase] Stats error: {e}")
        return {}
