-- Hardening follow-up for public lobby support.
-- Run after migration_leaderboard_archives.sql and migration_push_notifications.sql.
-- These tables are backend-owned; the browser should not read or mutate them
-- with the Supabase publishable key.

DROP POLICY IF EXISTS "Anyone can read leaderboard archives" ON leaderboard_archives;
DROP POLICY IF EXISTS "Anyone can insert leaderboard archives" ON leaderboard_archives;
DROP POLICY IF EXISTS "Anyone can update leaderboard archives" ON leaderboard_archives;
DROP POLICY IF EXISTS "Anyone can delete leaderboard archives" ON leaderboard_archives;

ALTER TABLE leaderboard_archives ENABLE ROW LEVEL SECURITY;

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_reminder_sent ENABLE ROW LEVEL SECURITY;
