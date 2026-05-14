import asyncio, httpx, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL  = os.getenv("SUPABASE_URL")
SUPABASE_KEY  = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

async def check():
    async with httpx.AsyncClient(timeout=15) as client:
        # Total count
        r1 = await client.get(f"{SUPABASE_URL}/rest/v1/predictions",
            params={"select": "*", "limit": "1"},
            headers={**HEADERS, "Prefer": "count=exact"})
        total = int(r1.headers.get("content-range", "0/0").split("/")[-1] or 0)

        # Get one row to see all column names
        r2 = await client.get(f"{SUPABASE_URL}/rest/v1/predictions",
            params={"select": "*", "limit": "1"},
            headers=HEADERS)
        rows = r2.json()
        if not rows:
            print("No rows found in predictions table.")
            return

        cols = list(rows[0].keys())
        print(f"Total predictions logged:  {total}")
        print(f"All columns: {cols}")
        print()

        # Find the outcome column
        outcome_col = None
        for candidate in ["actual_peak_mc", "peak_mc_actual", "outcome_mc",
                           "resolved", "is_resolved", "peaked", "actual_peak",
                           "highest_mc_seen", "resolved_at"]:
            if candidate in cols:
                outcome_col = candidate
                break

        if not outcome_col:
            print("⚠ No outcome column found. Nightly job hasn't resolved any coins yet.")
            print("  Columns available:", cols)
            return

        print(f"Outcome column found: '{outcome_col}'")

        # Count resolved
        r3 = await client.get(f"{SUPABASE_URL}/rest/v1/predictions",
            params={"select": "*", f"{outcome_col}": "not.is.null", "limit": "1"},
            headers={**HEADERS, "Prefer": "count=exact"})
        resolved = int(r3.headers.get("content-range", "0/0").split("/")[-1] or 0)
        print(f"Resolved (with outcomes):  {resolved}")
        print()

        # Show a sample unresolved row to understand the data
        r4 = await client.get(f"{SUPABASE_URL}/rest/v1/predictions",
            params={"select": "mint,name,created_at,market_cap_at_analysis",
                    f"{outcome_col}": "is.null", "limit": "3"},
            headers=HEADERS)
        samples = r4.json()
        if samples:
            print("Sample unresolved predictions:")
            for s in samples:
                print(f"  {s.get('name','?'):20} MC: ${s.get('market_cap_at_analysis',0):,.0f}  created: {s.get('created_at','?')[:19]}")
        print()

        if resolved < 50:
            print("[ ] Not enough resolved data yet.")
            print("    Run: python nightly_job.py")
        elif resolved < 200:
            print("[~] Enough to prototype. Run: python ml/train.py")
        else:
            print("[✓] Ready to train. Run: python ml/train.py")

asyncio.run(check())
