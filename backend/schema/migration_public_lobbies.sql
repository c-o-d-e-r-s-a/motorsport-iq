-- Migration: Public Lobby Matchmaking & Late-Join Tracking
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- It is safe to run more than once — all statements use IF NOT EXISTS / OR REPLACE.

-- ─── Step 1: New columns ──────────────────────────────────────────────────────

ALTER TABLE lobbies
  ADD COLUMN IF NOT EXISTS is_public        BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_session_key TEXT;          -- OpenF1 session_key (text) for public lobby matching

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS joined_at_lap    INT;             -- NULL = present from lap 1; >1 = late joiner

-- Fast lookup: find open public lobbies for a given session
CREATE INDEX IF NOT EXISTS idx_lobbies_public_session
  ON lobbies(is_public, public_session_key, status)
  WHERE is_public = true;

-- ─── Step 2: Atomic join RPC ──────────────────────────────────────────────────
-- Finds the most-full open public lobby for a session with a free slot and
-- inserts the user atomically.  Uses FOR UPDATE SKIP LOCKED so 500 concurrent
-- join attempts can't double-fill a lobby slot.
--
-- result_code values:
--   'OK'             – user inserted, out_lobby_id / out_lobby_code / out_user_id populated
--   'NEEDS_NEW_LOBBY'– no eligible lobby found; caller should create a fresh one
--   'USERNAME_TAKEN' – slot found but username already exists in that lobby

CREATE OR REPLACE FUNCTION join_public_lobby_atomic(
  p_session_key   TEXT,
  p_max_players   INT,
  p_username      TEXT,
  p_current_lap   INT  DEFAULT NULL
) RETURNS TABLE(
  out_lobby_id    UUID,
  out_lobby_code  TEXT,
  out_user_id     UUID,
  result_code     TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  v_lobby_id    UUID;
  v_lobby_code  TEXT;
  v_user_id     UUID;
BEGIN
  -- Lock the most-full eligible public lobby with a free slot.
  -- SKIP LOCKED means concurrent transactions each grab a different row,
  -- preventing double-booking of the same slot.
  SELECT l.id, l.code
    INTO v_lobby_id, v_lobby_code
    FROM lobbies l
   WHERE l.is_public = true
     AND l.public_session_key = p_session_key
     AND l.status IN ('waiting', 'active')
     AND (SELECT COUNT(*) FROM users u WHERE u.lobby_id = l.id) < p_max_players
   ORDER BY (SELECT COUNT(*) FROM users u WHERE u.lobby_id = l.id) DESC
   LIMIT 1
     FOR UPDATE SKIP LOCKED;

  IF v_lobby_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::UUID, 'NEEDS_NEW_LOBBY'::TEXT;
    RETURN;
  END IF;

  -- Guard against duplicate usernames within the same lobby.
  IF EXISTS (
    SELECT 1 FROM users WHERE lobby_id = v_lobby_id AND username = p_username
  ) THEN
    RETURN QUERY SELECT v_lobby_id, v_lobby_code, NULL::UUID, 'USERNAME_TAKEN'::TEXT;
    RETURN;
  END IF;

  -- Insert player.
  INSERT INTO users (username, lobby_id, is_host, joined_at_lap)
  VALUES (p_username, v_lobby_id, false, p_current_lap)
  RETURNING id INTO v_user_id;

  -- Bootstrap leaderboard row.
  INSERT INTO leaderboard (
    lobby_id, user_id, points, streak, max_streak,
    correct_answers, wrong_answers, questions_answered, accuracy
  )
  VALUES (v_lobby_id, v_user_id, 0, 0, 0, 0, 0, 0, 0)
  ON CONFLICT (lobby_id, user_id) DO NOTHING;

  RETURN QUERY SELECT v_lobby_id, v_lobby_code, v_user_id, 'OK'::TEXT;
END;
$$;
