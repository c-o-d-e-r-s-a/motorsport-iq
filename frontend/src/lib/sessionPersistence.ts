export const SESSION_KEYS = {
  userId: 'msp_user_id',
  username: 'msp_username',
  lobbyCode: 'msp_lobby_code',
  lobbyStatus: 'msp_lobby_status',
  restoreUserId: 'msp_restore_user_id',
  restoreLobbyCode: 'msp_restore_lobby_code',
} as const;

export type LobbySessionStatus = 'waiting' | 'active';

export interface StoredLobbySession {
  userId: string;
  username: string | null;
  lobbyCode: string;
  lobbyStatus: LobbySessionStatus;
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem(key);
}

export function getStoredLobbySession(): StoredLobbySession | null {
  const userId = readStorage(SESSION_KEYS.userId);
  const lobbyCode = readStorage(SESSION_KEYS.lobbyCode);
  if (!userId || !lobbyCode) {
    return null;
  }

  const status = readStorage(SESSION_KEYS.lobbyStatus);
  const lobbyStatus: LobbySessionStatus = status === 'waiting' ? 'waiting' : 'active';

  return {
    userId,
    username: readStorage(SESSION_KEYS.username),
    lobbyCode,
    lobbyStatus,
  };
}

export function saveLobbySession(data: {
  userId?: string;
  username?: string;
  lobbyCode?: string;
  lobbyStatus?: LobbySessionStatus;
}): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (data.userId) {
    localStorage.setItem(SESSION_KEYS.userId, data.userId);
  }
  if (data.username) {
    localStorage.setItem(SESSION_KEYS.username, data.username);
  }
  if (data.lobbyCode) {
    localStorage.setItem(SESSION_KEYS.lobbyCode, data.lobbyCode);
  }
  if (data.lobbyStatus) {
    localStorage.setItem(SESSION_KEYS.lobbyStatus, data.lobbyStatus);
  }
}

export function clearLobbySession(): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(SESSION_KEYS.userId);
  localStorage.removeItem(SESSION_KEYS.lobbyCode);
  localStorage.removeItem(SESSION_KEYS.lobbyStatus);
}

/** Keep a stable player id on this device so score restore cannot collide by display name. */
export function stashInactiveKickRestore(userId: string, lobbyCode: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(SESSION_KEYS.restoreUserId, userId);
  localStorage.setItem(SESSION_KEYS.restoreLobbyCode, lobbyCode.toUpperCase());
}

export function getInactiveKickRestore(lobbyCode: string): string | null {
  const restoreUserId = readStorage(SESSION_KEYS.restoreUserId);
  const restoreLobbyCode = readStorage(SESSION_KEYS.restoreLobbyCode);
  if (!restoreUserId || !restoreLobbyCode) {
    return null;
  }

  if (restoreLobbyCode.toUpperCase() !== lobbyCode.toUpperCase()) {
    return null;
  }

  return restoreUserId;
}

export function clearInactiveKickRestore(): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(SESSION_KEYS.restoreUserId);
  localStorage.removeItem(SESSION_KEYS.restoreLobbyCode);
}

export function getResumePath(session: StoredLobbySession): string {
  if (session.lobbyStatus === 'waiting') {
    return `/lobby/${session.lobbyCode}`;
  }
  return `/game/${session.lobbyCode}`;
}

export function shouldAutoResumeRoute(pathname: string): boolean {
  if (!pathname || pathname === '/') {
    return true;
  }

  return pathname.startsWith('/lobby/') || pathname.startsWith('/game/');
}
