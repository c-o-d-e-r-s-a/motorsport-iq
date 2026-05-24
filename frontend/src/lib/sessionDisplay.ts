import type { SessionInfo } from './types';

function normalizeLabel(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function isCanadianGrandPrixSession(session: SessionInfo): boolean {
  if (session.session_name !== 'Race') return false;

  const country = normalizeLabel(session.country_name);
  const location = normalizeLabel(session.location);
  const circuit = normalizeLabel(session.circuit_short_name);

  return (
    country === 'canada'
    && (location.includes('montreal') || circuit.includes('montreal'))
  );
}

/**
 * When the Canadian Grand Prix is live, the lobby should surface exactly one
 * session card — the live race — so hosts cannot pick stale replays or other
 * meetings while the test window is open.
 */
export function filterSessionsForDisplay(sessions: SessionInfo[]): SessionInfo[] {
  const liveCanadianGp = sessions.find(
    (session) => session.isLive && isCanadianGrandPrixSession(session)
  );

  if (liveCanadianGp) {
    return [liveCanadianGp];
  }

  return sessions;
}

export function isLiveCanadianGrandPrixWindow(sessions: SessionInfo[]): boolean {
  return sessions.some(
    (session) => session.isLive && isCanadianGrandPrixSession(session)
  );
}
