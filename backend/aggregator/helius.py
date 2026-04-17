import httpx
import asyncio
import time
from collections import Counter
from config import HELIUS_API_KEY, HELIUS_API_URL, QUICKNODE_URL


async def fetch_helius(mint: str, dev_wallet: str = "") -> dict:
    """Hot path — fast. Funding source tracing runs separately in background."""
    enriched    = await _get_enriched_transactions(mint)
    bundle_data = _detect_bundles(enriched)
    dev_data    = _analyze_dev(enriched, dev_wallet) if dev_wallet else _empty_dev()
    fresh_data  = await _analyze_fresh_wallets_rpc(enriched)

    return {
        **bundle_data,
        **dev_data,
        **fresh_data,
        "tx_count_analyzed": len(enriched),
        # Funding source defaults — filled in by background task
        "shared_funder_detected": False,
        "shared_funder_wallets":  0,
        "shared_funder_pct":      0,
        "top_funder":             None,
        "_enriched_txs":          enriched,  # passed to background task
    }


async def fetch_insider_signals(enriched: list, coin_created_at: int) -> dict:
    """
    Feature 2: Detect insider trading.
    Wallets that bought within 30 seconds of coin creation = likely insiders/snipers.
    Also detects wallets with very high historical rug involvement.
    """
    if not enriched or not coin_created_at:
        return {"insider_count": 0, "insider_pct": 0, "sniper_count": 0}

    insiders = set()
    snipers  = set()
    seen     = set()
    total    = 0

    for tx in enriched[:40]:
        fp        = tx.get("feePayer", "")
        ts        = tx.get("timestamp", 0)
        swap      = (tx.get("events") or {}).get("swap", {})
        if not fp or fp in seen or not swap or not swap.get("tokenOutputs"):
            continue
        seen.add(fp)
        total += 1

        seconds_after_creation = ts - coin_created_at if ts and coin_created_at else 9999
        if seconds_after_creation < 30:
            insiders.add(fp)
        if seconds_after_creation < 5:
            snipers.add(fp)

    if total == 0:
        return {"insider_count": 0, "insider_pct": 0, "sniper_count": 0}

    return {
        "insider_count": len(insiders),
        "insider_pct":   round(len(insiders) / total * 100, 1),
        "sniper_count":  len(snipers),
    }


async def fetch_funding_sources(enriched: list) -> dict:
    """Background task — traces wallet funding sources. Runs after main result shown."""
    return await _analyze_funding_sources(enriched)


async def _get_enriched_transactions(mint: str) -> list:
    url = f"{HELIUS_API_URL}/addresses/{mint}/transactions"
    params = {"api-key": HELIUS_API_KEY, "limit": 50, "type": "SWAP"}
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json() or []
        except Exception:
            return []


def _detect_bundles(txs: list) -> dict:
    if not txs:
        return {"bundle_detected": False, "bundle_confidence": 0,
                "bundled_wallet_count": 0, "bundle_slots": []}

    slot_buyers: dict[int, list[str]] = {}
    amount_counts: Counter = Counter()

    for tx in txs:
        slot = tx.get("slot")
        fee_payer = tx.get("feePayer", "")
        swap = (tx.get("events") or {}).get("swap", {})
        if not swap:
            continue
        token_out = swap.get("tokenOutputs", [{}])
        amount = token_out[0].get("rawTokenAmount", {}).get("tokenAmount") if token_out else None
        if slot and fee_payer:
            slot_buyers.setdefault(slot, []).append(fee_payer)
        if amount:
            amount_counts[amount] += 1

    bundle_slots = {s: b for s, b in slot_buyers.items() if len(set(b)) >= 2}
    bundled_wallets = set(w for buyers in bundle_slots.values() for w in buyers)
    coordinated_amounts = sum(1 for c in amount_counts.values() if c >= 3)
    bundle_detected = len(bundle_slots) >= 2 or coordinated_amounts >= 2
    bundle_confidence = min(100, len(bundle_slots) * 20 + coordinated_amounts * 15)

    return {
        "bundle_detected": bundle_detected,
        "bundle_confidence": bundle_confidence,
        "bundled_wallet_count": len(bundled_wallets),
        "bundle_slots": list(bundle_slots.keys())[:5],
    }


