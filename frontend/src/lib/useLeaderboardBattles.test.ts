import {
  computeRival,
  diffLeaderboards,
  sortLeaderboardEntries,
  type RankedInfo,
} from './useLeaderboardBattles';
import type { LeaderboardEntry } from './types';

function entry(overrides: Partial<LeaderboardEntry> & { userId: string }): LeaderboardEntry {
  return {
    username: overrides.userId,
    points: 0,
    streak: 0,
    maxStreak: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    questionsAnswered: 0,
    accuracy: 0,
    ...overrides,
  };
}

function ranked(rows: Array<[string, number, number]>): Map<string, RankedInfo> {
  return new Map(rows.map(([userId, rank, points]) => [userId, { rank, points, username: userId }]));
}

describe('sortLeaderboardEntries', () => {
  it('sorts by points, then accuracy, then max streak', () => {
    const entries = [
      entry({ userId: 'a', points: 10, accuracy: 50, maxStreak: 1 }),
      entry({ userId: 'b', points: 20 }),
      entry({ userId: 'c', points: 10, accuracy: 80 }),
      entry({ userId: 'd', points: 10, accuracy: 50, maxStreak: 3 }),
    ];
    expect(sortLeaderboardEntries(entries).map((e) => e.userId)).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('diffLeaderboards', () => {
  it('detects an overtake when a player gains points and passes another', () => {
    const prev = ranked([['alex', 1, 20], ['irfan', 2, 15]]);
    const next = ranked([['irfan', 1, 25], ['alex', 2, 20]]);

    const { deltas, overtakes } = diffLeaderboards(prev, next);

    expect(deltas).toEqual({ irfan: 1, alex: -1 });
    expect(overtakes).toHaveLength(1);
    expect(overtakes[0]).toMatchObject({
      attackerId: 'irfan',
      victimId: 'alex',
      newRank: 1,
      isLeadChange: true,
    });
  });

  it('ignores rank gains caused purely by a player leaving (no points gained)', () => {
    const prev = ranked([['alex', 1, 20], ['irfan', 2, 15], ['sam', 3, 10]]);
    const next = ranked([['irfan', 1, 15], ['sam', 2, 10]]);

    const { overtakes } = diffLeaderboards(prev, next);

    expect(overtakes).toHaveLength(0);
  });

  it('flags non-lead overtakes with the victim and new rank', () => {
    const prev = ranked([['alex', 1, 30], ['sam', 2, 20], ['irfan', 3, 15]]);
    const next = ranked([['alex', 1, 30], ['irfan', 2, 25], ['sam', 3, 20]]);

    const { overtakes } = diffLeaderboards(prev, next);

    expect(overtakes).toHaveLength(1);
    expect(overtakes[0]).toMatchObject({
      attackerId: 'irfan',
      victimId: 'sam',
      newRank: 2,
      isLeadChange: false,
    });
  });

  it('reports no victim when the passed player is no longer present', () => {
    const prev = ranked([['alex', 1, 20], ['irfan', 2, 15]]);
    const next = ranked([['irfan', 1, 25]]);

    const { overtakes } = diffLeaderboards(prev, next);

    expect(overtakes).toHaveLength(1);
    expect(overtakes[0].victimId).toBeNull();
  });
});

describe('computeRival', () => {
  const board = [
    entry({ userId: 'alex', points: 30 }),
    entry({ userId: 'irfan', points: 22 }),
    entry({ userId: 'sam', points: 10 }),
  ];

  it('targets the player directly ahead when not leading', () => {
    expect(computeRival(board, 'irfan')).toEqual({
      mode: 'hunting',
      name: 'alex',
      gap: 8,
      myRank: 2,
    });
  });

  it('targets the closest chaser when leading', () => {
    expect(computeRival(board, 'alex')).toEqual({
      mode: 'leading',
      name: 'irfan',
      gap: 8,
      myRank: 1,
    });
  });

  it('returns null when solo or not on the board', () => {
    expect(computeRival([entry({ userId: 'alex' })], 'alex')).toBeNull();
    expect(computeRival(board, 'ghost')).toBeNull();
    expect(computeRival(board, null)).toBeNull();
  });
});
