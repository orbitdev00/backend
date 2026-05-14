import httpx
from config import HELIUS_API_KEY, HELIUS_RPC_URL
from aggregator.cache import get as cache_get, set as cache_set, get_or_wait, mark_inflight, unmark_inflight

SOLSCAN_TTL = 60  # 60 second cache

PUBLIC_RPCS = [
    "https://quaint-distinguished-river.solana-mainnet.quiknode.pro/ade127a9ec8c5b4e18b10e86063121332ad61284/",
    "https://api.mainnet-beta.solana.com",
    "https://rpc.ankr.com/solana",
]

# DEX/AMM program IDs — if a token account's OWNER (the wallet) 
# matches any of these, it's an LP vault not a real holder
DEX_OWNERS = {
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",  # Raydium AMM v4
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",  # Raydium AMM authority
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",  # Raydium CPMM
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",  # Raydium CLMM
    "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5",  # Orca authority
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",  # Serum DEX
    "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",  # Meteora DLMM
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",   # Whirlpool
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",  # Jupiter v6
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",   # Pump.fun bonding curve program
    "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM",   # Pump.fun migration authority
    "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",  # Pump.fun fee account
}

# Name fragments that identify LP/burn/system accounts (case-insensitive)
LP_NAME_FRAGMENTS = [
    "liq pool", "liquidity", "lp vault", "lp pool",
    "burn", "dead", "null", "migration",
    "raydium", "orca", "meteora", "pump.fun",
]


async def fetch_solscan(
    mint: str,
    dev_wallet: str = "",
    total_supply: int = 1_000_000_000,
    pair_address: str = "",
) -> dict:
    cache_key = f"solscan:{mint}"

    # Check cache first
    cached = cache_get(cache_key, SOLSCAN_TTL)
    if cached is not None:
        return cached

    # Wait if another coroutine is already fetching this
    waited = await get_or_wait(cache_key, SOLSCAN_TTL)
    if waited is not None:
        return waited

    # Mark as in-flight so concurrent callers wait
    mark_inflight(cache_key)
    try:
        result = await _fetch_solscan_impl(mint, dev_wallet, total_supply, pair_address)
        cache_set(cache_key, result)
        return result
    finally:
        unmark_inflight(cache_key)


async def _fetch_solscan_impl(
    mint: str,
    dev_wallet: str = "",
    total_supply: int = 1_000_000_000,
    pair_address: str = "",
) -> dict:
    decimals    = await _get_token_decimals(mint)
    raw_holders = await _get_top_holders_resolved(mint, total_supply, decimals, pair_address)

    holder_count = await _get_holder_count_das(mint)

    # Dev holding — check resolved holders first
    dev_pct = _get_dev_holding(raw_holders, dev_wallet)

    conc = _compute_concentration(raw_holders)
    rug  = _assess_rug_risk(raw_holders, dev_pct, conc)

    return {
        "total_holders":           holder_count,
        "top_holders":             raw_holders,
        "top10_concentration_pct": conc["top10"],
        "top5_concentration_pct":  conc["top5"],
        "top1_concentration_pct":  conc["top1"],
        "dev_holding_pct":         dev_pct,
        "rug_risk_score":          rug,
    }


