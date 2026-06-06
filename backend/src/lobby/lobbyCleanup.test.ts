jest.mock('../db/supabaseClient', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('./lobbyManager', () => ({
  destroyLobby: jest.fn(),
}));

import { isLobbyStale, shouldSweepLobby } from './lobbyCleanup';

describe('lobbyCleanup', () => {
  const now = Date.parse('2026-06-05T12:00:00.000Z');
  const thresholdMs = 10 * 60 * 1000;

  it('treats empty lobbies as stale', () => {
    expect(isLobbyStale([], thresholdMs, now)).toBe(true);
  });

  it('treats lobbies with only inactive users as stale', () => {
    const users = [
      { last_active_at: '2026-06-05T11:40:00.000Z' },
      { last_active_at: '2026-06-05T11:30:00.000Z' },
    ];

    expect(isLobbyStale(users, thresholdMs, now)).toBe(true);
  });

  it('keeps lobbies with at least one recently active user', () => {
    const users = [
      { last_active_at: '2026-06-05T11:40:00.000Z' },
      { last_active_at: '2026-06-05T11:55:00.000Z' },
    ];

    expect(isLobbyStale(users, thresholdMs, now)).toBe(false);
  });

  it('skips lobbies with active in-memory presence', () => {
    const users = [{ last_active_at: '2026-06-05T11:00:00.000Z' }];

    expect(shouldSweepLobby('lobby-1', users, {
      staleThresholdMs: thresholdMs,
      hasActivePresence: () => true,
      nowMs: now,
    })).toBe(false);
  });

  it('sweeps stale lobbies without active presence', () => {
    const users = [{ last_active_at: '2026-06-05T11:00:00.000Z' }];

    expect(shouldSweepLobby('lobby-1', users, {
      staleThresholdMs: thresholdMs,
      hasActivePresence: () => false,
      nowMs: now,
    })).toBe(true);
  });
});
