-- Push notification subscriptions (race alerts + in-game question alerts)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_subscriber_id
  ON push_subscriptions (subscriber_id);

-- Tracks which race reminders were already sent (survives server restarts)
CREATE TABLE IF NOT EXISTS race_reminder_sent (
  session_key INTEGER PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
