jest.mock('../db/supabaseClient', () => ({
  __esModule: true,
  default: {
    rpc: jest.fn(),
  },
}));

import supabase from '../db/supabaseClient';
import {
  joinExistingPublicLobby,
  normalizeLateJoinLap,
  shouldAutoActivatePublicLobby,
} from './publicLobbyManager';

const rpcMock = supabase.rpc as jest.Mock;

describe('publicLobbyManager', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  describe('normalizeLateJoinLap', () => {
    it('returns null for lap 1, zero, or missing values', () => {
      expect(normalizeLateJoinLap(null)).toBeNull();
      expect(normalizeLateJoinLap(undefined)).toBeNull();
      expect(normalizeLateJoinLap(0)).toBeNull();
      expect(normalizeLateJoinLap(1)).toBeNull();
      expect(normalizeLateJoinLap(1.2)).toBeNull();
    });

    it('floors lap numbers above 1', () => {
      expect(normalizeLateJoinLap(2)).toBe(2);
      expect(normalizeLateJoinLap(12.9)).toBe(12);
    });

    it('rejects non-finite values', () => {
      expect(normalizeLateJoinLap(Number.NaN)).toBeNull();
      expect(normalizeLateJoinLap(Number.POSITIVE_INFINITY)).toBeNull();
    });
  });

  describe('shouldAutoActivatePublicLobby', () => {
    it('activates waiting lobbies when the session is live or completed', () => {
      expect(shouldAutoActivatePublicLobby('waiting', true, false)).toBe(true);
      expect(shouldAutoActivatePublicLobby('waiting', false, true)).toBe(true);
    });

    it('does not activate active or pre-race waiting lobbies', () => {
      expect(shouldAutoActivatePublicLobby('active', true, false)).toBe(false);
      expect(shouldAutoActivatePublicLobby('waiting', false, false)).toBe(false);
    });
  });

  describe('joinExistingPublicLobby', () => {
    it('returns NEEDS_NEW_LOBBY when the RPC finds no open lobby', async () => {
      rpcMock.mockResolvedValue({
        data: [{ result_code: 'NEEDS_NEW_LOBBY' }],
        error: null,
      });

      await expect(joinExistingPublicLobby('9999', 'Driver', 5)).resolves.toBe('NEEDS_NEW_LOBBY');
    });

    it('returns OK payload from the RPC', async () => {
      rpcMock.mockResolvedValue({
        data: [{
          result_code: 'OK',
          out_lobby_id: 'lobby-1',
          out_lobby_code: 'ABC123',
          out_user_id: 'user-1',
        }],
        error: null,
      });

      await expect(joinExistingPublicLobby('9999', 'Driver', 5)).resolves.toEqual({
        lobbyId: 'lobby-1',
        lobbyCode: 'ABC123',
        userId: 'user-1',
        username: 'Driver',
        isNewLobby: false,
        joinedAtLap: 5,
      });
    });

    it('retries with a suffixed username when USERNAME_TAKEN', async () => {
      rpcMock
        .mockResolvedValueOnce({
          data: [{ result_code: 'USERNAME_TAKEN', out_lobby_id: 'lobby-1', out_lobby_code: 'ABC123' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{
            result_code: 'OK',
            out_lobby_id: 'lobby-1',
            out_lobby_code: 'ABC123',
            out_user_id: 'user-2',
          }],
          error: null,
        });

      const result = await joinExistingPublicLobby('9999', 'Driver', null);
      expect(result).toEqual(expect.objectContaining({
        userId: 'user-2',
        username: expect.stringMatching(/^Driver_\d+$/),
      }));
      expect(rpcMock).toHaveBeenCalledTimes(2);
    });
  });
});