async def _get_top_holders_resolved(
    mint: str,
    total_supply_raw: int,
    decimals: int,
    pair_address: str,
) -> list:
    """
    Fetch top token accounts, then resolve each one to its actual wallet owner.
    Filter out any account whose owner is a DEX program or the pair address.
    This is the definitive LP filter.
    """
    # Step 1: get top 25 token accounts by balance
    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getTokenLargestAccounts",
        "params": [mint, {"commitment": "confirmed"}]
    }
    # Try Helius first, fall back to public RPC if rate limited
    PUBLIC_RPCS = [
    "https://api.mainnet-beta.solana.com",
    "https://rpc.ankr.com/solana",
]
    rpc_urls = [HELIUS_RPC_URL] + PUBLIC_RPCS
    accounts = []
    async with httpx.AsyncClient(timeout=12) as client:
        for rpc_url in rpc_urls:
            try:
                resp  = await client.post(rpc_url, json=payload)
                rjson = resp.json()
                if rjson.get("error"):
                    code = rjson["error"].get("code")
                    if code == -32429:
                        print(f"[Solscan] Helius rate limited, trying public RPC...")
                        continue
                    print(f"[Solscan] RPC error: {rjson['error']}")
                    break
                accounts = (rjson.get("result") or {}).get("value") or []
                if accounts:
                    break
            except Exception as e:
                print(f"[Solscan] Exception on {rpc_url[:30]}: {e}")
                continue

    real_supply = await _get_token_supply(mint)
    if real_supply <= 0:
        real_supply = total_supply_raw

    print(f"[Solscan] {mint[:8]}... found {len(accounts)} accounts, supply={real_supply}, lp_exclude={pair_address[:8] if pair_address else 'none'}")
    if not accounts:
        return []

    # Step 2: batch resolve all token accounts to their wallet owners
    token_account_addresses = [acc.get("address") for acc in accounts[:25] if acc.get("address")]

    owners = await _batch_get_owners(token_account_addresses)

    print(f"[Solscan] {mint[:8]}... resolved {len(owners)} owners")
    # Step 3: build holder list, skipping LP accounts
    lp_exclude = {pair_address} if pair_address else set()

    # Skip the extra RPC call for account names — use DEX_OWNERS + pair_address instead
    account_names = {}

    # First pass: identify what's LP vs real holder, sum up LP amounts
    lp_amount = 0
    holder_candidates = []

    for acc in accounts[:25]:
        token_addr   = acc.get("address", "")
        raw_amount   = int(acc.get("amount") or 0)
        wallet_owner = owners.get(token_addr, token_addr)

        is_lp = False
        if wallet_owner in DEX_OWNERS:                                          is_lp = True
        if wallet_owner in lp_exclude or token_addr in lp_exclude:              is_lp = True
        if wallet_owner in ("1nc1nerator11111111111111111111111111111111",
                            "11111111111111111111111111111111"):                  is_lp = True
        acct_name = (account_names.get(token_addr) or account_names.get(wallet_owner) or "").lower()
        if any(frag in acct_name for frag in LP_NAME_FRAGMENTS):               is_lp = True

        if is_lp:
            lp_amount += raw_amount
        else:
            holder_candidates.append((token_addr, wallet_owner, raw_amount, acct_name))

    print(f"[Solscan] {mint[:8]}... candidates={len(holder_candidates)}, lp_amount={lp_amount}")
    # Use circulating supply = total supply minus LP-held tokens
    # This gives accurate % of tokens actually in circulation
    circulating = max(real_supply - lp_amount, 1)

    holders = []
    for token_addr, wallet_owner, raw_amount, acct_name in holder_candidates:
        pct           = round((raw_amount / circulating * 100), 2)
        pct           = min(pct, 100.0)
        actual_amount = raw_amount / (10 ** decimals)
        holders.append({
            "address":       wallet_owner,
            "token_account": token_addr,
            "amount":        actual_amount,
            "pct":           pct,
            "name":          account_names.get(wallet_owner) or "",
        })

        if len(holders) >= 20:
            break

    # Ensure strict descending sort by pct (getTokenLargestAccounts is by raw,
    # but decimals/pct_of_circulating can reorder in edge cases)
    holders.sort(key=lambda h: h["pct"], reverse=True)
    return holders


async def _get_account_names(addresses: list) -> dict:
    """Fetch account names from Helius DAS — identifies LP pools, burn wallets, etc."""
    if not addresses:
        return {}
    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getMultipleAccounts",
        "params": [addresses, {"encoding": "jsonParsed", "commitment": "confirmed"}]
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp  = await client.post(HELIUS_RPC_URL, json=payload)
            value = (resp.json().get("result") or {}).get("value") or []
        names = {}
        for addr, acct in zip(addresses, value):
            if not acct:
                continue
            # Check parsed data for token account name
            parsed = (acct.get("data") or {})
            if isinstance(parsed, dict):
                info = parsed.get("parsed", {}).get("info", {})
                name = info.get("name") or info.get("accountName") or ""
                if name:
                    names[addr] = name
        return names
    except Exception:
        return {}


