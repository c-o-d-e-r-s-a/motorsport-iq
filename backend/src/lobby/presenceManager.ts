export type PresenceExpiryReason = 'inactive' | 'disconnected_timeout';

export interface PresenceEntry {
  userId: string;
  lobbyId: string;
  socketId: string | null;
  connected: boolean;
  lastSeenAt: number;
  disconnectDeadline: number | null;
  expiring: boolean;
}

interface PresenceManagerOptions {
  inactivityTimeoutMs?: number;
  disconnectGraceMs?: number;
  sweepIntervalMs?: number;
  onExpire: (entry: PresenceEntry, reason: PresenceExpiryReason) => Promise<void> | void;
}

const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DISCONNECT_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 30 * 1000;

export class PresenceManager {
  private readonly entries = new Map<string, PresenceEntry>();
  private readonly socketToUser = new Map<string, string>();
  private readonly inactivityTimeoutMs: number;
  private readonly disconnectGraceMs: number;
  private readonly interval: NodeJS.Timeout;
  private readonly onExpire: PresenceManagerOptions['onExpire'];

  constructor(options: PresenceManagerOptions) {
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    this.disconnectGraceMs = options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
    this.onExpire = options.onExpire;
    this.interval = setInterval(() => {
      void this.sweep();
    }, options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
  }

  upsertConnection(params: { userId: string; lobbyId: string; socketId: string }): void {
    const now = Date.now();
    const existing = this.entries.get(params.userId);
    if (existing?.socketId && existing.socketId !== params.socketId) {
      this.socketToUser.delete(existing.socketId);
    }

    const entry: PresenceEntry = {
      userId: params.userId,
      lobbyId: params.lobbyId,
      socketId: params.socketId,
      connected: true,
      lastSeenAt: now,
      disconnectDeadline: null,
      expiring: false,
    };

    this.entries.set(params.userId, entry);
    this.socketToUser.set(params.socketId, params.userId);
  }

  markSeen(userId: string): void {
    const entry = this.entries.get(userId);
    if (!entry) return;

    entry.lastSeenAt = Date.now();
    entry.disconnectDeadline = null;
    entry.expiring = false;
  }

  markDisconnectedBySocket(socketId: string): PresenceEntry | null {
    const userId = this.socketToUser.get(socketId);
    if (!userId) return null;

    this.socketToUser.delete(socketId);
    const entry = this.entries.get(userId);
    if (!entry) return null;

    entry.connected = false;
    entry.socketId = null;
    entry.disconnectDeadline = Date.now() + this.disconnectGraceMs;
    return { ...entry };
  }

  removeUser(userId: string): void {
    const entry = this.entries.get(userId);
    if (entry?.socketId) {
      this.socketToUser.delete(entry.socketId);
    }
    this.entries.delete(userId);
  }

  getEntry(userId: string): PresenceEntry | null {
    const entry = this.entries.get(userId);
    return entry ? { ...entry } : null;
  }

  hasActivePresence(lobbyId: string): boolean {
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.lobbyId !== lobbyId || entry.expiring) {
        continue;
      }

      if (now - entry.lastSeenAt < this.inactivityTimeoutMs) {
        return true;
      }
    }

    return false;
  }

  removeLobby(lobbyId: string): void {
    for (const userId of [...this.entries.keys()]) {
      const entry = this.entries.get(userId);
      if (entry?.lobbyId === lobbyId) {
        this.removeUser(userId);
      }
    }
  }

  stop(): void {
    clearInterval(this.interval);
    this.entries.clear();
    this.socketToUser.clear();
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.expiring) {
        continue;
      }

      if (now - entry.lastSeenAt >= this.inactivityTimeoutMs) {
        entry.expiring = true;
        await this.onExpire({ ...entry }, 'inactive');
        continue;
      }

      if (!entry.connected && entry.disconnectDeadline !== null && now >= entry.disconnectDeadline) {
        // Grace elapsed without reconnect — retain entry until inactivity timeout.
        entry.disconnectDeadline = null;
        continue;
      }
    }
  }
}
