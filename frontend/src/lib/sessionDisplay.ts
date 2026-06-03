import type { SessionInfo } from './types';

export function isPlayableLiveSession(session: SessionInfo): boolean {
  return session.isLive && (session.session_name === 'Race' || session.session_name === 'Sprint');
}

/**
 * When a Race or Sprint is live, the lobby should surface exactly one session
 * card so hosts cannot pick stale replays or other meetings mid-race.
 */
export function filterSessionsForDisplay(sessions: SessionInfo[]): SessionInfo[] {
  const livePlayable = sessions.find(isPlayableLiveSession);

  if (livePlayable) {
    return [livePlayable];
  }

  return sessions;
}

export function isLivePlayableWindow(sessions: SessionInfo[]): boolean {
  return sessions.some(isPlayableLiveSession);
}
