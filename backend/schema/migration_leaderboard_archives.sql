-- Preserves player scores when inactive users are removed and later rejoin the same lobby.
-- Archives are keyed by the removed player's user id, not display name.
CREATE TABLE IF NOT EXISTS leaderboard_archives (
  lobby_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  archived_user_id UUID NOT NULL,
  username VARCHAR(50) NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  max_streak INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  wrong_answers INTEGER NOT NULL DEFAULT 0,
  questions_answered INTEGER NOT NULL DEFAULT 0,
  accuracy DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  scored_instance_ids UUID[] NOT NULL DEFAULT '{}',
  joined_at_lap INTEGER,
  archived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lobby_id, archived_user_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_archives_lobby_id
  ON leaderboard_archives(lobby_id);

ALTER TABLE leaderboard_archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read leaderboard archives"
  ON leaderboard_archives FOR SELECT USING (true);

CREATE POLICY "Anyone can insert leaderboard archives"
  ON leaderboard_archives FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update leaderboard archives"
  ON leaderboard_archives FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete leaderboard archives"
  ON leaderboard_archives FOR DELETE USING (true);
