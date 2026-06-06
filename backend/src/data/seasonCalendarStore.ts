import type { OpenF1Session } from '../types';

import { PRE_RACE_LOBBY_WINDOW_MS } from '../runtime/sessionRuntimeInfo';

const PLAYABLE_LIVE_SESSION_NAMES = new Set(['Race', 'Sprint']);
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface YearCache {
  sessions: OpenF1Session[];
  fetchedAt: number;
}

const cacheByYear = new Map<number, YearCache>();
let refreshTimer: NodeJS.Timeout | null = null;

export type SeasonSessionFetcher = (year: number) => Promise<OpenF1Session[] | null>;

function isPlayableLiveSession(session: OpenF1Session, now: number): boolean {
  if (!PLAYABLE_LIVE_SESSION_NAMES.has(session.session_name)) {
    return false;
  }

  const start = new Date(session.date_start).getTime();
  const end = new Date(session.date_end).getTime();
  return start <= now && now < end;
}

export function seedSeasonCalendar(year: number, sessions: OpenF1Session[]): void {
  cacheByYear.set(year, { sessions, fetchedAt: Date.now() });
}

export function clearSeasonCalendarCache(): void {
  cacheByYear.clear();
}

export function getCachedSeasonSessions(year?: number): OpenF1Session[] {
  if (year === undefined) {
    return Array.from(cacheByYear.values()).flatMap((entry) => entry.sessions);
  }

  return cacheByYear.get(year)?.sessions ?? [];
}

export function getCachedSeasonSession(sessionKey: number): OpenF1Session | null {
  for (const entry of cacheByYear.values()) {
    const match = entry.sessions.find((session) => session.session_key === sessionKey);
    if (match) {
      return match;
    }
  }

  return null;
}

export function getActiveLivePlayableSession(now: number = Date.now()): OpenF1Session | null {
  let bestMatch: OpenF1Session | null = null;

  for (const entry of cacheByYear.values()) {
    for (const session of entry.sessions) {
      if (!isPlayableLiveSession(session, now)) {
        continue;
      }

      if (
        !bestMatch
        || new Date(session.date_start).getTime() > new Date(bestMatch.date_start).getTime()
      ) {
        bestMatch = session;
      }
    }
  }

  return bestMatch;
}

function isPreRacePlayableSession(session: OpenF1Session, now: number): boolean {
  if (!PLAYABLE_LIVE_SESSION_NAMES.has(session.session_name)) {
    return false;
  }

  const start = new Date(session.date_start).getTime();
  if (now >= start) {
    return false;
  }

  return start - now <= PRE_RACE_LOBBY_WINDOW_MS;
}

export function getUpcomingPreRacePlayableSession(now: number = Date.now()): OpenF1Session | null {
  let bestMatch: OpenF1Session | null = null;

  for (const entry of cacheByYear.values()) {
    for (const session of entry.sessions) {
      if (!isPreRacePlayableSession(session, now)) {
        continue;
      }

      if (
        !bestMatch
        || new Date(session.date_start).getTime() < new Date(bestMatch.date_start).getTime()
      ) {
        bestMatch = session;
      }
    }
  }

  return bestMatch;
}

export async function refreshSeasonCalendar(
  year: number,
  fetchSessions: SeasonSessionFetcher
): Promise<boolean> {
  try {
    const sessions = await fetchSessions(year);
    if (!sessions || sessions.length === 0) {
      console.warn(`[SeasonCalendar] No sessions returned for year=${year}`);
      return false;
    }

    cacheByYear.set(year, { sessions, fetchedAt: Date.now() });
    console.log(`[SeasonCalendar] Cached ${sessions.length} sessions for year=${year}`);
    return true;
  } catch (error) {
    console.warn(`[SeasonCalendar] Failed to refresh year=${year}:`, (error as Error).message);
    return false;
  }
}

export async function ensureSeasonCalendar(
  year: number,
  fetchSessions: SeasonSessionFetcher
): Promise<void> {
  const cached = cacheByYear.get(year);
  if (cached && cached.sessions.length > 0) {
    return;
  }

  await refreshSeasonCalendar(year, fetchSessions);
}

export function startSeasonCalendarRefresh(
  fetchSessions: SeasonSessionFetcher,
  years: number[] = [new Date().getFullYear()]
): void {
  const targetYears = [...new Set(years)];

  void (async () => {
    for (const year of targetYears) {
      await refreshSeasonCalendar(year, fetchSessions);
    }
  })();

  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    for (const year of targetYears) {
      void refreshSeasonCalendar(year, fetchSessions);
    }
  }, REFRESH_INTERVAL_MS);
}

export function stopSeasonCalendarRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
