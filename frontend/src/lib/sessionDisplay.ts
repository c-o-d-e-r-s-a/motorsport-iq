import type { SessionInfo } from './types';

export const PRE_RACE_LOBBY_WINDOW_MS = 45 * 60 * 1000;

function isRaceOrSprint(session: SessionInfo): boolean {
  return session.session_name === 'Race' || session.session_name === 'Sprint';
}

export function isPlayableLiveSession(session: SessionInfo): boolean {
  return session.isLive && isRaceOrSprint(session);
}

export function isPreRacePlayableSession(session: SessionInfo): boolean {
  return session.isPreRace && isRaceOrSprint(session);
}

/**
 * When a Race or Sprint is live, the lobby should surface exactly one session
 * card so hosts cannot pick stale replays or other meetings mid-race.
 * During the 45-minute pre-race window, only the upcoming session is shown.
 */
export function filterSessionsForDisplay(sessions: SessionInfo[]): SessionInfo[] {
  const livePlayable = sessions.find(isPlayableLiveSession);

  if (livePlayable) {
    return [livePlayable];
  }

  const preRacePlayable = sessions.find(isPreRacePlayableSession);

  if (preRacePlayable) {
    return [preRacePlayable];
  }

  return sessions;
}

export function isLivePlayableWindow(sessions: SessionInfo[]): boolean {
  return sessions.some(isPlayableLiveSession);
}

export function isPreRacePlayableWindow(sessions: SessionInfo[]): boolean {
  return sessions.some(isPreRacePlayableSession);
}
