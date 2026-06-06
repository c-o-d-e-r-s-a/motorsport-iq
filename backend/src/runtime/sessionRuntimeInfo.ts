import type { OpenF1Session, SessionMode } from '../types';

export const PRE_RACE_LOBBY_WINDOW_MS = 30 * 60 * 1000;

const PLAYABLE_PRE_RACE_SESSION_NAMES = new Set(['Race', 'Sprint']);

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
  const start = new Date(session.date_start).getTime();
  const end = new Date(session.date_end).getTime();
  const isCompleted = end < now;
  const isLive = start <= now && now < end;
  const isPreRace = !isLive && !isCompleted && isWithinPreRaceLobbyWindow(session, now);
  return {
    ...session,
    isCompleted,
    isLive,
    isPreRace,
    mode: isLive ? 'live' : 'replay',
  };
}
