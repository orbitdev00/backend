"""
Test the trained XGBoost model against a live coin.
Run from backend/ directory:
  python ml/test_model.py <MINT_ADDRESS>
"""
import asyncio, sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

async def test(mint: str):
    from engine.snapshot import build_snapshot
    from ml.predictor import predict_xgboost

    print(f"Building snapshot for {mint[:8]}...")
    t0 = time.time()
    snapshot = await build_snapshot(mint)
    snap_time = round(time.time() - t0, 2)
    print(f"Snapshot built in {snap_time}s")
    print()

    print("Running XGBoost prediction...")
    t1 = time.time()
    prediction = await predict_xgboost(snapshot)
    pred_time  = round((time.time() - t1) * 1000, 1)

    print(f"Model: {prediction.get('model', '?')}")
    print(f"Inference time: {pred_time}ms")
    print()
    print(f"Current MC:     ${snapshot.get('market_cap_usd',0):,.0f}")
    print(f"Estimated peak: ${prediction['estimated_peak_mc']:,.0f}")
    print(f"Peak range:     ${prediction['peak_mc_range']['low']:,.0f} — ${prediction['peak_mc_range']['high']:,.0f}")
    print(f"Rug probability:{prediction['rug_probability']}%")
    print(f"Risk score:     {prediction['risk_score']}/100")
    print(f"Momentum:       {prediction['momentum']}")
    print(f"Stage:          {prediction['stage']}")
    print()
    print("Probability bands:")
    for k, v in prediction['probability_bands'].items():
        bar = '█' * (v // 5) + '░' * (20 - v // 5)
        print(f"  ${k:>4}: [{bar}] {v}%")
    print()
    if prediction['flags']:
        print("Flags:")
        for f in prediction['flags']:
            print(f"  ⚠ {f}")
    if prediction['bullish_flags']:
        print("Bullish:")
        for f in prediction['bullish_flags']:
            print(f"  ✓ {f}")
    print()
    print(f"Reasoning: {prediction['reasoning']}")

if __name__ == "__main__":
    mint = sys.argv[1] if len(sys.argv) > 1 else input("Enter mint address: ").strip()
    asyncio.run(test(mint))
