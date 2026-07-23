-- Supabase Row Level Security policies for Orbit
-- Run these in the Supabase SQL Editor (Dashboard > SQL Editor)
-- The service key bypasses RLS, so backend writes are unaffected.

-- ─── user_reputation ────────────────────────────────────────────────────────
ALTER TABLE user_reputation ENABLE ROW LEVEL SECURITY;

-- Anyone can read public reputation data (leaderboard, profiles)
CREATE POLICY "public read user_reputation"
  ON user_reputation FOR SELECT
  USING (true);

-- Users can only update their own row
CREATE POLICY "own row update user_reputation"
  ON user_reputation FOR UPDATE
  USING (auth.uid()::text = user_id);

-- Users can insert their own row (needed for first-time onboarding)
CREATE POLICY "own insert user_reputation"
  ON user_reputation FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

-- ─── PROTECT PRIVILEGED COLUMNS ──────────────────────────────────────────────
-- CRITICAL: the "own row update" policy above lets a user PATCH their own row.
-- Without a column guard, an authenticated user can set tier='omega',
-- role='owner', reset their daily quota, or forge total_pnl_pct (leaderboard
-- fraud) with a single REST call using their own anon token. RLS cannot restrict
-- columns, so we enforce it with a trigger. The service key connects as the
-- 'service_role' DB role and is exempt, so backend writes (Stripe, admin,
-- rate-limiter) still work.
CREATE OR REPLACE FUNCTION protect_reputation_columns()
RETURNS trigger AS $$
BEGIN
  -- Backend service key bypasses the guard.
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.tier                    IS DISTINCT FROM OLD.tier
     OR NEW.role                 IS DISTINCT FROM OLD.role
     OR NEW.daily_analysis_count IS DISTINCT FROM OLD.daily_analysis_count
     OR NEW.daily_reset_date     IS DISTINCT FROM OLD.daily_reset_date
     OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
     OR NEW.stripe_customer_id   IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.total_pnl_pct        IS DISTINCT FROM OLD.total_pnl_pct
     OR NEW.score                IS DISTINCT FROM OLD.score
  THEN
    RAISE EXCEPTION 'protected column modification denied';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_reputation_columns ON user_reputation;
CREATE TRIGGER trg_protect_reputation_columns
  BEFORE UPDATE ON user_reputation
  FOR EACH ROW EXECUTE FUNCTION protect_reputation_columns();


-- ─── predictions ────────────────────────────────────────────────────────────
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

-- Public read (accuracy stats, leaderboard)
CREATE POLICY "public read predictions"
  ON predictions FOR SELECT
  USING (true);

-- Users can only insert their own predictions
CREATE POLICY "own insert predictions"
  ON predictions FOR INSERT
  WITH CHECK (auth.uid()::text = user_id OR user_id IS NULL);

-- No direct updates from client — backend service key handles updates


-- ─── user_calls (tracker watchlist) ─────────────────────────────────────────
ALTER TABLE user_calls ENABLE ROW LEVEL SECURITY;

-- Users can only read their own watchlist
CREATE POLICY "own read user_calls"
  ON user_calls FOR SELECT
  USING (auth.uid()::text = user_id);

-- Users can only insert into their own watchlist
CREATE POLICY "own insert user_calls"
  ON user_calls FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

-- Users can only delete their own watchlist entries
CREATE POLICY "own delete user_calls"
  ON user_calls FOR DELETE
  USING (auth.uid()::text = user_id);


-- ─── user_badges ─────────────────────────────────────────────────────────────
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

-- Anyone can read badge data (public profiles)
CREATE POLICY "public read user_badges"
  ON user_badges FOR SELECT
  USING (true);

-- Only service key can insert/update badges (no client policy = denied for anon/authed)


-- ---- watchlist (coin watchlist saved to account) -----------------------------
-- Run this block once to create the table, then the policies below.
-- CREATE TABLE IF NOT EXISTS watchlist (
--   id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
--   user_id    TEXT        NOT NULL,
--   mint       TEXT        NOT NULL,
--   name       TEXT,
--   note       TEXT,
--   created_at TIMESTAMPTZ DEFAULT NOW()
-- );

ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own read watchlist"   ON watchlist;
DROP POLICY IF EXISTS "own insert watchlist" ON watchlist;
DROP POLICY IF EXISTS "own delete watchlist" ON watchlist;

CREATE POLICY "own read watchlist"   ON watchlist FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "own insert watchlist" ON watchlist FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "own delete watchlist" ON watchlist FOR DELETE USING (auth.uid()::text = user_id);


-- ---- direct_messages ---------------------------------------------------------
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own read direct_messages" ON direct_messages;

-- Users can read messages where they are sender or receiver
CREATE POLICY "own read direct_messages"
  ON direct_messages FOR SELECT
  USING (auth.uid()::text = sender_id OR auth.uid()::text = receiver_id);

-- Inserts go through backend service key only (no client INSERT policy)


-- ---- forum_threads -----------------------------------------------------------
ALTER TABLE forum_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read forum_threads" ON forum_threads;

CREATE POLICY "public read forum_threads" ON forum_threads FOR SELECT USING (true);

-- All writes go through backend service key only


-- ---- forum_posts -------------------------------------------------------------
ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read forum_posts" ON forum_posts;

CREATE POLICY "public read forum_posts" ON forum_posts FOR SELECT USING (true);

-- All writes go through backend service key only


-- ---- forum_votes -------------------------------------------------------------
ALTER TABLE forum_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own read forum_votes" ON forum_votes;

CREATE POLICY "own read forum_votes"
  ON forum_votes FOR SELECT
  USING (auth.uid()::text = user_id);

-- All writes go through backend service key only


-- ---- user_follows ------------------------------------------------------------
ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read user_follows" ON user_follows;

CREATE POLICY "public read user_follows" ON user_follows FOR SELECT USING (true);

-- All writes go through backend service key only


-- ---- trial_uses (free-analysis gate) ----------------------------------------
-- The trial gate (trial_gate.py) now uses the SERVICE key. Lock this table so
-- clients (anon/authenticated) cannot read, insert, delete or forge trial
-- records to farm unlimited free analyses. With RLS enabled and NO client
-- policies, only the service key (which bypasses RLS) can touch it.
ALTER TABLE trial_uses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read trial_uses"   ON trial_uses;
DROP POLICY IF EXISTS "public insert trial_uses" ON trial_uses;
-- (Intentionally no policies — service key only.)
