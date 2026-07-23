-- Creates the `trial_uses` table used by the free-analysis gate
-- (backend/trial_gate.py -> check_trial() / consume_trial()).
-- It was referenced by shipping code (and by supabase_rls.sql / preflight_check.sql)
-- but never created in this project. Without it, check_trial() throws, the gate
-- fails CLOSED, and every guest sees "You've used your free analysis" on their
-- first click -- i.e. the free trial appears completely broken.
-- Run this once in the Supabase SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS trial_uses (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  fingerprint TEXT        NOT NULL,
  mint        TEXT,
  ip_hint     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- One trial row per visitor. The UNIQUE constraint also hardens the gate against
-- the check-then-insert race (two concurrent first analyses from one fingerprint).
CREATE UNIQUE INDEX IF NOT EXISTS trial_uses_fingerprint_idx ON trial_uses(fingerprint);

-- Service-key only: no client (anon) policies. trial_gate.py uses the SERVICE key,
-- so enabling RLS with zero policies locks guests out of reading, forging, or
-- deleting their own trial rows to farm unlimited free analyses.
-- (supabase_rls.sql also enables RLS and drops any public policies on this table.)
ALTER TABLE trial_uses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read trial_uses"   ON trial_uses;
DROP POLICY IF EXISTS "public insert trial_uses" ON trial_uses;
