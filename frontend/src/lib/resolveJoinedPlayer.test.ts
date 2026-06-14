import { describe, it, expect } from '@jest/globals';
import type { LobbyState } from './types';
import { resolveJoinedPlayer } from './resolveJoinedPlayer';

const state: LobbyState = {
  id: 'lobby-1',
  code: 'ABC123',
  shareUrl: 'https://example.com/lobby/ABC123',
  hostId: 'host-1',
  sessionId: '999',
  status: 'waiting',
  sessionMode: null,
  replaySpeed: null,
  isReplayComplete: false,
  isSimulation: false,
  isPublic: true,
  players: [
    { id: 'user-1', username: 'Racer_482', isHost: true, connected: true },
  ],
  currentQuestion: null,
  latestResolution: null,
  questionCount: 0,
  minQuestions: 8,
  maxQuestions: 15,
  leaderboard: [],
};

describe('resolveJoinedPlayer', () => {
  it('finds the player by join_result userId when username was sanitized', () => {
    const player = resolveJoinedPlayer(state, {
      userId: 'user-1',
      typedUsername: 'badword',
    });
    expect(player?.username).toBe('Racer_482');
  });

  it('falls back to typed username when join_result userId is absent', () => {
    const player = resolveJoinedPlayer(state, {
      typedUsername: 'Racer_482',
    });
    expect(player?.id).toBe('user-1');
  });

  it('returns undefined when neither id nor username matches', () => {
    const player = resolveJoinedPlayer(state, {
      userId: 'missing',
      typedUsername: 'Nobody',
    });
    expect(player).toBeUndefined();
  });
});
