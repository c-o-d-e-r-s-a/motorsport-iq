const fromMock = jest.fn();

jest.mock('../db/supabaseClient', () => ({
  __esModule: true,
  default: {
    from: fromMock,
  },
}));

jest.mock('./leaderboardArchive', () => ({
  archiveLeaderboardForInactivePlayer: jest.fn(async () => undefined),
}));

import { archiveLeaderboardForInactivePlayer } from './leaderboardArchive';
import {
  clearLobbyCache,
  getLobbyState,
  hasPlayersInLobby,
  registerPublicLobbyState,
  removePlayer,
} from './lobbyManager';
import type { LobbyState } from '../types';

function createDeleteBuilder(): { delete: jest.Mock; eq: jest.Mock } {
  const eq = jest.fn(async () => ({ error: null }));
  const deleteFn = jest.fn(() => ({ eq }));
  return { delete: deleteFn, eq };
}

describe('removePlayer public lobby retention', () => {
  beforeEach(() => {
    fromMock.mockReset();
    (archiveLeaderboardForInactivePlayer as jest.Mock).mockClear();
  });

  it('keeps an active public lobby when the last player leaves', async () => {
    const lobbyId = 'public-active-lobby';
    const userId = 'solo-user';

    const initialState: LobbyState = {
      id: lobbyId,
      code: 'PUB001',
      shareUrl: '',
      hostId: userId,
      sessionId: '9999',
      status: 'active',
      sessionMode: 'live',
      replaySpeed: null,
      isReplayComplete: false,
      isSimulation: false,
      isPublic: true,
      players: [{ id: userId, username: 'Solo', isHost: true, connected: true }],
      currentQuestion: null,
      latestResolution: null,
      questionCount: 0,
      minQuestions: 8,
      maxQuestions: 15,
      leaderboard: [],
    };

    registerPublicLobbyState(initialState);

    const usersDelete = createDeleteBuilder();
    fromMock.mockImplementation((table: string) => {
      if (table === 'users') {
        return usersDelete;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await removePlayer(userId, { reason: 'left' });

    expect(result).toEqual(expect.objectContaining({
      lobbyId,
      lobbyDeleted: false,
      remainingPlayerIds: [],
    }));
    expect(fromMock).not.toHaveBeenCalledWith('lobbies');
    expect(usersDelete.delete).toHaveBeenCalled();

    const cached = await getLobbyState(lobbyId);
    expect(cached?.status).toBe('active');
    expect(cached?.isPublic).toBe(true);
    expect(cached?.players).toHaveLength(0);
    expect(hasPlayersInLobby(lobbyId)).toBe(false);

    clearLobbyCache(lobbyId);
  });

  it('deletes a waiting public lobby when the last player leaves', async () => {
    const lobbyId = 'public-waiting-lobby';
    const userId = 'solo-user';

    const initialState: LobbyState = {
      id: lobbyId,
      code: 'PUB002',
      shareUrl: '',
      hostId: userId,
      sessionId: '9999',
      status: 'waiting',
      sessionMode: null,
      replaySpeed: null,
      isReplayComplete: false,
      isSimulation: false,
      isPublic: true,
      players: [{ id: userId, username: 'Solo', isHost: true, connected: true }],
      currentQuestion: null,
      latestResolution: null,
      questionCount: 0,
      minQuestions: 8,
      maxQuestions: 15,
      leaderboard: [],
    };

    registerPublicLobbyState(initialState);

    const usersDelete = createDeleteBuilder();
    const lobbiesDelete = createDeleteBuilder();
    fromMock.mockImplementation((table: string) => {
      if (table === 'users') {
        return usersDelete;
      }
      if (table === 'lobbies') {
        return lobbiesDelete;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await removePlayer(userId, { reason: 'left' });

    expect(result).toEqual(expect.objectContaining({
      lobbyId,
      lobbyDeleted: true,
    }));
    expect(lobbiesDelete.delete).toHaveBeenCalled();
  });
});
