"""
Simple in-memory cache for API responses.
Avoids repeat calls to GoPlus, DexScreener, Solscan within the same time window.
Includes in-flight deduplication — concurrent requests for the same key wait
for the first fetch to complete instead of firing duplicate API calls.
"""
import time
import asyncio
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
_inflight: dict[str, asyncio.Event] = {}

def get(key: str, ttl: int) -> Any | None:
    if key not in _store:
        return None
    ts, val = _store[key]
    if time.time() - ts > ttl:
        del _store[key]
        return None
    return val

def set(key: str, val: Any) -> None:
    _store[key] = (time.time(), val)
    # Release any waiters
    if key in _inflight:
        _inflight[key].set()

async def get_or_wait(key: str, ttl: int) -> Any | None:
    """
    Check cache. If a fetch is in-flight for this key, wait for it to complete
    then return the cached value. Returns None if not cached.
    """
    cached = get(key, ttl)
    if cached is not None:
        return cached
    if key in _inflight:
        # Another coroutine is already fetching this — wait for it
        event = _inflight[key]
        await event.wait()
        return get(key, ttl)
    return None

def mark_inflight(key: str) -> None:
    """Call before starting a fetch to signal other waiters."""
    if key not in _inflight:
        _inflight[key] = asyncio.Event()

def unmark_inflight(key: str) -> None:
    """Call after fetch completes (success or failure)."""
    if key in _inflight:
        _inflight[key].set()
        del _inflight[key]

def clear_expired() -> None:
    now = time.time()
    expired = [k for k, (ts, _) in _store.items() if now - ts > 300]
    for k in expired:
        del _store[k]
