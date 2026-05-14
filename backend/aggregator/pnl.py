"""
Monthly PnL: net SOL from DEX swaps this month.
Simple: sum all SOL spent on buys, sum all SOL received from sells.
net = received - spent. No cost basis, no percentages, deterministic.
"""
import httpx, asyncio
from datetime import datetime, timezone
from config import HELIUS_RPC_URL

RPC_URLS = [HELIUS_RPC_URL]
WSOL = "So11111111111111111111111111111111111111112"

DEX_PROGRAMS = {
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
}


async def fetch_monthly_pnl(wallet: str) -> dict:
    if not wallet:
        return _empty("No wallet")

    now = datetime.now(timezone.utc)
    month_start_ts = int(datetime(now.year, now.month, 1, tzinfo=timezone.utc).timestamp())

    try:
        sigs = await _get_signatures(wallet, month_start_ts)
        print(f"[PnL] {wallet[:8]}... {len(sigs)} sigs this month")
        if not sigs:
            return _empty("No transactions this month")
        txs = await _get_transactions(sigs)
        print(f"[PnL] {wallet[:8]}... {len(txs)} txs fetched")
    except Exception as e:
        print(f"[PnL] Error: {e}")
        return _empty(str(e))

    sol_spent    = 0.0   # SOL out of wallet into DEX (buys)
    sol_received = 0.0   # SOL into wallet from DEX (sells)
    mints_traded = set()
    trade_count  = 0

    for tx in txs:
        if not tx or (tx.get("meta") or {}).get("err"):
            continue

        meta     = tx.get("meta") or {}
        msg      = (tx.get("transaction") or {}).get("message") or {}
        accounts = msg.get("accountKeys") or []
        pre_bal  = meta.get("preBalances") or []
        post_bal = meta.get("postBalances") or []
        pre_tok  = meta.get("preTokenBalances") or []
        post_tok = meta.get("postTokenBalances") or []

        # Only swaps
        addrs = {(a if isinstance(a, str) else a.get("pubkey","")) for a in accounts}
        if not addrs & DEX_PROGRAMS:
            continue

        # Wallet index
        wallet_idx = next(
            (i for i, a in enumerate(accounts)
             if (a if isinstance(a, str) else a.get("pubkey","")) == wallet),
            None
        )
        if wallet_idx is None:
            continue

        # Net SOL for wallet, fee added back (fee isn't swap cost)
        fee      = meta.get("fee") or 0
        pre      = pre_bal[wallet_idx]  if wallet_idx < len(pre_bal)  else 0
        post     = post_bal[wallet_idx] if wallet_idx < len(post_bal) else 0
        net_lamps = (post - pre) + (fee if wallet_idx == 0 else 0)
        net_sol   = net_lamps / 1e9

        # Find token changes for wallet
        def owner_of(tb):
            if tb.get("owner") == wallet:
                return True
            idx = tb.get("accountIndex", -1)
            if 0 <= idx < len(accounts):
                a = accounts[idx]
                return (a if isinstance(a, str) else a.get("pubkey","")) == wallet
            return False

        pre_amounts  = {tb["mint"]: float((tb.get("uiTokenAmount") or {}).get("uiAmount") or 0)
                        for tb in pre_tok  if owner_of(tb) and tb.get("mint") != WSOL}
        post_amounts = {tb["mint"]: float((tb.get("uiTokenAmount") or {}).get("uiAmount") or 0)
                        for tb in post_tok if owner_of(tb) and tb.get("mint") != WSOL}

        all_mints = set(pre_amounts) | set(post_amounts)
        changed = {m for m in all_mints
                   if abs(post_amounts.get(m, 0) - pre_amounts.get(m, 0)) > 0.0001}

        if not changed or abs(net_sol) < 0.000001:
            continue

        sig = tx.get("transaction",{}).get("signatures",["?"])[0][:16]
        if net_sol < 0:
            sol_spent += abs(net_sol)
            print(f"[PnL DEBUG] BUY  sig={sig} sol={abs(net_sol):.6f} mints={changed}")
        else:
            sol_received += net_sol
            print(f"[PnL DEBUG] SELL sig={sig} sol={net_sol:.6f} mints={changed}")

        mints_traded |= changed
        trade_count += 1

    net_sol_total = round(sol_received - sol_spent, 4)
    tokens_traded = len(mints_traded)

    print(f"[PnL] {wallet[:8]}... spent={sol_spent:.4f} received={sol_received:.4f} net={net_sol_total} tokens={tokens_traded}")

    return {
        "total_pnl_pct": net_sol_total,   # stored as net SOL, leaderboard sorts by this
        "total_pnl_usd": net_sol_total,
        "trade_count":   trade_count,
        "win_count":     0,
        "tokens_traded": tokens_traded,
    }


async def _rpc(client: httpx.AsyncClient, payload: dict) -> dict:
    for url in RPC_URLS:
        try:
            r    = await client.post(url, json=payload, timeout=15)
            data = r.json()
            if "result" in data:
                return data
            if (data.get("error") or {}).get("code") == -32429:
                continue
        except Exception as e:
            print(f"[PnL] RPC {url[:30]}: {e}")
    return {}


async def _get_signatures(wallet: str, since_ts: int) -> list[str]:
    sigs, before = [], None
    async with httpx.AsyncClient(timeout=15) as client:
        for _ in range(20):
            opts: dict = {"limit": 100, "commitment": "confirmed"}
            if before:
                opts["before"] = before
            data  = await _rpc(client, {"jsonrpc":"2.0","id":1,
                                        "method":"getSignaturesForAddress",
                                        "params":[wallet, opts]})
            batch = data.get("result") or []
            if not batch:
                break
            hit = False
            for s in batch:
                if (s.get("blockTime") or 0) < since_ts:
                    hit = True; break
                if not s.get("err"):
                    sigs.append(s["signature"])
            if hit or len(batch) < 100:
                break
            before = batch[-1]["signature"]
    return sigs


async def _get_transactions(sigs: list[str]) -> list:
    """Fetch transactions 5 at a time with retry for nulls."""
    PARAMS = {"encoding": "jsonParsed",
              "maxSupportedTransactionVersion": 0,
              "commitment": "confirmed"}

    async def fetch_one(client: httpx.AsyncClient, sig: str) -> dict | None:
        for attempt in range(3):
            data = await _rpc(client, {
                "jsonrpc": "2.0", "id": 1,
                "method": "getTransaction",
                "params": [sig, PARAMS],
            })
            result = data.get("result")
            if result is not None:
                return result
            await asyncio.sleep(0.3 * (attempt + 1))
        return None

    txs = []
    async with httpx.AsyncClient(timeout=30) as client:
        for i in range(0, min(len(sigs), 500), 5):
            batch = sigs[i:i+5]
            results = await asyncio.gather(*[fetch_one(client, s) for s in batch])
            fetched = [r for r in results if r]
            txs.extend(fetched)
            print(f"[PnL] batch {i//5+1}: {len(fetched)}/{len(batch)} fetched, total={len(txs)}")
            await asyncio.sleep(0.1)  # small delay to avoid rate limit
    return txs


def _empty(reason="") -> dict:
    if reason: print(f"[PnL] empty: {reason}")
    return {"total_pnl_pct": None, "total_pnl_usd": None,
            "trade_count": 0, "win_count": 0, "tokens_traded": 0}
