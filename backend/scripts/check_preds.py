import httpx, os

env = {}
for line in open('.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

URL = env.get('SUPABASE_URL', '')
KEY = env.get('SUPABASE_ANON_KEY', '')
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

r = httpx.get(f"{URL}/rest/v1/predictions",
    params={"select": "id,snapshot_timestamp,actual_peak_mc,mint", "limit": "5", "order": "id.desc"},
    headers=HEADERS)

print("Status:", r.status_code)
print("Raw:", r.text[:2000])
