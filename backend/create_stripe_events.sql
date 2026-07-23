-- Idempotency table for the Stripe webhook (stripe_routes.py -> _already_processed).
-- Stripe can deliver the same event more than once (retries/replays). Recording
-- each event id lets the webhook skip work it has already done, so a replayed
-- payment event can't re-send the welcome DM or re-run tier logic.
-- Run once in the Supabase SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,   -- Stripe event id (evt_...)
  type         TEXT,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Service key only: no client should ever read or write this table.
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
