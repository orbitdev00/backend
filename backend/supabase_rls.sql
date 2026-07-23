-- Supabase Row Level Security policies for Orbit
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor).
-- The service key bypasses RLS, so backend writes are unaffected.
--
-- Safe to run repeatedly, and on any project state:
--   * every policy is dropped-then-created (idempotent), and
--   * every table is guarded by to_regclass(), so tables that do not exist
--     in this project are skipped with a NOTICE instead of aborting the run.

-- ------------------------------------------------------------------
-- Helpers (dropped again at the end of the script)
-- ------------------------------------------------------------------

-- Enable RLS on a table only if it exists.
CREATE OR REPLACE FUNCTION _orbit_enable_rls(tbl text) RETURNS void AS $fn$
BEGIN
  IF to_regclass('public.' || tbl) IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  ELSE
    RAISE NOTICE 'orbit-rls: table % not found, skipping', tbl;
  END IF;
END;
$fn$ LANGUAGE plpgsql;

-- (Re)create a policy only if the table exists. `body` is the clause after
-- the policy name, e.g. 'FOR SELECT USING (true)'.
CREATE OR REPLACE FUNCTION _orbit_policy(tbl text, pol text, body text) RETURNS void AS $fn$
BEGIN
  IF to_regclass('public.' || tbl) IS NOT NULL THEN
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol, tbl);
    EXECUTE format('CREATE POLICY %I ON %I %s', pol, tbl, body);
  END IF;
END;
$fn$ LANGUAGE plpgsql;

-- Drop a policy only if the table exists (for service-key-only tables).
CREATE OR REPLACE FUNCTION _orbit_drop_policy(tbl text, pol text) RETURNS void AS $fn$
BEGIN
  IF to_regclass('public.' || tbl) IS NOT NULL THEN
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol, tbl);
  END IF;
END;
$fn$ LANGUAGE plpgsql;


-- ------------------------------------------------------------------
-- user_reputation
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('user_reputation');
-- Anyone can read public reputation data (leaderboard, profiles)
SELECT _orbit_policy('user_reputation', 'public read user_reputation',
                     'FOR SELECT USING (true)');
-- Users can only update their own row
SELECT _orbit_policy('user_reputation', 'own row update user_reputation',
                     'FOR UPDATE USING (auth.uid()::text = user_id)');
-- Users can insert their own row (needed for first-time onboarding)
SELECT _orbit_policy('user_reputation', 'own insert user_reputation',
                     'FOR INSERT WITH CHECK (auth.uid()::text = user_id)');

-- PROTECT PRIVILEGED COLUMNS ---------------------------------------
-- CRITICAL: the "own row update" policy above lets a user PATCH their own row.
-- Without a column guard, an authenticated user can set tier='omega',
-- role='owner', reset their daily quota, or forge total_pnl_pct (leaderboard
-- fraud) with a single REST call using their own anon token. RLS cannot restrict
-- columns, so we enforce it with a trigger. The service key connects as the
-- 'service_role' DB role and is exempt, so backend writes (Stripe, admin,
-- rate-limiter) still work.
CREATE OR REPLACE FUNCTION protect_reputation_columns()
RETURNS trigger AS $fn$
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
$fn$ LANGUAGE plpgsql;

DO $do$
BEGIN
  IF to_regclass('public.user_reputation') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_protect_reputation_columns ON user_reputation';
    EXECUTE 'CREATE TRIGGER trg_protect_reputation_columns '
            'BEFORE UPDATE ON user_reputation '
            'FOR EACH ROW EXECUTE FUNCTION protect_reputation_columns()';
  ELSE
    RAISE NOTICE 'orbit-rls: user_reputation not found, trigger skipped';
  END IF;
END $do$;


-- ------------------------------------------------------------------
-- predictions
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('predictions');
SELECT _orbit_policy('predictions', 'public read predictions',
                     'FOR SELECT USING (true)');
SELECT _orbit_policy('predictions', 'own insert predictions',
                     'FOR INSERT WITH CHECK (auth.uid()::text = user_id OR user_id IS NULL)');
-- No direct updates from client - backend service key handles updates.


-- ------------------------------------------------------------------
-- user_calls (tracker watchlist)
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('user_calls');
SELECT _orbit_policy('user_calls', 'own read user_calls',
                     'FOR SELECT USING (auth.uid()::text = user_id)');
SELECT _orbit_policy('user_calls', 'own insert user_calls',
                     'FOR INSERT WITH CHECK (auth.uid()::text = user_id)');
SELECT _orbit_policy('user_calls', 'own delete user_calls',
                     'FOR DELETE USING (auth.uid()::text = user_id)');


-- ------------------------------------------------------------------
-- user_badges
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('user_badges');
SELECT _orbit_policy('user_badges', 'public read user_badges',
                     'FOR SELECT USING (true)');
-- Only the service key can insert/update badges (no client write policy).


-- ------------------------------------------------------------------
-- watchlist (coin watchlist saved to account)
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('watchlist');
SELECT _orbit_policy('watchlist', 'own read watchlist',
                     'FOR SELECT USING (auth.uid()::text = user_id)');
SELECT _orbit_policy('watchlist', 'own insert watchlist',
                     'FOR INSERT WITH CHECK (auth.uid()::text = user_id)');
SELECT _orbit_policy('watchlist', 'own delete watchlist',
                     'FOR DELETE USING (auth.uid()::text = user_id)');


-- ------------------------------------------------------------------
-- direct_messages
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('direct_messages');
SELECT _orbit_policy('direct_messages', 'own read direct_messages',
                     'FOR SELECT USING (auth.uid()::text = sender_id OR auth.uid()::text = receiver_id)');
-- Inserts go through backend service key only (no client INSERT policy).


-- ------------------------------------------------------------------
-- forum_threads
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('forum_threads');
SELECT _orbit_policy('forum_threads', 'public read forum_threads',
                     'FOR SELECT USING (true)');
-- All writes go through backend service key only.


-- ------------------------------------------------------------------
-- forum_posts
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('forum_posts');
SELECT _orbit_policy('forum_posts', 'public read forum_posts',
                     'FOR SELECT USING (true)');
-- All writes go through backend service key only.


-- ------------------------------------------------------------------
-- forum_votes
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('forum_votes');
SELECT _orbit_policy('forum_votes', 'own read forum_votes',
                     'FOR SELECT USING (auth.uid()::text = user_id)');
-- All writes go through backend service key only.


-- ------------------------------------------------------------------
-- user_follows
-- ------------------------------------------------------------------
SELECT _orbit_enable_rls('user_follows');
SELECT _orbit_policy('user_follows', 'public read user_follows',
                     'FOR SELECT USING (true)');
-- All writes go through backend service key only.


-- ------------------------------------------------------------------
-- trial_uses (free-analysis gate) - service key only, no client policies
-- ------------------------------------------------------------------
-- trial_gate.py now uses the SERVICE key. Lock this table so clients cannot
-- read, insert, delete or forge trial records to farm unlimited free analyses.
SELECT _orbit_enable_rls('trial_uses');
SELECT _orbit_drop_policy('trial_uses', 'public read trial_uses');
SELECT _orbit_drop_policy('trial_uses', 'public insert trial_uses');


-- ------------------------------------------------------------------
-- Clean up helpers
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS _orbit_enable_rls(text);
DROP FUNCTION IF EXISTS _orbit_policy(text, text, text);
DROP FUNCTION IF EXISTS _orbit_drop_policy(text, text);
