-- Orbit pre-launch DB verification.
-- Paste into the Supabase SQL Editor and run. Returns ONE result set
-- summarizing every launch-critical piece of database state.
--
-- What to look for:
--   * every expected table -> "EXISTS, RLS=true"
--   * trigger row          -> "PRESENT (C2 fix active)"
--   * owner row            -> "username=Orbit_Dev role=owner tier=omega"

SELECT 'table: ' || t.tbl AS check,
       CASE
         WHEN to_regclass('public.' || t.tbl) IS NULL THEN 'MISSING'
         ELSE 'EXISTS, RLS=' ||
              COALESCE((SELECT relrowsecurity FROM pg_class
                        WHERE oid = to_regclass('public.' || t.tbl))::text, '?')
       END AS status
FROM (VALUES
  ('user_reputation'), ('predictions'), ('user_calls'), ('user_badges'),
  ('watchlist'), ('direct_messages'), ('forum_threads'), ('forum_posts'),
  ('forum_votes'), ('user_follows'), ('trial_uses'), ('forum_categories'),
  ('forum_badges'), ('watched_coins')
) AS t(tbl)

UNION ALL
SELECT 'trigger: protect_reputation_columns (C2 paywall/role guard)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                         WHERE tgname = 'trg_protect_reputation_columns')
            THEN 'PRESENT (C2 fix active)'
            ELSE 'MISSING - re-run supabase_rls.sql' END

UNION ALL
SELECT 'function: protect_reputation_columns',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc
                         WHERE proname = 'protect_reputation_columns')
            THEN 'PRESENT'
            ELSE 'MISSING - re-run supabase_rls.sql' END

UNION ALL
SELECT 'owner row (orbitdev00@gmail.com)',
       COALESCE(
         (SELECT 'username=' || COALESCE(username, 'null') ||
                 ' role='     || COALESCE(role, 'null') ||
                 ' tier='     || COALESCE(tier, 'null')
          FROM user_reputation
          WHERE email = 'orbitdev00@gmail.com' LIMIT 1),
         'NOT FOUND - run fix_owner_permissions.sql')

ORDER BY 1;