async def _batch_get_owners(token_accounts: list) -> dict:
    """
    Batch fetch the wallet owner for each token account.
    Token accounts have an "owner" field in their parsed data = the actual wallet.
    Uses getMultipleAccounts for efficiency.
    """
    if not token_accounts:
        return {}

    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getMultipleAccounts",
        "params": [
            token_accounts,
            {"encoding": "jsonParsed", "commitment": "confirmed"}
        ]
    }

    owners = {}
    results = []
    async with httpx.AsyncClient(timeout=12) as client:
        for url in [HELIUS_RPC_URL] + PUBLIC_RPCS:
            try:
                resp  = await client.post(url, json=payload)
                rjson = resp.json()
                if rjson.get("error") and rjson["error"].get("code") == -32429:
                    continue
                results = (rjson.get("result") or {}).get("value") or []
                if results: break
            except Exception:
                continue

    for token_addr, account in zip(token_accounts, results):
        if not account:
            owners[token_addr] = token_addr
            continue
        parsed = (account.get("data") or {})
        if isinstance(parsed, dict):
            info  = parsed.get("parsed", {}).get("info", {})
            owner = info.get("owner", "")
            owners[token_addr] = owner if owner else token_addr
        else:
            owners[token_addr] = token_addr

    return owners


async def _get_token_decimals(mint: str) -> int:
    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getAccountInfo",
        "params": [mint, {"encoding": "jsonParsed"}]
    }
    async with httpx.AsyncClient(timeout=8) as client:
        try:
            resp = await client.post(HELIUS_RPC_URL, json=payload)
            info = (resp.json()
                    .get("result", {})
                    .get("value", {})
                    .get("data", {})
                    .get("parsed", {})
                    .get("info", {}))
            return int(info.get("decimals", 6))
        except Exception:
            return 6


async def _get_token_supply(mint: str) -> int:
    payload = {"jsonrpc": "2.0", "id": 1, "method": "getTokenSupply", "params": [mint]}
    async with httpx.AsyncClient(timeout=8) as client:
        for url in [HELIUS_RPC_URL] + PUBLIC_RPCS:
            try:
                resp   = await client.post(url, json=payload)
                rjson  = resp.json()
                if rjson.get("error"): continue
                amount = (rjson.get("result", {}).get("value", {}).get("amount"))
                if amount: return int(amount)
            except Exception:
                continue
    return 0


async def _get_holder_count_das(mint: str) -> int:
    url = f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"
    payload = {
        "jsonrpc": "2.0", "id": "holder-count",
        "method": "getTokenAccounts",
        "params": {
            "mint": mint, "limit": 1000,
            "cursor": None,
            "options": {"showZeroBalance": False}
        }
    }
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp     = await client.post(url, json=payload)
            resp.raise_for_status()
            result   = resp.json().get("result") or {}
            accounts = result.get("token_accounts") or []
            total    = len(accounts)
            if total == 1000:
                cursor = result.get("cursor")
                if cursor:
                    payload["params"]["cursor"] = cursor
                    resp2   = await client.post(url, json=payload)
                    result2 = resp2.json().get("result") or {}
                    total  += len(result2.get("token_accounts") or [])
            return total
        except Exception:
            return 0


def _get_dev_holding(holders: list, dev_wallet: str) -> float:
    if not dev_wallet:
        return 0.0
    for h in holders:
        if h["address"].lower() == dev_wallet.lower():
            return h["pct"]
    return 0.0


def _compute_concentration(holders: list) -> dict:
    if not holders:
        return {"top1": 0, "top5": 0, "top10": 0}
    return {
        "top1":  round(min(sum(h["pct"] for h in holders[:1]),  100), 2),
        "top5":  round(min(sum(h["pct"] for h in holders[:5]),  100), 2),
        "top10": round(min(sum(h["pct"] for h in holders[:10]), 100), 2),
    }


def _assess_rug_risk(holders: list, dev_pct: float, conc: dict) -> int:
    score = 0
    if dev_pct > 20:   score += 40
    elif dev_pct > 10: score += 25
    elif dev_pct > 5:  score += 10

    top10 = conc.get("top10", 0)
    if top10 > 80:   score += 35
    elif top10 > 60: score += 20
    elif top10 > 40: score += 10

    top1 = conc.get("top1", 0)
    if top1 > 30:   score += 25
    elif top1 > 15: score += 10

    return min(100, score)