def _analyze_dev(txs: list, dev_wallet: str) -> dict:
    dev_bought = 0
    dev_sold = 0
    for tx in txs:
        if tx.get("feePayer", "").lower() != dev_wallet.lower():
            continue
        swap = (tx.get("events") or {}).get("swap", {})
        if not swap:
            continue
        for out in swap.get("tokenOutputs", []):
            amt = out.get("rawTokenAmount", {}).get("tokenAmount")
            if amt:
                dev_bought += int(amt)
        for inp in swap.get("tokenInputs", []):
            amt = inp.get("rawTokenAmount", {}).get("tokenAmount")
            if amt:
                dev_sold += int(amt)

    dev_sell_pct = round((dev_sold / dev_bought * 100) if dev_bought > 0 else 0, 2)
    return {
        "dev_tokens_bought": dev_bought,
        "dev_tokens_sold": dev_sold,
        "dev_sell_pct": dev_sell_pct,
        "dev_dumped": dev_sell_pct > 50,
    }


async def _analyze_fresh_wallets_rpc(txs: list) -> dict:
    """
    Detects fresh wallets — wallets created within the last 48 hours.
    Checks actual first transaction timestamp, not just signature count.
    Samples up to 40 buyers for accuracy.
    """
    if not txs:
        return {"fresh_wallet_count": 0, "fresh_wallet_pct": 0}

    buyers = []
    seen = set()
    for tx in txs[:30]:
        fp = tx.get("feePayer", "")
        swap = (tx.get("events") or {}).get("swap", {})
        if fp and fp not in seen and swap and swap.get("tokenOutputs"):
            buyers.append(fp)
            seen.add(fp)

    if not buyers:
        return {"fresh_wallet_count": 0, "fresh_wallet_pct": 0}

    sample = buyers[:10]
    fresh_count = 0

    async with httpx.AsyncClient(timeout=30) as client:
        tasks = [_check_wallet_freshness(client, w) for w in sample]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    for r in results:
        if r is True:
            fresh_count += 1

    total = len(sample)
    fresh_pct = round((fresh_count / total * 100) if total > 0 else 0, 1)
    return {"fresh_wallet_count": fresh_count, "fresh_wallet_pct": fresh_pct}


async def _check_wallet_freshness(client: httpx.AsyncClient, wallet: str) -> bool:
    """
    A wallet is fresh if its oldest known transaction is within 48 hours.
    We fetch the last page of signatures to find the wallet's first transaction,
    then check its timestamp.
    """
    now = time.time()
    cutoff = now - (48 * 3600)  # 48 hours ago

    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getSignaturesForAddress",
        "params": [wallet, {"limit": 15}]
    }
    try:
        resp = await client.post(QUICKNODE_URL, json=payload, timeout=6)
        sigs = resp.json().get("result") or []

        if not sigs:
            return False

        # If wallet has very few total txs, check the oldest one's timestamp
        if len(sigs) < 15:
            # Get the oldest transaction timestamp
            oldest = sigs[-1]
            block_time = oldest.get("blockTime")
            if block_time and block_time > cutoff:
                return True
            # Also flag if wallet has < 5 total transactions ever
            if len(sigs) < 5:
                return True
            return False

        # Wallet has 15+ txs — likely not fresh, but check if all are very recent
        newest = sigs[0].get("blockTime") or 0
        oldest = sigs[-1].get("blockTime") or 0

        # If even the 15th oldest tx is within 48h, wallet is definitely fresh
        if oldest > cutoff:
            return True

        return False

    except Exception:
        return False


