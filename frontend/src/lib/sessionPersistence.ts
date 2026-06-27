export const SESSION_KEYS = {
  userId: 'msp_user_id',
  username: 'msp_username',
  lobbyCode: 'msp_lobby_code',
  lobbyStatus: 'msp_lobby_status',
  restoreUserId: 'msp_restore_user_id',
  restoreLobbyCode: 'msp_restore_lobby_code',
  submittedAnswers: 'msp_submitted_answers',
} as const;

export type StoredSubmittedAnswers = Record<string, 'YES' | 'NO'>;

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

export function getSubmittedAnswers(): StoredSubmittedAnswers {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(SESSION_KEYS.submittedAnswers);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const restored: StoredSubmittedAnswers = {};
    for (const [instanceId, answer] of Object.entries(parsed)) {
      if (answer === 'YES' || answer === 'NO') {
        restored[instanceId] = answer;
      }
    }
    return restored;
  } catch {
    return {};
  }
}

export function mergeSubmittedAnswers(answers: StoredSubmittedAnswers): void {
  if (typeof window === 'undefined' || Object.keys(answers).length === 0) {
    return;
  }

  const current = getSubmittedAnswers();
  localStorage.setItem(
    SESSION_KEYS.submittedAnswers,
    JSON.stringify({ ...current, ...answers })
  );
}

export function setSubmittedAnswer(instanceId: string, answer: 'YES' | 'NO'): void {
  mergeSubmittedAnswers({ [instanceId]: answer });
}

export function removeSubmittedAnswer(instanceId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const current = getSubmittedAnswers();
  if (!(instanceId in current)) {
    return;
  }

  const next = { ...current };
  delete next[instanceId];
  localStorage.setItem(SESSION_KEYS.submittedAnswers, JSON.stringify(next));
}

export function clearSubmittedAnswers(): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(SESSION_KEYS.submittedAnswers);
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
