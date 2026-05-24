import type { Answer, LeaderboardEntry } from '../db/types';

/**
 * Scoring Engine - Calculate points and update leaderboards
 */

export interface ScoreResult {
  pointsChange: number;
  isCorrect: boolean;
  newStreak: number;
  streakBonus: number;
}

export interface UserScore {
  userId: string;
  username: string;
  points: number;
  streak: number;
  maxStreak: number;
  correctAnswers: number;
  wrongAnswers: number;
  questionsAnswered: number;
  accuracy: number;
}

// Scoring constants
export const POINTS_CORRECT = 10;
export const POINTS_WRONG = 0;
export const POINTS_NO_ANSWER = 0;
export const STREAK_BONUS_3 = 5;
export const STREAK_BONUS_5 = 10;

export function dedupeAnswersByUser(answers: Answer[]): Answer[] {
  const uniqueAnswers = new Map<string, Answer>();

  for (const answer of answers) {
    if (!uniqueAnswers.has(answer.user_id)) {
      uniqueAnswers.set(answer.user_id, answer);
    }
  }

  return [...uniqueAnswers.values()];
}

/**
 * Calculate score for a single answer
 */
export function calculateScore(
  userAnswer: 'YES' | 'NO' | 'NO_ANSWER' | null,
  correctAnswer: 'YES' | 'NO',
  currentStreak: number
): ScoreResult {
  // No answer (timed out or didn't submit)
  if (userAnswer === null || userAnswer === 'NO_ANSWER') {
    return {
      pointsChange: POINTS_NO_ANSWER,
      isCorrect: false,
      newStreak: 0,
      streakBonus: 0,
    };
  }

  const isCorrect = userAnswer === correctAnswer;

  if (isCorrect) {
    const newStreak = currentStreak + 1;
    let streakBonus = 0;

    // Streak bonuses
    if (newStreak >= 5) {
      streakBonus = STREAK_BONUS_5;
    } else if (newStreak >= 3) {
      streakBonus = STREAK_BONUS_3;
    }

    return {
      pointsChange: POINTS_CORRECT + streakBonus,
      isCorrect: true,
      newStreak,
      streakBonus,
    };
  } else {
    return {
      pointsChange: POINTS_WRONG,
      isCorrect: false,
      newStreak: 0,
      streakBonus: 0,
    };
  }
}

/**
 * Calculate accuracy
 */
export function calculateAccuracy(correctAnswers: number, totalAnswered: number): number {
  if (totalAnswered === 0) return 0;
  return Math.round((correctAnswers / totalAnswered) * 100 * 100) / 100; // Round to 2 decimal places
}

/**
 * Update leaderboard entry with new score
 */
export function updateLeaderboardEntry(
  entry: LeaderboardEntry | null,
  userId: string,
  lobbyId: string,
  scoreResult: ScoreResult
): LeaderboardEntry {
  if (!entry) {
    // Create new entry
    return {
      id: '', // Will be set by database
      lobby_id: lobbyId,
      user_id: userId,
      points: scoreResult.pointsChange,
      streak: scoreResult.newStreak,
      max_streak: scoreResult.newStreak,
      correct_answers: scoreResult.isCorrect ? 1 : 0,
      wrong_answers: scoreResult.isCorrect ? 0 : 1,
      questions_answered: 1,
      accuracy: scoreResult.isCorrect ? 100.0 : 0.0,
      updated_at: new Date().toISOString(),
    };
  }

  // Update existing entry
  const newCorrectAnswers = entry.correct_answers + (scoreResult.isCorrect ? 1 : 0);
  const newWrongAnswers = entry.wrong_answers + (scoreResult.isCorrect ? 0 : 1);
  const newQuestionsAnswered = entry.questions_answered + 1;
  const newMaxStreak = Math.max(entry.max_streak, scoreResult.newStreak);

  return {
    ...entry,
    points: entry.points + scoreResult.pointsChange,
    streak: scoreResult.newStreak,
    max_streak: newMaxStreak,
    correct_answers: newCorrectAnswers,
    wrong_answers: newWrongAnswers,
    questions_answered: newQuestionsAnswered,
    accuracy: calculateAccuracy(newCorrectAnswers, newQuestionsAnswered),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Process all answers for a resolved question
 */
export function processQuestionResults(
  answers: Answer[],
  correctAnswer: 'YES' | 'NO',
  leaderboardEntries: Map<string, LeaderboardEntry>,
  usernames: Map<string, string>,
  lobbyId: string
): Map<string, ScoreResult> {
  const results = new Map<string, ScoreResult>();

  for (const answer of dedupeAnswersByUser(answers)) {
    const entry = leaderboardEntries.get(answer.user_id) ?? null;
    const currentStreak = entry?.streak ?? 0;

    const result = calculateScore(answer.answer, correctAnswer, currentStreak);
    results.set(answer.user_id, result);

    // Update leaderboard entry
    const updatedEntry = updateLeaderboardEntry(
      entry,
      answer.user_id,
      lobbyId,
      result
    );
    leaderboardEntries.set(answer.user_id, updatedEntry);
  }

  return results;
}

/**
 * Sort leaderboard by points, then by accuracy, then by streak
 */
export function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    // First by points (descending)
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    // Then by accuracy (descending)
    if (b.accuracy !== a.accuracy) {
      return b.accuracy - a.accuracy;
    }
    // Then by max streak (descending)
    return b.max_streak - a.max_streak;
  });
}

/**
 * Calculate rank for a user
 */
export function calculateRank(
  sortedEntries: LeaderboardEntry[],
  userId: string
): number {
  const index = sortedEntries.findIndex((e) => e.user_id === userId);
  return index >= 0 ? index + 1 : 0;
}

/**
 * Format score update for socket emission
 */
export function formatScoreUpdate(
  userId: string,
  username: string,
  entry: LeaderboardEntry,
  scoreResult: ScoreResult,
  answered: boolean
): UserScore & { pointsChange: number; answered: boolean; wasCorrect: boolean | null } {
  return {
    userId,
    username,
    points: entry.points,
    streak: entry.streak,
    maxStreak: entry.max_streak,
    correctAnswers: entry.correct_answers,
    wrongAnswers: entry.wrong_answers,
    questionsAnswered: entry.questions_answered,
    accuracy: entry.accuracy,
    pointsChange: scoreResult.pointsChange,
    answered,
    wasCorrect: answered ? scoreResult.isCorrect : null,
  };
}

/**
 * Get streak display text
 */
export function getStreakText(streak: number): string {
  if (streak >= 5) {
    return `🔥 ${streak} streak! +${STREAK_BONUS_5} bonus`;
  } else if (streak >= 3) {
    return `🔥 ${streak} streak! +${STREAK_BONUS_3} bonus`;
  } else if (streak >= 1) {
    return `🔥 ${streak} streak`;
  }
  return '';
}

/**
 * Get points display text
 */
export function getPointsText(pointsChange: number): string {
  if (pointsChange > 0) {
    return `+${pointsChange}`;
  } else if (pointsChange < 0) {
    return `${pointsChange}`;
  }
  return '0';
}