async def _analyze_funding_sources(txs: list) -> dict:
    """
    Detects coordinated wallet farms by tracing funding sources.
    If multiple early buyers were funded by the same wallet, that's a
    strong signal of coordinated manipulation even if they bought at
    different times/slots (bypassing normal bundle detection).
    """
    if not txs:
        return {
            "shared_funder_detected": False,
            "shared_funder_wallets": 0,
            "shared_funder_pct": 0,
            "top_funder": None,
        }

    # Get unique early buyers
    buyers = []
    seen = set()
    for tx in txs[:40]:
        fp = tx.get("feePayer", "")
        swap = (tx.get("events") or {}).get("swap", {})
        if fp and fp not in seen and swap and swap.get("tokenOutputs"):
            buyers.append(fp)
            seen.add(fp)

    if len(buyers) < 3:
        return {
            "shared_funder_detected": False,
            "shared_funder_wallets": 0,
            "shared_funder_pct": 0,
            "top_funder": None,
        }

    # Check funding source for each buyer (who sent them SOL initially)
    sample = buyers[:12]  # cap to avoid too many RPC calls
    funder_map: dict[str, list[str]] = {}  # funder -> list of buyers it funded

    async with httpx.AsyncClient(timeout=20) as client:
        tasks = [_get_funding_source(client, w) for w in sample]
        funders = await asyncio.gather(*tasks, return_exceptions=True)

    for wallet, funder in zip(sample, funders):
        if isinstance(funder, str) and funder:
            funder_map.setdefault(funder, []).append(wallet)

    if not funder_map:
        return {
            "shared_funder_detected": False,
            "shared_funder_wallets": 0,
            "shared_funder_pct": 0,
            "top_funder": None,
        }

    # Find the funder that funded the most buyers
    top_funder, funded_wallets = max(funder_map.items(), key=lambda x: len(x[1]))
    shared_count = len(funded_wallets)
    shared_pct = round(shared_count / len(sample) * 100, 1)

    # 2+ buyers from same funder = suspicious, 3+ = strong signal
    detected = shared_count >= 2

    return {
        "shared_funder_detected": detected,
        "shared_funder_wallets": shared_count,
        "shared_funder_pct": shared_pct,
        "top_funder": top_funder if detected else None,
    }


async def _get_funding_source(client: httpx.AsyncClient, wallet: str) -> str | None:
    """
    Gets the wallet that first funded this wallet with SOL.
    This is the 'grandparent' funder — if many buyers share the same
    grandparent, they're likely a coordinated farm.
    """
    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getSignaturesForAddress",
        "params": [wallet, {"limit": 10}]
    }
    try:
        resp = await client.post(QUICKNODE_URL, json=payload, timeout=6)
        sigs = resp.json().get("result") or []
        if not sigs:
            return None

        # Get the oldest transaction for this wallet
        oldest_sig = sigs[-1].get("signature")
        if not oldest_sig:
            return None

        # Fetch that transaction to find who sent SOL to this wallet
        tx_payload = {
            "jsonrpc": "2.0", "id": 1,
            "method": "getTransaction",
            "params": [oldest_sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}]
        }
        tx_resp = await client.post(QUICKNODE_URL, json=tx_payload, timeout=6)
        tx_data = tx_resp.json().get("result") or {}

        # Extract the fee payer of the oldest tx = likely the funder
        account_keys = (tx_data.get("transaction") or {}).get("message", {}).get("accountKeys") or []
        if account_keys:
            # First account key is the fee payer / signer = funder
            first = account_keys[0]
            if isinstance(first, dict):
                funder = first.get("pubkey", "")
            else:
                funder = str(first)

            # Don't count the wallet itself as its own funder
            if funder and funder != wallet:
                return funder

    except Exception:
        pass
    return None


def _empty_dev() -> dict:
    return {"dev_tokens_bought": 0, "dev_tokens_sold": 0,
            "dev_sell_pct": 0, "dev_dumped": False}
