"""
Simple in-memory cache for API responses.
Avoids repeat calls to GoPlus and DexScreener within the same time window.
"""
import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}

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

def clear_expired() -> None:
    now = time.time()
    expired = [k for k, (ts, _) in _store.items() if now - ts > 300]
    for k in expired:
        del _store[k]
