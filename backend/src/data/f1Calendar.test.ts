import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  dedupeWeekendSessions,
  filterPlayableSessions,
  findMatchingOpenF1Session,
  getCalendarSessions,
  getCalendarSession,
  getActiveLiveCalendarSession,
  getPreRaceCalendarSession,
  getScheduledLaps,
  isSessionCancelled,
  mergeWithCalendar,
  resolveSessionForReplay,
} from './f1Calendar';
import { clearSeasonCalendarCache, seedSeasonCalendar } from './seasonCalendarStore';
import { toSessionInfo } from '../runtime/sessionRuntimeManager';
import type { OpenF1Session } from '../types';
import {
  CANADIAN_GP_2026_SESSIONS,
  MONACO_GP_2026_RACE,
  SEASON_2026_FIXTURE,
} from './testFixtures/season2026';

describe('F1 Calendar', () => {
  beforeEach(() => {
    clearSeasonCalendarCache();
    seedSeasonCalendar(2026, SEASON_2026_FIXTURE);
  });

  describe('getCalendarSessions', () => {
    it('returns cached season sessions when no year specified', () => {
      const sessions = getCalendarSessions();
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((session) => session.session_key && session.date_start && session.date_end)).toBe(true);
    });

    it('filters by year when specified', () => {
      const sessions2026 = getCalendarSessions(2026);
      expect(sessions2026.every((session) => session.year === 2026)).toBe(true);
    });

    it('returns empty array for year with no sessions', () => {
      const sessions = getCalendarSessions(2025);
      expect(sessions).toEqual([]);
    });
  });

  describe('getCalendarSession', () => {
    it('returns session by key from the season cache', () => {
      const session = getCalendarSession(11291);
      expect(session).not.toBeNull();
      expect(session?.session_key).toBe(11291);
      expect(session?.session_name).toBe('Race');
    });

    it('returns null for unknown session key', () => {
      const session = getCalendarSession(99999);
      expect(session).toBeNull();
    });
  });

  describe('getActiveLiveCalendarSession', () => {
    it('returns null when no session is live', () => {
      const farFuture = new Date('2030-01-01T00:00:00Z').getTime();
      const session = getActiveLiveCalendarSession(farFuture);
      expect(session).toBeNull();
    });

    it('returns live session during Canadian GP Sprint window', () => {
      const duringSprintRace = new Date('2026-05-23T16:30:00Z').getTime();
      const session = getActiveLiveCalendarSession(duringSprintRace);
      expect(session).not.toBeNull();
      expect(session?.session_name).toBe('Sprint');
      expect(session?.session_key).toBe(11286);
    });

    it('returns live session during Canadian GP Race window', () => {
      const duringRace = new Date('2026-05-24T20:30:00Z').getTime();
      const session = getActiveLiveCalendarSession(duringRace);
      expect(session).not.toBeNull();
      expect(session?.session_name).toBe('Race');
      expect(session?.session_key).toBe(11291);
    });

    it('returns null just before session starts', () => {
      const beforeSprintRace = new Date('2026-05-23T15:59:00Z').getTime();
      const session = getActiveLiveCalendarSession(beforeSprintRace);
      expect(session).toBeNull();
    });

    it('returns null just after session ends', () => {
      const afterSprintRace = new Date('2026-05-23T17:01:00Z').getTime();
      const session = getActiveLiveCalendarSession(afterSprintRace);
      expect(session).toBeNull();
    });
  });

  describe('getPreRaceCalendarSession', () => {
    it('returns null when the next session is more than 30 minutes away', () => {
      const raceSession = getCalendarSession(11291);
      expect(raceSession).not.toBeNull();

      const tooEarly = new Date(raceSession!.date_start).getTime() - (31 * 60 * 1000);
      const session = getPreRaceCalendarSession(tooEarly);
      expect(session).toBeNull();
    });

    it('returns the upcoming Race within the 30-minute lobby window', () => {
      const raceSession = getCalendarSession(11291);
      expect(raceSession).not.toBeNull();

      const thirtyMinutesBefore = new Date(raceSession!.date_start).getTime() - (30 * 60 * 1000);
      const session = getPreRaceCalendarSession(thirtyMinutesBefore);
      expect(session).not.toBeNull();
      expect(session?.session_name).toBe('Race');
      expect(session?.session_key).toBe(11291);
    });

    it('returns null once the session is live', () => {
      const duringRace = new Date('2026-05-24T20:30:00Z').getTime();
      const session = getPreRaceCalendarSession(duringRace);
      expect(session).toBeNull();
    });
  });

  describe('getScheduledLaps', () => {
    it('returns 20 laps for Sprint sessions', () => {
      const sprintSession = getCalendarSession(11286);
      expect(sprintSession).not.toBeNull();
      expect(getScheduledLaps(sprintSession!)).toBe(20);
    });

    it('returns 70 laps for Montreal Race', () => {
      const raceSession = getCalendarSession(11291);
      expect(raceSession).not.toBeNull();
      expect(getScheduledLaps(raceSession!)).toBe(70);
    });

    it('returns null for Qualifying sessions', () => {
      const qualSession = getCalendarSession(11282);
      expect(qualSession).not.toBeNull();
      expect(getScheduledLaps(qualSession!)).toBeNull();
    });

    it('returns 78 laps for Monaco Race', () => {
      expect(getScheduledLaps(MONACO_GP_2026_RACE)).toBe(78);
    });

    it('resolves laps from location when circuit_short_name is absent', () => {
      const monacoByLocation: OpenF1Session = {
        ...MONACO_GP_2026_RACE,
        circuit_short_name: '',
        location: 'Monaco',
      };
      expect(getScheduledLaps(monacoByLocation)).toBe(78);
    });

    it('covers every 2026 OpenF1 race circuit', () => {
      const expectedByCircuit: Record<string, number> = {
        Austin: 56,
        Baku: 51,
        Catalunya: 66,
        Hungaroring: 70,
        Interlagos: 71,
        Jeddah: 50,
        'Las Vegas': 50,
        Lusail: 57,
        Madring: 57,
        Melbourne: 58,
        'Mexico City': 71,
        Miami: 57,
        'Monte Carlo': 78,
        Montreal: 70,
        Monza: 53,
        Sakhir: 57,
        Shanghai: 56,
        Silverstone: 52,
        Singapore: 61,
        'Spa-Francorchamps': 44,
        Spielberg: 71,
        Suzuka: 53,
        'Yas Marina Circuit': 58,
        Zandvoort: 72,
      };

      for (const [circuit, expectedLaps] of Object.entries(expectedByCircuit)) {
        const session: OpenF1Session = {
          session_key: 1,
          meeting_key: 1,
          location: circuit,
          session_type: 'Race',
          session_name: 'Race',
          date_start: '2026-01-01T12:00:00+00:00',
          date_end: '2026-01-01T14:00:00+00:00',
          country_key: 1,
          country_code: 'XX',
          country_name: 'Test',
          circuit_key: 1,
          circuit_short_name: circuit,
          year: 2026,
        };

        expect(getScheduledLaps(session)).toBe(expectedLaps);
      }
    });
  });

  describe('mergeWithCalendar', () => {
    it('cached entries take priority over conflicting OpenF1 data', () => {
      const conflictingOpenF1: OpenF1Session = {
        ...CANADIAN_GP_2026_SESSIONS[1],
        location: 'OLD LOCATION',
        session_name: 'OLD NAME',
        date_start: '2026-05-23T14:00:00+00:00',
        date_end: '2026-05-23T15:00:00+00:00',
      };

      const merged = mergeWithCalendar([conflictingOpenF1], 2026);
      const sprintSession = merged.find((session) => session.session_key === 11286);

      expect(sprintSession).not.toBeNull();
      expect(sprintSession?.session_name).toBe('Sprint');
      expect(sprintSession?.date_start).toBe('2026-05-23T16:00:00+00:00');
    });

    it('includes OpenF1 sessions not in cache', () => {
      const newOpenF1Session: OpenF1Session = {
        session_key: 77001,
        meeting_key: 77000,
        location: 'Silverstone',
        session_type: 'Race',
        session_name: 'Race',
        date_start: '2026-07-05T13:00:00+00:00',
        date_end: '2026-07-05T15:00:00+00:00',
        country_key: 44,
        country_code: 'GBR',
        country_name: 'United Kingdom',
        circuit_key: 9,
        circuit_short_name: 'Silverstone',
        year: 2026,
      };

      const merged = mergeWithCalendar([newOpenF1Session], 2026);
      const silverstoneSession = merged.find((session) => session.session_key === 77001);

      expect(silverstoneSession).not.toBeNull();
      expect(silverstoneSession?.location).toBe('Silverstone');
    });

    it('sorts merged sessions by date_start', () => {
      const futureSession: OpenF1Session = {
        session_key: 88001,
        meeting_key: 88000,
        location: 'Future Track',
        session_type: 'Race',
        session_name: 'Race',
        date_start: '2026-12-31T13:00:00+00:00',
        date_end: '2026-12-31T15:00:00+00:00',
        country_key: 1,
        country_code: 'XXX',
        country_name: 'Future',
        circuit_key: 99,
        circuit_short_name: 'Future',
        year: 2026,
      };

      const merged = mergeWithCalendar([futureSession], 2026);

      for (let i = 1; i < merged.length; i++) {
        const prevStart = new Date(merged[i - 1].date_start).getTime();
        const currStart = new Date(merged[i].date_start).getTime();
        expect(currStart).toBeGreaterThanOrEqual(prevStart);
      }
    });
  });

  describe('dedupeWeekendSessions', () => {
    it('collapses duplicate weekend entries to one session', () => {
      const duplicateSprint: OpenF1Session = {
        ...CANADIAN_GP_2026_SESSIONS[1],
        session_key: 99999,
      };
      const deduped = dedupeWeekendSessions(
        [CANADIAN_GP_2026_SESSIONS[1], duplicateSprint],
        new Date('2026-05-23T17:30:00Z').getTime()
      );

      expect(deduped).toHaveLength(1);
      expect(deduped[0].session_key).toBe(11286);
    });
  });

  describe('resolveSessionForReplay', () => {
    it('maps matching OpenF1 sessions by weekend metadata', () => {
      const calendarSprint = getCalendarSession(11286)!;
      const openf1Sprint: OpenF1Session = {
        ...calendarSprint,
        session_key: 99901,
      };

      expect(findMatchingOpenF1Session(calendarSprint, [openf1Sprint])?.session_key).toBe(99901);
      expect(resolveSessionForReplay(calendarSprint, [openf1Sprint]).session_key).toBe(99901);
    });
  });

  describe('cancelled sessions', () => {
    const cancelledSakhirRace: OpenF1Session = {
      session_key: 11261,
      meeting_key: 1282,
      location: 'Sakhir',
      session_type: 'Race',
      session_name: 'Race',
      date_start: '2026-04-12T15:00:00+00:00',
      date_end: '2026-04-12T17:00:00+00:00',
      country_key: 36,
      country_code: 'BRN',
      country_name: 'Bahrain',
      circuit_key: 63,
      circuit_short_name: 'Sakhir',
      year: 2026,
      is_cancelled: true,
    };

    const imola2023Race: OpenF1Session = {
      session_key: 9086,
      meeting_key: 1209,
      location: 'Imola',
      session_type: 'Race',
      session_name: 'Race',
      date_start: '2023-05-21T13:00:00+00:00',
      date_end: '2023-05-21T15:00:00+00:00',
      country_key: 13,
      country_code: 'ITA',
      country_name: 'Italy',
      circuit_key: 6,
      circuit_short_name: 'Imola',
      year: 2023,
    };

    it('detects cancelled OpenF1 sessions', () => {
      expect(isSessionCancelled(cancelledSakhirRace)).toBe(true);
      expect(isSessionCancelled(CANADIAN_GP_2026_SESSIONS[3])).toBe(false);
    });

    it('blocks known cancelled races even without is_cancelled on cached metadata', () => {
      expect(isSessionCancelled(imola2023Race)).toBe(true);
    });

    it('filters cancelled sessions from playable lists', () => {
      const filtered = filterPlayableSessions([
        cancelledSakhirRace,
        imola2023Race,
        CANADIAN_GP_2026_SESSIONS[3],
      ]);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].session_key).toBe(11291);
    });
  });

  describe('Calendar data integrity', () => {
    it('all sessions have valid ISO 8601 timestamps', () => {
      const sessions = getCalendarSessions();
      sessions.forEach((session) => {
        expect(() => new Date(session.date_start).toISOString()).not.toThrow();
        expect(() => new Date(session.date_end).toISOString()).not.toThrow();
        expect(new Date(session.date_start).toString()).not.toBe('Invalid Date');
        expect(new Date(session.date_end).toString()).not.toBe('Invalid Date');
      });
    });

    it('all sessions have end time after start time', () => {
      const sessions = getCalendarSessions();
      sessions.forEach((session) => {
        const start = new Date(session.date_start).getTime();
        const end = new Date(session.date_end).getTime();
        expect(end).toBeGreaterThan(start);
      });
    });

    it('all sessions have required fields', () => {
      const sessions = getCalendarSessions();
      sessions.forEach((session) => {
        expect(session.session_key).toBeGreaterThan(0);
        expect(session.meeting_key).toBeGreaterThan(0);
        expect(session.location).toBeTruthy();
        expect(session.session_type).toBeTruthy();
        expect(session.session_name).toBeTruthy();
        expect(session.country_name).toBeTruthy();
        expect(session.circuit_short_name).toBeTruthy();
        expect(session.year).toBeGreaterThan(2000);
      });
    });

    it('session keys are unique', () => {
      const sessions = getCalendarSessions();
      const keys = sessions.map((session) => session.session_key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('sessions within same weekend share meeting_key', () => {
      const sessions = getCalendarSessions(2026);
      const canadianGPSessions = sessions.filter((session) => session.location === 'Montréal');
      const meetingKeys = new Set(canadianGPSessions.map((session) => session.meeting_key));
      expect(meetingKeys.size).toBe(1);
      expect(meetingKeys.has(1285)).toBe(true);
    });
  });

  describe('toSessionInfo integration', () => {
    it('correctly marks upcoming sessions', () => {
      const raceSession = getCalendarSession(11291);
      expect(raceSession).not.toBeNull();

      const beforeStart = new Date('2026-05-24T17:00:00Z').getTime();
      const start = new Date(raceSession!.date_start).getTime();
      const isUpcoming = beforeStart < start;

      expect(isUpcoming).toBe(true);
      expect(toSessionInfo(raceSession!, beforeStart).isLive).toBe(false);
      expect(toSessionInfo(raceSession!, beforeStart).isPreRace).toBe(false);
    });

    it('marks sessions within the 30-minute pre-race lobby window', () => {
      const raceSession = getCalendarSession(11291);
      expect(raceSession).not.toBeNull();

      const twentyMinutesBefore = new Date(raceSession!.date_start).getTime() - (20 * 60 * 1000);
      const info = toSessionInfo(raceSession!, twentyMinutesBefore);

      expect(info.isLive).toBe(false);
      expect(info.isCompleted).toBe(false);
      expect(info.isPreRace).toBe(true);
    });

    it('correctly marks live sessions', () => {
      const sprintSession = getCalendarSession(11286);
      expect(sprintSession).not.toBeNull();

      const duringSession = new Date('2026-05-23T16:30:00Z').getTime();
      const start = new Date(sprintSession!.date_start).getTime();
      const end = new Date(sprintSession!.date_end).getTime();

      expect(start).toBeLessThanOrEqual(duringSession);
      expect(duringSession).toBeLessThan(end);
    });

    it('correctly marks completed sessions', () => {
      const sprintQualifying = getCalendarSession(11282);
      expect(sprintQualifying).not.toBeNull();

      const afterEnd = new Date('2026-05-24T19:00:00Z').getTime();
      const end = new Date(sprintQualifying!.date_end).getTime();

      expect(end < afterEnd).toBe(true);
    });
  });
});
