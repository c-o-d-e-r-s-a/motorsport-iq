const fromMock = jest.fn();

jest.mock('../db/supabaseClient', () => ({
  __esModule: true,
  default: {
    from: fromMock,
  },
}));

import {
  archiveLeaderboardForInactivePlayer,
  restoreOrBootstrapLeaderboard,
} from './leaderboardArchive';

function createBuilder(result: unknown) {
  const builder: Record<string, jest.Mock> = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.maybeSingle = jest.fn(async () => result);
  builder.single = jest.fn(async () => result);
  builder.upsert = jest.fn(async () => ({ error: null }));
  builder.update = jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) }));
  builder.delete = jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })) }));
  return builder;
}

describe('leaderboardArchive', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('archives leaderboard stats by player id before inactive removal', async () => {
    const leaderboardBuilder = createBuilder({
      data: {
        points: 42,
        streak: 2,
        max_streak: 4,
        correct_answers: 3,
        wrong_answers: 1,
        questions_answered: 4,
        accuracy: 75,
        scored_instance_ids: ['instance-1'],
      },
      error: null,
    });
    const archiveBuilder = createBuilder({ data: null, error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'leaderboard') return leaderboardBuilder;
      if (table === 'leaderboard_archives') return archiveBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    await archiveLeaderboardForInactivePlayer({
      lobbyId: 'lobby-1',
      userId: 'user-1',
      username: 'Driver',
      joinedAtLap: 5,
    });

    expect(archiveBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lobby_id: 'lobby-1',
        archived_user_id: 'user-1',
        username: 'Driver',
        points: 42,
      }),
      { onConflict: 'lobby_id,archived_user_id' }
    );
  });

  it('restores archived stats only when restoreUserId matches the archive', async () => {
    const archiveBuilder = createBuilder({
      data: {
        points: 80,
        streak: 1,
        max_streak: 3,
        correct_answers: 5,
        wrong_answers: 2,
        questions_answered: 7,
        accuracy: 71.43,
        scored_instance_ids: ['instance-1', 'instance-2'],
        joined_at_lap: 8,
      },
      error: null,
    });
    const leaderboardBuilder = createBuilder({ data: null, error: null });
    const usersBuilder = createBuilder({ data: null, error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'leaderboard_archives') return archiveBuilder;
      if (table === 'leaderboard') return leaderboardBuilder;
      if (table === 'users') return usersBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await restoreOrBootstrapLeaderboard('lobby-1', 'user-new', {
      restoreUserId: 'user-original',
    });

    expect(result.restored).toBe(true);
    expect(result.entry.points).toBe(80);
    expect(archiveBuilder.eq).toHaveBeenCalledWith('archived_user_id', 'user-original');
  });

  it('bootstraps a fresh score when no restore token is provided', async () => {
    const leaderboardBuilder = createBuilder({ data: null, error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'leaderboard') return leaderboardBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await restoreOrBootstrapLeaderboard('lobby-1', 'user-new');

    expect(result.restored).toBe(false);
    expect(result.entry.points).toBe(0);
    expect(fromMock).not.toHaveBeenCalledWith('leaderboard_archives');
  });
});
