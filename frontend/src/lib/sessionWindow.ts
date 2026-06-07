import type { SessionInfo } from './types';

/** Keep in sync with backend LIVE_RACE_OVERTIME_MS (sessionRuntimeInfo.ts). */
export const LIVE_RACE_OVERTIME_MS = 3 * 60 * 60 * 1000;

const LIVE_PLAYABLE_SESSION_NAMES = new Set(['Race', 'Sprint']);

export function getEffectiveSessionEndMs(session: Pick<SessionInfo, 'date_end' | 'session_name'>): number {
  const scheduledEnd = new Date(session.date_end).getTime();
  if (LIVE_PLAYABLE_SESSION_NAMES.has(session.session_name)) {
    return scheduledEnd + LIVE_RACE_OVERTIME_MS;
  }
  return scheduledEnd;
}

export function isSessionLive(
  session: Pick<SessionInfo, 'date_start' | 'date_end' | 'session_name'>,
  now: number = Date.now()
): boolean {
  const start = new Date(session.date_start).getTime();
  return start <= now && now < getEffectiveSessionEndMs(session);
}

export function isSessionCompleted(
  session: Pick<SessionInfo, 'date_end' | 'session_name'>,
  now: number = Date.now()
): boolean {
  return now >= getEffectiveSessionEndMs(session);
}

export function stampSessionFlags<T extends SessionInfo>(sessions: T[], now: number = Date.now()): T[] {
  return sessions.map((session) => {
    const isCompleted = isSessionCompleted(session, now);
    const isLive = isSessionLive(session, now);
    return {
      ...session,
      isCompleted,
      isLive,
      isPreRace: !isLive && !isCompleted && session.isPreRace,
      mode: isLive ? 'live' : 'replay',
    };
  });
}
