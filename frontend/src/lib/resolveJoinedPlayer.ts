import type { LobbyState, PlayerState } from './types';

/**
 * Resolve the player row for the current client after join_result + lobby_state.
 * Prefers server-assigned userId (handles sanitized usernames); falls back to typed name.
 */
export function resolveJoinedPlayer(
  state: LobbyState,
  options: { userId?: string | null; typedUsername?: string | null }
): PlayerState | undefined {
  const userId = options.userId?.trim();
  if (userId) {
    const byId = state.players.find((player) => player.id === userId);
    if (byId) {
      return byId;
    }
  }

  const typedUsername = options.typedUsername?.trim();
  if (typedUsername) {
    return state.players.find((player) => player.username === typedUsername);
  }

  return undefined;
}
