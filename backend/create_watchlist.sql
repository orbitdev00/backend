-- Creates the `watchlist` table used by the Tracker page
-- (frontend/src/pages/Tracker.jsx -> supabase.from('watchlist')).
-- It was referenced by shipping code but never created in this project,
-- which is why supabase_rls.sql reported "relation watchlist does not exist".
-- Run this once in the Supabase SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS watchlist (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    TEXT        NOT NULL,
  mint       TEXT        NOT NULL,
  name       TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS watchlist_user_id_idx ON watchlist(user_id);

-- Row Level Security: users only see/modify their own rows.
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own read watchlist"   ON watchlist;
DROP POLICY IF EXISTS "own insert watchlist" ON watchlist;
DROP POLICY IF EXISTS "own delete watchlist" ON watchlist;

CREATE POLICY "own read watchlist"   ON watchlist FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "own insert watchlist" ON watchlist FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "own delete watchlist" ON watchlist FOR DELETE USING (auth.uid()::text = user_id);
