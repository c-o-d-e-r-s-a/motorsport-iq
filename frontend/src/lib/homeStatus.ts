import type { SessionInfo } from './types';

type HomeStatusKind = 'loading' | 'ready' | 'empty' | 'error';
export type HomeStatusPhase = 'live' | 'upcoming' | 'finished' | 'unknown';

export interface HomeOpenF1Status {
  kind: HomeStatusKind;
  year: number | null;
  isLive: boolean;
  phase: HomeStatusPhase;
  joinable: boolean;
  selectedSessionKey: number | null;
  trackStatusText: string;
  progressText: string;
  sessionPrimary: string;
  sessionSecondary: string;
}

// Practice sessions are intentionally excluded — they produce low-quality
// question triggers. Only Race / Sprint / Qualifying / Sprint Qualifying
// flow into the home status box.
function isJoinableSessionName(name: string): boolean {
  return name === 'Race' || name === 'Sprint';
}

function isVisibleSession(session: SessionInfo): boolean {
  const name = session.session_name;
  if (/^practice\b/i.test(name)) return false;
  return ['Race', 'Sprint', 'Sprint Qualifying', 'Qualifying'].includes(name);
}

function selectRelevantSession(sessions: SessionInfo[], now: number): SessionInfo | null {
  const visibleSessions = sessions.filter(isVisibleSession);
  if (visibleSessions.length === 0) return null;

  const liveCandidates = visibleSessions
    .filter((session) => {
      const start = new Date(session.date_start).getTime();
      const end = new Date(session.date_end).getTime();
      return start <= now && now < end;
    })
    .sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());

  if (liveCandidates.length > 0) {
    return liveCandidates[0];
  }

  // Prefer the next upcoming session within the current weekend window
  // before falling back to the most recent completed one.
  const upcomingCandidates = visibleSessions
    .filter((session) => new Date(session.date_start).getTime() > now)
    .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());

  if (upcomingCandidates.length > 0) {
    return upcomingCandidates[0];
  }

  const completedCandidates = visibleSessions
    .filter((session) => new Date(session.date_end).getTime() <= now)
    .sort((a, b) => new Date(b.date_end).getTime() - new Date(a.date_end).getTime());

  if (completedCandidates.length > 0) {
    return completedCandidates[0];
  }

  return visibleSessions.sort(
    (a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime()
  )[0];
}

function formatRelativeStart(start: number, now: number): string {
  const diffMs = start - now;
  if (diffMs <= 0) return 'Starting soon';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `Starts in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `Starts in ${hours}h ${remMinutes}m` : `Starts in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `Starts in ${days}d`;
}

export function deriveHomeOpenF1Status(input: {
  sessions: SessionInfo[];
  isLoading: boolean;
  hasError: boolean;
  year: number | null;
  now?: number;
}): HomeOpenF1Status {
  const { sessions, isLoading, hasError, year } = input;
  const now = input.now ?? Date.now();

  if (hasError) {
    return {
      kind: 'error',
      year,
      isLive: false,
      phase: 'unknown',
      joinable: false,
      selectedSessionKey: null,
      trackStatusText: 'Unavailable',
      progressText: 'Connection issue',
      sessionPrimary: 'OpenF1 status unavailable',
      sessionSecondary: 'Lobby actions still work. Retry shortly.',
    };
  }

  if (isLoading) {
    return {
      kind: 'loading',
      year,
      isLive: false,
      phase: 'unknown',
      joinable: false,
      selectedSessionKey: null,
      trackStatusText: 'Loading',
      progressText: 'Loading',
      sessionPrimary: 'Loading OpenF1 status...',
      sessionSecondary: 'Checking race, sprint, and qualifying sessions',
    };
  }

  const selected = selectRelevantSession(sessions, now);
  if (!selected) {
    const noDataYear = year ?? new Date(now).getFullYear();
    return {
      kind: 'empty',
      year: noDataYear,
      isLive: false,
      phase: 'unknown',
      joinable: false,
      selectedSessionKey: null,
      trackStatusText: 'No data',
      progressText: 'No session',
      sessionPrimary: `No race status available for ${noDataYear}`,
      sessionSecondary: 'No upcoming Race, Sprint, or Qualifying sessions found for this year.',
    };
  }

  const start = new Date(selected.date_start).getTime();
  const end = new Date(selected.date_end).getTime();
  const seasonYear = selected.year ?? year ?? new Date(now).getFullYear();

  let phase: HomeStatusPhase;
  let trackStatusText: string;
  let progressText: string;

  if (start <= now && now < end) {
    phase = 'live';
    trackStatusText = 'Live';
    progressText = 'In Progress';
  } else if (start > now) {
    phase = 'upcoming';
    trackStatusText = 'Upcoming';
    progressText = formatRelativeStart(start, now);
  } else {
    phase = 'finished';
    trackStatusText = 'Finished';
    progressText = 'Finalized';
  }

  const isLive = phase === 'live';
  // Joinable === LIVE AND a race-style session (Sprint or Race).
  const joinable = isLive && isJoinableSessionName(selected.session_name);

  return {
    kind: 'ready',
    year: seasonYear,
    isLive,
    phase,
    joinable,
    selectedSessionKey: selected.session_key,
    trackStatusText,
    progressText,
    sessionPrimary: `${selected.session_name} · ${selected.location}`,
    sessionSecondary: `${selected.circuit_short_name} · ${selected.country_name} · ${seasonYear}`,
  };
}
