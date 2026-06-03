import { describe, it, expect } from '@jest/globals';
import type { LobbyState } from './types';
import {
  applyPlayerDisconnected,
  applyPlayerJoined,
  applyPlayerLeft,
  applyPlayerReconnected,
} from './lobbyPlayerDeltas';

const baseState: LobbyState = {
  id: 'lobby-1',
  code: 'ABC123',
  hostId: 'host-1',
  sessionId: null,
  status: 'active',
  sessionMode: 'live',
  replaySpeed: null,
  isReplayComplete: false,
  isSimulation: false,
  players: [
    { id: 'host-1', username: 'Host', isHost: true, connected: true },
    { id: 'guest-1', username: 'Guest', isHost: false, connected: true },
  ],
  currentQuestion: null,
  latestResolution: null,
  questionCount: 0,
  leaderboard: [],
};

describe('lobbyPlayerDeltas', () => {
  it('adds a joined player', () => {
    const next = applyPlayerJoined(baseState, { userId: 'guest-2', username: 'New' });
    expect(next.players).toHaveLength(3);
    expect(next.players.find((player) => player.id === 'guest-2')?.connected).toBe(true);
  });

  it('marks an existing player connected when join event repeats', () => {
    const disconnected = applyPlayerDisconnected(baseState, { userId: 'guest-1' });
    const next = applyPlayerJoined(disconnected, { userId: 'guest-1', username: 'Guest' });
    expect(next.players.find((player) => player.id === 'guest-1')?.connected).toBe(true);
  });

  it('removes a player on leave', () => {
    const next = applyPlayerLeft(baseState, { userId: 'guest-1' });
    expect(next.players).toHaveLength(1);
  });

  it('marks disconnected and reconnected without removing the player', () => {
    const disconnected = applyPlayerDisconnected(baseState, { userId: 'guest-1' });
    expect(disconnected.players.find((player) => player.id === 'guest-1')?.connected).toBe(false);

    const reconnected = applyPlayerReconnected(disconnected, { userId: 'guest-1' });
    expect(reconnected.players.find((player) => player.id === 'guest-1')?.connected).toBe(true);
  });
});
