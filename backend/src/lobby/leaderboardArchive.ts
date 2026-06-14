// @ts-nocheck
import supabase from '../db/supabaseClient';
import { trackDbQuery, trackDbWrite } from '../observability/dbMetrics';

export interface LeaderboardBootstrapResult {
  restored: boolean;
  joinedAtLap: number | null;
  entry: {
    points: number;
    streak: number;
    maxStreak: number;
    correctAnswers: number;
    wrongAnswers: number;
    questionsAnswered: number;
    accuracy: number;
  };
}

const EMPTY_LEADERBOARD_ENTRY = {
  points: 0,
  streak: 0,
  maxStreak: 0,
  correctAnswers: 0,
  wrongAnswers: 0,
  questionsAnswered: 0,
  accuracy: 0,
};

export async function archiveLeaderboardForInactivePlayer(params: {
  lobbyId: string;
  userId: string;
  username: string;
  joinedAtLap?: number | null;
}): Promise<void> {
  trackDbQuery('leaderboard.read_for_archive');
  const { data: leaderboard, error: leaderboardError } = await supabase
    .from('leaderboard')
    .select('*')
    .eq('lobby_id', params.lobbyId)
    .eq('user_id', params.userId)
    .maybeSingle();

  if (leaderboardError) {
    throw new Error(`Failed to read leaderboard for archive: ${leaderboardError.message}`);
  }

  if (!leaderboard) {
    return;
  }

  trackDbWrite('leaderboard_archives.upsert');
  const { error: archiveError } = await supabase
    .from('leaderboard_archives')
    .upsert({
      lobby_id: params.lobbyId,
      archived_user_id: params.userId,
      username: params.username,
      points: leaderboard.points ?? 0,
      streak: leaderboard.streak ?? 0,
      max_streak: leaderboard.max_streak ?? 0,
      correct_answers: leaderboard.correct_answers ?? 0,
      wrong_answers: leaderboard.wrong_answers ?? 0,
      questions_answered: leaderboard.questions_answered ?? 0,
      accuracy: leaderboard.accuracy ?? 0,
      scored_instance_ids: leaderboard.scored_instance_ids ?? [],
      joined_at_lap: params.joinedAtLap ?? null,
      archived_at: new Date().toISOString(),
    }, { onConflict: 'lobby_id,archived_user_id' });

  if (archiveError) {
    throw new Error(`Failed to archive leaderboard: ${archiveError.message}`);
  }
}

export async function restoreOrBootstrapLeaderboard(
  lobbyId: string,
  userId: string,
  options?: { restoreUserId?: string | null }
): Promise<LeaderboardBootstrapResult> {
  const restoreUserId = options?.restoreUserId?.trim() || null;

  if (restoreUserId) {
    trackDbQuery('leaderboard_archives.read');
    const { data: archive, error: archiveError } = await supabase
      .from('leaderboard_archives')
      .select('*')
      .eq('lobby_id', lobbyId)
      .eq('archived_user_id', restoreUserId)
      .maybeSingle();

    if (archiveError) {
      throw new Error(`Failed to read leaderboard archive: ${archiveError.message}`);
    }

    if (archive) {
      trackDbWrite('leaderboard.restore_from_archive');
      const { error: restoreError } = await supabase
        .from('leaderboard')
        .upsert({
          lobby_id: lobbyId,
          user_id: userId,
          points: archive.points ?? 0,
          streak: archive.streak ?? 0,
          max_streak: archive.max_streak ?? 0,
          correct_answers: archive.correct_answers ?? 0,
          wrong_answers: archive.wrong_answers ?? 0,
          questions_answered: archive.questions_answered ?? 0,
          accuracy: archive.accuracy ?? 0,
          scored_instance_ids: archive.scored_instance_ids ?? [],
        }, { onConflict: 'lobby_id,user_id' });

      if (restoreError) {
        throw new Error(`Failed to restore archived leaderboard: ${restoreError.message}`);
      }

      trackDbWrite('users.restore_joined_at_lap');
      await supabase
        .from('users')
        .update({ joined_at_lap: archive.joined_at_lap ?? null })
        .eq('id', userId);

      trackDbWrite('leaderboard_archives.delete');
      await supabase
        .from('leaderboard_archives')
        .delete()
        .eq('lobby_id', lobbyId)
        .eq('archived_user_id', restoreUserId);

      return {
        restored: true,
        joinedAtLap: archive.joined_at_lap ?? null,
        entry: {
          points: archive.points ?? 0,
          streak: archive.streak ?? 0,
          maxStreak: archive.max_streak ?? 0,
          correctAnswers: archive.correct_answers ?? 0,
          wrongAnswers: archive.wrong_answers ?? 0,
          questionsAnswered: archive.questions_answered ?? 0,
          accuracy: Number(archive.accuracy ?? 0),
        },
      };
    }
  }

  trackDbWrite('leaderboard.bootstrap');
  const { error: bootstrapError } = await supabase
    .from('leaderboard')
    .upsert({
      lobby_id: lobbyId,
      user_id: userId,
      points: 0,
      streak: 0,
      max_streak: 0,
      correct_answers: 0,
      wrong_answers: 0,
      questions_answered: 0,
      accuracy: 0,
      scored_instance_ids: [],
    }, { onConflict: 'lobby_id,user_id', ignoreDuplicates: true });

  if (bootstrapError) {
    throw new Error(`Failed to bootstrap leaderboard: ${bootstrapError.message}`);
  }

  return {
    restored: false,
    joinedAtLap: null,
    entry: EMPTY_LEADERBOARD_ENTRY,
  };
}
