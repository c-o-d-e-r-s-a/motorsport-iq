import supabase from '../db/supabaseClient';
import { trackDbQuery } from '../observability/dbMetrics';
import { destroyLobby } from './lobbyManager';

export interface LobbyUserActivity {
  id: string;
  last_active_at: string | null;
}

export interface StaleLobbySweepResult {
  scanned: number;
  deleted: string[];
  skippedActive: number;
}

export interface SweepStaleLobbiesOptions {
  staleThresholdMs: number;
  hasActivePresence: (lobbyId: string) => boolean;
  onDeleted?: (lobbyId: string, lobbyCode: string) => Promise<void> | void;
}

export function isLobbyStale(
  users: ReadonlyArray<Pick<LobbyUserActivity, 'last_active_at'>>,
  staleThresholdMs: number,
  nowMs = Date.now()
): boolean {
  if (users.length === 0) {
    return true;
  }

  const cutoff = nowMs - staleThresholdMs;
  return users.every((user) => {
    if (!user.last_active_at) {
      return true;
    }

    return Date.parse(user.last_active_at) < cutoff;
  });
}

export function shouldSweepLobby(
  lobbyId: string,
  users: ReadonlyArray<Pick<LobbyUserActivity, 'last_active_at'>>,
  options: {
    staleThresholdMs: number;
    hasActivePresence: (lobbyId: string) => boolean;
    nowMs?: number;
  }
): boolean {
  if (options.hasActivePresence(lobbyId)) {
    return false;
  }

  return isLobbyStale(users, options.staleThresholdMs, options.nowMs);
}

async function fetchActiveLobbyCandidates(): Promise<Array<{ id: string; code: string }>> {
  trackDbQuery('lobbies.list_active_for_cleanup');
  const { data: lobbies, error } = await supabase
    .from('lobbies')
    .select('id, code')
    .in('status', ['waiting', 'active']);

  if (error) {
    throw new Error(`Failed to list active lobbies for cleanup: ${error.message}`);
  }

  return lobbies ?? [];
}

async function fetchUsersByLobbyIds(
  lobbyIds: string[]
): Promise<Map<string, LobbyUserActivity[]>> {
  if (lobbyIds.length === 0) {
    return new Map();
  }

  trackDbQuery('users.list_by_lobby_for_cleanup');
  const { data: users, error } = await supabase
    .from('users')
    .select('id, lobby_id, last_active_at')
    .in('lobby_id', lobbyIds);

  if (error) {
    throw new Error(`Failed to list lobby users for cleanup: ${error.message}`);
  }

  const grouped = new Map<string, LobbyUserActivity[]>();
  for (const user of users ?? []) {
    if (!user.lobby_id) {
      continue;
    }

    const lobbyUsers = grouped.get(user.lobby_id) ?? [];
    lobbyUsers.push({
      id: user.id,
      last_active_at: user.last_active_at,
    });
    grouped.set(user.lobby_id, lobbyUsers);
  }

  return grouped;
}

export async function sweepStaleLobbies(
  options: SweepStaleLobbiesOptions
): Promise<StaleLobbySweepResult> {
  const lobbies = await fetchActiveLobbyCandidates();
  const usersByLobby = await fetchUsersByLobbyIds(lobbies.map((lobby) => lobby.id));

  const result: StaleLobbySweepResult = {
    scanned: lobbies.length,
    deleted: [],
    skippedActive: 0,
  };

  for (const lobby of lobbies) {
    const users = usersByLobby.get(lobby.id) ?? [];

    if (!shouldSweepLobby(lobby.id, users, options)) {
      if (options.hasActivePresence(lobby.id)) {
        result.skippedActive += 1;
      }
      continue;
    }

    const deleted = await destroyLobby(lobby.id);
    if (!deleted) {
      continue;
    }

    result.deleted.push(deleted.lobbyCode);
    await options.onDeleted?.(deleted.lobbyId, deleted.lobbyCode);
  }

  return result;
}

interface LobbyCleanupSchedulerOptions {
  staleThresholdMs: number;
  sweepIntervalMs: number;
  hasActivePresence: (lobbyId: string) => boolean;
  onDeleted: (lobbyId: string, lobbyCode: string) => Promise<void> | void;
  onSweepComplete?: (trigger: 'startup' | 'interval', result: StaleLobbySweepResult) => void;
  onSweepError?: (trigger: 'startup' | 'interval', error: unknown) => void;
}

export class LobbyCleanupScheduler {
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly options: LobbyCleanupSchedulerOptions) {}

  start(): void {
    void this.runSweep('startup');
    this.interval = setInterval(() => {
      void this.runSweep('interval');
    }, this.options.sweepIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async runSweep(trigger: 'startup' | 'interval'): Promise<void> {
    try {
      const result = await sweepStaleLobbies({
        staleThresholdMs: this.options.staleThresholdMs,
        hasActivePresence: this.options.hasActivePresence,
        onDeleted: this.options.onDeleted,
      });
      this.options.onSweepComplete?.(trigger, result);
    } catch (error) {
      this.options.onSweepError?.(trigger, error);
    }
  }
}
