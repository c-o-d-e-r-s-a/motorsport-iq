import { filterPlayableSessions, getCalendarSessions, isSessionCancelled } from '../data/f1Calendar';
import type { OpenF1Session } from '../types';

const REMINDER_LEAD_MS = 30 * 60 * 1000;
const SWEEP_TOLERANCE_MS = 60 * 1000;

function isGrandPrixRace(session: OpenF1Session): boolean {
  return session.session_name === 'Race' && !isSessionCancelled(session);
}

export function getUpcomingGrandPrixRaces(
  year: number,
  now: number,
  getSessions: (year: number) => OpenF1Session[] = getCalendarSessions
): OpenF1Session[] {
  return filterPlayableSessions(getSessions(year))
    .filter(isGrandPrixRace)
    .filter((session) => new Date(session.date_start).getTime() > now)
    .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
}

export function shouldSendRaceReminder(session: OpenF1Session, now: number): boolean {
  const msUntilStart = new Date(session.date_start).getTime() - now;
  return msUntilStart <= REMINDER_LEAD_MS
    && msUntilStart > REMINDER_LEAD_MS - SWEEP_TOLERANCE_MS;
}

export const RACE_REMINDER_LEAD_MS = REMINDER_LEAD_MS;
