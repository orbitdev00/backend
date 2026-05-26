import httpx, os

MORALIS_KEY = os.getenv("MORALIS_API_KEY", "")


async def fetch_ethereum_data(address: str) -> dict:
    """Fetch ETH token holder data from Moralis or Etherscan."""
    result = {"chain": "ethereum"}
    try:
        if MORALIS_KEY:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"https://deep-index.moralis.io/api/v2.2/erc20/{address}/owners",
                    params={"chain": "eth", "limit": 10},
                    headers={"X-API-Key": MORALIS_KEY},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    holders = data.get("result", [])
                    top_holders = []
                    for i, h in enumerate(holders[:10]):
                        pct = float(h.get("percentage_relative_to_total_supply", 0))
                        top_holders.append({"address": h.get("owner_address", ""), "pct": pct})
                    top5 = sum(h["pct"] for h in top_holders[:5])
                    top10 = sum(h["pct"] for h in top_holders[:10])
                    result.update({
                        "top_holders": top_holders,
                        "top5_concentration_pct": top5,
                        "top10_concentration_pct": top10,
                        "bundle_detected": False,
                        "bundle_confidence": 0,
                    })
    except Exception as e:
        print(f"[ETH] fetch_ethereum_data error: {e}")
    return result
