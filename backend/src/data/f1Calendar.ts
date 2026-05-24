import type { OpenF1Session } from '../types';

// ─── Hardcoded F1 weekend calendar fallback ──────────────────────────────────
//
// OpenF1's /sessions endpoint can return stale or partial data while a race
// weekend is in progress, and its data endpoints are auth-gated during live
// sessions (the OPENF1_API_KEY route we deliberately don't use). The calendar
// below provides a stable list of sessions for the current weekend so the
// home page can flip UPCOMING → LIVE → FINISHED on schedule even if OpenF1
// is unreachable. Sessions exposed here also serve as `OpenF1Session` records
// for `attachLobbyToSession` (LiveSessionRuntime hits the F1 SignalR feed for
// real-time data, so the underlying `session_key` value doesn't need to map
// to OpenF1).
//
// ⚠️  Keep this short and rolling — bump it at the start of each weekend.
// ─────────────────────────────────────────────────────────────────────────────

const CANADIAN_GP_2026: OpenF1Session[] = [
  // Sprint Qualifying — Friday 22 May 2026, 16:30-17:14 EDT (UTC-4)
  {
    session_key: 99001,
    meeting_key: 99000,
    location: 'Montréal',
    session_type: 'Qualifying',
    session_name: 'Sprint Qualifying',
    date_start: '2026-05-22T20:30:00+00:00',
    date_end: '2026-05-22T21:14:00+00:00',
    country_key: 46,
    country_code: 'CAN',
    country_name: 'Canada',
    circuit_key: 23,
    circuit_short_name: 'Montréal',
    year: 2026,
  },
  // Sprint Race — Saturday 23 May 2026, 12:00-13:00 EDT (16:00-17:00 UTC)
  {
    session_key: 99002,
    meeting_key: 99000,
    location: 'Montréal',
    session_type: 'Race',
    session_name: 'Sprint',
    date_start: '2026-05-23T16:00:00+00:00',
    date_end: '2026-05-23T17:00:00+00:00',
    country_key: 46,
    country_code: 'CAN',
    country_name: 'Canada',
    circuit_key: 23,
    circuit_short_name: 'Montréal',
    year: 2026,
  },
  // Qualifying — Saturday 23 May 2026, 16:00-17:00 EDT
  {
    session_key: 99003,
    meeting_key: 99000,
    location: 'Montréal',
    session_type: 'Qualifying',
    session_name: 'Qualifying',
    date_start: '2026-05-23T20:00:00+00:00',
    date_end: '2026-05-23T21:00:00+00:00',
    country_key: 46,
    country_code: 'CAN',
    country_name: 'Canada',
    circuit_key: 23,
    circuit_short_name: 'Montréal',
    year: 2026,
  },
  // Grand Prix — Sunday 24 May 2026, 16:00-18:00 EDT (20:00-22:00 UTC)
  {
    session_key: 99004,
    meeting_key: 99000,
    location: 'Montréal',
    session_type: 'Race',
    session_name: 'Race',
    date_start: '2026-05-24T20:00:00+00:00',
    date_end: '2026-05-24T22:00:00+00:00',
    country_key: 46,
    country_code: 'CAN',
    country_name: 'Canada',
    circuit_key: 23,
    circuit_short_name: 'Montréal',
    year: 2026,
  },
];

const CALENDAR: OpenF1Session[] = [...CANADIAN_GP_2026];

/** Calendar-only keys — valid for live SignalR, not for OpenF1 replay telemetry. */
export const CALENDAR_PLACEHOLDER_SESSION_KEY_MIN = 99000;

const SESSION_LOOKUP = new Map<number, OpenF1Session>(
  CALENDAR.map((session) => [session.session_key, session])
);

export function isCalendarPlaceholderKey(sessionKey: number): boolean {
  return sessionKey >= CALENDAR_PLACEHOLDER_SESSION_KEY_MIN;
}

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

/** Swap a calendar placeholder to the real OpenF1 session_key for replay fetches. */
export function resolveSessionForReplay(
  session: OpenF1Session,
  openf1Sessions: OpenF1Session[]
): OpenF1Session {
  if (!isCalendarPlaceholderKey(session.session_key)) {
    return session;
  }

  return findMatchingOpenF1Session(session, openf1Sessions) ?? session;
}

function pickPreferredWeekendSession(candidates: OpenF1Session[], now: number): OpenF1Session {
  const placeholders = candidates.filter((session) => isCalendarPlaceholderKey(session.session_key));
  const openf1Sessions = candidates.filter((session) => !isCalendarPlaceholderKey(session.session_key));

  if (placeholders.length === 0) {
    return candidates[0];
  }

  const calendarSession = placeholders[0];
  const start = new Date(calendarSession.date_start).getTime();
  const end = new Date(calendarSession.date_end).getTime();
  const isLive = start <= now && now < end;

  // Live timing windows follow the hardcoded calendar; replays need OpenF1 keys.
  if (isLive) {
    return calendarSession;
  }

  const matched = findMatchingOpenF1Session(calendarSession, openf1Sessions);
  if (matched) {
    return matched;
  }

  return calendarSession;
}

/**
 * Collapse calendar + OpenF1 duplicates for the same weekend day. Calendar
 * metadata wins while a session is live; completed replays expose the real
 * OpenF1 session_key so telemetry fetches do not 404.
 */
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
  if (year === undefined) return CALENDAR.slice();
  return CALENDAR.filter((session) => session.year === year);
}

export function getCalendarSession(sessionKey: number): OpenF1Session | null {
  return SESSION_LOOKUP.get(sessionKey) ?? null;
}

/**
 * Returns the calendar session whose start/end window contains `now`, if any.
 * Used to short-circuit OpenF1 calls during live race weekends (OpenF1's data
 * endpoints return 401 "Live F1 session in progress" until the chequered flag).
 */
export function getActiveLiveCalendarSession(now: number = Date.now()): OpenF1Session | null {
  for (const session of CALENDAR) {
    const start = new Date(session.date_start).getTime();
    const end = new Date(session.date_end).getTime();
    if (start <= now && now < end) {
      return session;
    }
  }
  return null;
}

/** Estimated scheduled distance until LapCount arrives from the live feed. */
export function getScheduledLaps(session: OpenF1Session): number | null {
  if (session.session_name === 'Sprint') {
    return 20;
  }
  if (session.session_name === 'Race') {
    if (session.circuit_short_name === 'Montréal') {
      return 70;
    }
    return 57;
  }
  return null;
}

/**
 * Merge OpenF1 sessions with the local calendar. Calendar entries win on
 * conflict (same session_key) so live-weekend metadata stays authoritative
 * even when OpenF1 returns a stale draft of the same session.
 */
export function mergeWithCalendar(openf1Sessions: OpenF1Session[], year?: number): OpenF1Session[] {
  const calendarForYear = getCalendarSessions(year);
  const calendarKeys = new Set(calendarForYear.map((session) => session.session_key));
  const merged = [
    ...calendarForYear,
    ...openf1Sessions.filter((session) => !calendarKeys.has(session.session_key)),
  ];
  return merged.sort(
    (a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime()
  );
}
