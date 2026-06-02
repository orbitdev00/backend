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


-- ─── watchlist ───────────────────────────────────────────────────────────────
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own read watchlist"
  ON watchlist FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "own insert watchlist"
  ON watchlist FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "own delete watchlist"
  ON watchlist FOR DELETE
  USING (auth.uid()::text = user_id);


-- ─── direct_messages ─────────────────────────────────────────────────────────
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

-- Users can read messages they sent or received
CREATE POLICY "own read direct_messages"
  ON direct_messages FOR SELECT
  USING (auth.uid()::text = sender_id OR auth.uid()::text = receiver_id);

-- Only service key can insert (all DMs go through backend)


-- ─── forum_threads ───────────────────────────────────────────────────────────
ALTER TABLE forum_threads ENABLE ROW LEVEL SECURITY;

-- Anyone can read threads
CREATE POLICY "public read forum_threads"
  ON forum_threads FOR SELECT
  USING (true);

-- Only service key can insert/update/delete (all writes go through backend)


-- ─── forum_posts ─────────────────────────────────────────────────────────────
ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;

-- Anyone can read posts
CREATE POLICY "public read forum_posts"
  ON forum_posts FOR SELECT
  USING (true);

-- Only service key can insert/update/delete (all writes go through backend)


-- ─── forum_votes ─────────────────────────────────────────────────────────────
ALTER TABLE forum_votes ENABLE ROW LEVEL SECURITY;

-- Users can only read their own votes
CREATE POLICY "own read forum_votes"
  ON forum_votes FOR SELECT
  USING (auth.uid()::text = user_id);

-- Only service key can insert/update/delete votes (all writes go through backend)


-- ─── user_follows ────────────────────────────────────────────────────────────
ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;

-- Anyone can read follow relationships (public social graph)
CREATE POLICY "public read user_follows"
  ON user_follows FOR SELECT
  USING (true);

-- Only service key can insert/delete (all writes go through backend)
