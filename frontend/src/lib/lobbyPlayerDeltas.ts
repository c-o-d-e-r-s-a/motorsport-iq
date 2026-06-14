import type { LobbyState } from './types';

export function applyPlayerJoined(
  state: LobbyState,
  data: { userId: string; username: string; joinedAtLap?: number }
): LobbyState {
  if (state.players.some((player) => player.id === data.userId)) {
    return applyPlayerReconnected(state, { userId: data.userId });
  }

  return {
    ...state,
    players: [
      ...state.players,
      { 
        id: data.userId, 
        username: data.username, 
        isHost: false, 
        connected: true,
        joinedAtLap: data.joinedAtLap,
      },
    ],
  };
}

export function applyPlayerLeft(
  state: LobbyState,
  data: { userId: string }
): LobbyState {
  return {
    ...state,
    players: state.players.filter((player) => player.id !== data.userId),
    leaderboard: state.leaderboard.filter((entry) => entry.userId !== data.userId),
  };
}

export function applyPlayerDisconnected(
  state: LobbyState,
  data: { userId: string }
): LobbyState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === data.userId ? { ...player, connected: false } : player
    ),
  };
}

export function applyPlayerReconnected(
  state: LobbyState,
  data: { userId: string }
): LobbyState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === data.userId ? { ...player, connected: true } : player
    ),
  };
}
