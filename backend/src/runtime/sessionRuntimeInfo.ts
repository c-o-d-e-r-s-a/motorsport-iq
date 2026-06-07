import type { OpenF1Session, SessionMode } from '../types';

export const PRE_RACE_LOBBY_WINDOW_MS = 30 * 60 * 1000;

/** Grace after scheduled date_end so red flags / delays do not flip Race/Sprint to replay early. */
export const LIVE_RACE_OVERTIME_MS = 3 * 60 * 60 * 1000;

const PLAYABLE_PRE_RACE_SESSION_NAMES = new Set(['Race', 'Sprint']);
const PLAYABLE_LIVE_SESSION_NAMES = new Set(['Race', 'Sprint']);

export function getEffectiveSessionEndMs(session: OpenF1Session): number {
  const scheduledEnd = new Date(session.date_end).getTime();
  if (PLAYABLE_LIVE_SESSION_NAMES.has(session.session_name)) {
    return scheduledEnd + LIVE_RACE_OVERTIME_MS;
  }
  return scheduledEnd;
}

export function isSessionLive(session: OpenF1Session, now: number = Date.now()): boolean {
  const start = new Date(session.date_start).getTime();
  return start <= now && now < getEffectiveSessionEndMs(session);
}

export function isSessionCompleted(session: OpenF1Session, now: number = Date.now()): boolean {
  return now >= getEffectiveSessionEndMs(session);
}

export function isWithinPreRaceLobbyWindow(session: OpenF1Session, now: number = Date.now()): boolean {
  if (!PLAYABLE_PRE_RACE_SESSION_NAMES.has(session.session_name)) {
    return false;
  }

  const start = new Date(session.date_start).getTime();
  if (now >= start) {
    return false;
  }

  return start - now <= PRE_RACE_LOBBY_WINDOW_MS;
}

export function toSessionInfo(
  session: OpenF1Session,
  now: number = Date.now()
): OpenF1Session & { isCompleted: boolean; isLive: boolean; isPreRace: boolean; mode: SessionMode } {
  const isCompleted = isSessionCompleted(session, now);
  const isLive = isSessionLive(session, now);
  const isPreRace = !isLive && !isCompleted && isWithinPreRaceLobbyWindow(session, now);
  return {
    ...session,
    isCompleted,
    isLive,
    isPreRace,
    mode: isLive ? 'live' : 'replay',
  };
}
