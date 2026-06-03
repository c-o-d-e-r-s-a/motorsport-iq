import type { OpenF1Session } from '../types';
import { SCHEDULE_OVERRIDES } from './scheduleOverrides';
import {
  getActiveLivePlayableSession,
  getCachedSeasonSession,
  getCachedSeasonSessions,
} from './seasonCalendarStore';

// ─── Season schedule ─────────────────────────────────────────────────────────
//
// The full F1 season is loaded from OpenF1 `/sessions` at startup and refreshed
// every six hours (see seasonCalendarStore.ts). That cache drives live-window
// detection so we never depend on OpenF1 telemetry endpoints during a race.
//
// Add entries here only when OpenF1 times are wrong and you need an emergency
// override for a specific session.
// ─────────────────────────────────────────────────────────────────────────────

/** Canadian GP 2026 Race — default dev simulation session when telemetry exists. */
export const DEFAULT_SIMULATION_SESSION_KEY = 11291;

function normalizeLabel(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function sessionsMatch(a: OpenF1Session, b: OpenF1Session): boolean {
  if (a.session_name !== b.session_name) return false;
  if (a.date_start.substring(0, 10) !== b.date_start.substring(0, 10)) return false;
  if (a.year !== undefined && b.year !== undefined && a.year !== b.year) return false;

  const aLocation = normalizeLabel(a.location);
  const bLocation = normalizeLabel(b.location);
  const aCircuit = normalizeLabel(a.circuit_short_name);
  const bCircuit = normalizeLabel(b.circuit_short_name);

  return (
    aLocation === bLocation
    || aCircuit === bCircuit
    || aLocation.includes(bCircuit)
    || bLocation.includes(aCircuit)
  );
}

export function findMatchingOpenF1Session(
  calendarSession: OpenF1Session,
  openf1Sessions: OpenF1Session[]
): OpenF1Session | null {
  return openf1Sessions.find((session) => sessionsMatch(calendarSession, session)) ?? null;
}

export function resolveSessionForReplay(
  session: OpenF1Session,
  openf1Sessions: OpenF1Session[]
): OpenF1Session {
  return findMatchingOpenF1Session(session, openf1Sessions) ?? session;
}

function applyScheduleOverrides(sessions: OpenF1Session[]): OpenF1Session[] {
  if (SCHEDULE_OVERRIDES.length === 0) {
    return sessions.slice();
  }

  const merged = sessions.slice();
  for (const override of SCHEDULE_OVERRIDES) {
    const index = merged.findIndex((session) => sessionsMatch(session, override));
    if (index >= 0) {
      merged[index] = override;
    } else {
      merged.push(override);
    }
  }

  return merged.sort(
    (a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime()
  );
}

function pickPreferredWeekendSession(candidates: OpenF1Session[], now: number): OpenF1Session {
  const liveCandidate = candidates.find((session) => {
    const start = new Date(session.date_start).getTime();
    const end = new Date(session.date_end).getTime();
    return start <= now && now < end;
  });

  if (liveCandidate) {
    return liveCandidate;
  }

  return candidates.sort((a, b) => a.session_key - b.session_key)[0];
}

export function dedupeWeekendSessions(
  sessions: OpenF1Session[],
  now: number = Date.now()
): OpenF1Session[] {
  const buckets = new Map<string, OpenF1Session[]>();

  for (const session of sessions) {
    const dateDay = session.date_start.substring(0, 10);
    const bucketKey = `${session.session_name}_${dateDay}`;
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(session);
    buckets.set(bucketKey, bucket);
  }

  return Array.from(buckets.values()).map((candidates) => pickPreferredWeekendSession(candidates, now));
}

export function getCalendarSessions(year?: number): OpenF1Session[] {
  const cached = getCachedSeasonSessions(year);
  const filtered = year === undefined
    ? cached
    : cached.filter((session) => session.year === year);
  const merged = applyScheduleOverrides(filtered);
  return year === undefined
    ? merged
    : merged.filter((session) => session.year === year);
}

export function getCalendarSession(sessionKey: number): OpenF1Session | null {
  const override = SCHEDULE_OVERRIDES.find((session) => session.session_key === sessionKey);
  if (override) {
    return override;
  }

  return getCachedSeasonSession(sessionKey);
}

/**
 * Returns the Race/Sprint session whose start/end window contains `now`, if any.
 * Reads from the in-memory season cache so live detection never calls OpenF1
 * telemetry endpoints (they return 401 during live sessions).
 */
export function getActiveLiveCalendarSession(now: number = Date.now()): OpenF1Session | null {
  for (const override of SCHEDULE_OVERRIDES) {
    if (!['Race', 'Sprint'].includes(override.session_name)) {
      continue;
    }

    const start = new Date(override.date_start).getTime();
    const end = new Date(override.date_end).getTime();
    if (start <= now && now < end) {
      return override;
    }
  }

  return getActiveLivePlayableSession(now);
}

const CIRCUIT_RACE_LAPS: Record<string, number> = {
  montreal: 70,
  montréal: 70,
};

/** Estimated scheduled distance until LapCount arrives from the live feed. */
export function getScheduledLaps(session: OpenF1Session): number | null {
  if (session.session_name === 'Sprint') {
    return 20;
  }

  if (session.session_name === 'Race') {
    const circuit = normalizeLabel(session.circuit_short_name);
    return CIRCUIT_RACE_LAPS[circuit] ?? 57;
  }

  return null;
}

/**
 * Merge freshly fetched OpenF1 sessions with the cached season schedule.
 * Cached entries win on session_key conflict so live-weekend metadata stays
 * stable even when OpenF1 returns a stale draft of the same session.
 */
export function mergeWithCalendar(openf1Sessions: OpenF1Session[], year?: number): OpenF1Session[] {
  const calendarForYear = getCalendarSessions(year);
  if (calendarForYear.length === 0) {
    return applyScheduleOverrides(openf1Sessions).sort(
      (a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime()
    );
  }

  const calendarKeys = new Set(calendarForYear.map((session) => session.session_key));
  const merged = [
    ...calendarForYear,
    ...openf1Sessions.filter((session) => !calendarKeys.has(session.session_key)),
  ];

  return merged.sort(
    (a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime()
  );
}
