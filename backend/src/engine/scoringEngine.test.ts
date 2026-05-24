import type { Answer, LeaderboardEntry } from '../db/types';
import {
  calculateScore,
  dedupeAnswersByUser,
  processQuestionResults,
  STREAK_BONUS_3,
} from './scoringEngine';

function createLeaderboardEntry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    id: 'lb-1',
    lobby_id: 'lobby-1',
    user_id: 'user-1',
    points: 20,
    streak: 2,
    max_streak: 2,
    correct_answers: 2,
    wrong_answers: 1,
    questions_answered: 3,
    accuracy: 66.67,
    updated_at: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function createAnswer(overrides: Partial<Answer> = {}): Answer {
  return {
    id: 'answer-1',
    instance_id: 'instance-1',
    user_id: 'user-1',
    answer: 'YES',
    submitted_at: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    response_time_ms: 1200,
    ...overrides,
  };
}

describe('scoringEngine', () => {
  it('increments correct answers by exactly one for a correct answer', () => {
    const leaderboardEntries = new Map<string, LeaderboardEntry>([
      ['user-1', createLeaderboardEntry()],
    ]);

    const results = processQuestionResults(
      [createAnswer({ answer: 'YES' })],
      'YES',
      leaderboardEntries,
      new Map([['user-1', 'Driver One']]),
      'lobby-1'
    );

    const updatedEntry = leaderboardEntries.get('user-1');

    expect(results.get('user-1')).toEqual({
      pointsChange: 10 + STREAK_BONUS_3,
      isCorrect: true,
      newStreak: 3,
      streakBonus: STREAK_BONUS_3,
    });
    expect(updatedEntry?.correct_answers).toBe(3);
    expect(updatedEntry?.wrong_answers).toBe(1);
    expect(updatedEntry?.questions_answered).toBe(4);
  });

  it('keeps correct answers unchanged for an incorrect answer', () => {
    const leaderboardEntries = new Map<string, LeaderboardEntry>([
      ['user-1', createLeaderboardEntry()],
    ]);

    processQuestionResults(
      [createAnswer({ answer: 'NO' })],
      'YES',
      leaderboardEntries,
      new Map([['user-1', 'Driver One']]),
      'lobby-1'
    );

    const updatedEntry = leaderboardEntries.get('user-1');

    expect(updatedEntry?.correct_answers).toBe(2);
    expect(updatedEntry?.wrong_answers).toBe(2);
    expect(updatedEntry?.questions_answered).toBe(4);
    expect(updatedEntry?.streak).toBe(0);
  });

  it('ignores duplicate answers from the same user for a single question', () => {
    const answers = [
      createAnswer({ id: 'answer-1', user_id: 'user-1', answer: 'YES' }),
      createAnswer({ id: 'answer-2', user_id: 'user-1', answer: 'NO' }),
    ];

    expect(dedupeAnswersByUser(answers)).toHaveLength(1);

    const leaderboardEntries = new Map<string, LeaderboardEntry>([
      ['user-1', createLeaderboardEntry()],
    ]);

    processQuestionResults(
      answers,
      'YES',
      leaderboardEntries,
      new Map([['user-1', 'Driver One']]),
      'lobby-1'
    );

    const updatedEntry = leaderboardEntries.get('user-1');

    expect(updatedEntry?.correct_answers).toBe(3);
    expect(updatedEntry?.questions_answered).toBe(4);
  });

  it('calculates a wrong answer without increasing the correct counter', () => {
    expect(calculateScore('NO', 'YES', 4)).toEqual({
      pointsChange: 0,
      isCorrect: false,
      newStreak: 0,
      streakBonus: 0,
    });
  });
});
