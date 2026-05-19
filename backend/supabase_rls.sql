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
