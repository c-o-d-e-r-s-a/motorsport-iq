import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  clearSeasonCalendarCache,
  getActiveLivePlayableSession,
  getCachedSeasonSession,
  getCachedSeasonSessions,
  refreshSeasonCalendar,
  seedSeasonCalendar,
} from './seasonCalendarStore';
import { CANADIAN_GP_2026_SESSIONS, SEASON_2026_FIXTURE } from './testFixtures/season2026';

describe('seasonCalendarStore', () => {
  beforeEach(() => {
    clearSeasonCalendarCache();
  });

  it('stores and retrieves sessions by year', () => {
    seedSeasonCalendar(2026, SEASON_2026_FIXTURE);

    expect(getCachedSeasonSessions(2026)).toHaveLength(SEASON_2026_FIXTURE.length);
    expect(getCachedSeasonSession(11291)?.session_name).toBe('Race');
  });

  it('detects the active live Race/Sprint from cache', () => {
    seedSeasonCalendar(2026, SEASON_2026_FIXTURE);

    const duringRace = new Date('2026-05-24T20:30:00Z').getTime();
    const active = getActiveLivePlayableSession(duringRace);

    expect(active?.session_key).toBe(11291);
    expect(active?.session_name).toBe('Race');
  });

  it('detects Sprint windows but prefers the latest overlapping live session', () => {
    seedSeasonCalendar(2026, CANADIAN_GP_2026_SESSIONS);

    const duringSprint = new Date('2026-05-23T16:30:00Z').getTime();
    const active = getActiveLivePlayableSession(duringSprint);

    expect(active?.session_key).toBe(11286);
    expect(active?.session_name).toBe('Sprint');
  });

  it('returns null when no Race/Sprint is live', () => {
    seedSeasonCalendar(2026, SEASON_2026_FIXTURE);

    const betweenWeekends = new Date('2026-06-01T12:00:00Z').getTime();
    expect(getActiveLivePlayableSession(betweenWeekends)).toBeNull();
  });

  it('refreshes from a fetcher', async () => {
    const refreshed = await refreshSeasonCalendar(2026, async () => SEASON_2026_FIXTURE);
    expect(refreshed).toBe(true);
    expect(getCachedSeasonSessions(2026)).toHaveLength(SEASON_2026_FIXTURE.length);
  });
});
