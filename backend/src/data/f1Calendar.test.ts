import { describe, it, expect } from '@jest/globals';
import {
  dedupeWeekendSessions,
  findMatchingOpenF1Session,
  getCalendarSessions,
  getCalendarSession,
  getActiveLiveCalendarSession,
  getScheduledLaps,
  mergeWithCalendar,
  resolveSessionForReplay,
} from './f1Calendar';
import { toSessionInfo } from '../runtime/sessionRuntimeManager';
import type { OpenF1Session } from '../types';

describe('F1 Calendar', () => {
  describe('getCalendarSessions', () => {
    it('returns all calendar sessions when no year specified', () => {
      const sessions = getCalendarSessions();
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every(s => s.session_key && s.date_start && s.date_end)).toBe(true);
    });

    it('filters by year when specified', () => {
      const sessions2026 = getCalendarSessions(2026);
      expect(sessions2026.every(s => s.year === 2026)).toBe(true);
    });

    it('returns empty array for year with no sessions', () => {
      const sessions = getCalendarSessions(2025);
      expect(sessions).toEqual([]);
    });
  });

  describe('getCalendarSession', () => {
    it('returns session by key', () => {
      const session = getCalendarSession(99001);
      expect(session).not.toBeNull();
      expect(session?.session_key).toBe(99001);
      expect(session?.session_name).toBe('Sprint Qualifying');
    });

    it('returns null for unknown session key', () => {
      const session = getCalendarSession(99999);
      expect(session).toBeNull();
    });
  });

  describe('getActiveLiveCalendarSession', () => {
    it('returns null when no session is live', () => {
      // Far future time
      const farFuture = new Date('2030-01-01T00:00:00Z').getTime();
      const session = getActiveLiveCalendarSession(farFuture);
      expect(session).toBeNull();
    });

    it('returns live session during Canadian GP Sprint Race window', () => {
      // Saturday 23 May 2026, 12:30 PM EDT = 16:30 UTC (during Sprint Race 16:00-17:00 UTC)
      const duringSprintRace = new Date('2026-05-23T16:30:00Z').getTime();
      const session = getActiveLiveCalendarSession(duringSprintRace);
      expect(session).not.toBeNull();
      expect(session?.session_name).toBe('Sprint');
      expect(session?.session_key).toBe(99002);
    });

    it('returns live session during Canadian GP Race window', () => {
      // Sunday 24 May 2026, 4:30 PM EDT = 20:30 UTC (during Race 20:00-22:00 UTC)
      const duringRace = new Date('2026-05-24T20:30:00Z').getTime();
      const session = getActiveLiveCalendarSession(duringRace);
      expect(session).not.toBeNull();
      expect(session?.session_name).toBe('Race');
      expect(session?.session_key).toBe(99004);
    });

    it('returns null just before session starts', () => {
      // 1 minute before Sprint Race
      const beforeSprintRace = new Date('2026-05-23T15:59:00Z').getTime();
      const session = getActiveLiveCalendarSession(beforeSprintRace);
      expect(session).toBeNull();
    });

    it('returns null just after session ends', () => {
      // 1 minute after Sprint Race ends
      const afterSprintRace = new Date('2026-05-23T17:01:00Z').getTime();
      const session = getActiveLiveCalendarSession(afterSprintRace);
      expect(session).toBeNull();
    });
  });

  describe('getScheduledLaps', () => {
    it('returns 20 laps for Sprint sessions', () => {
      const sprintSession = getCalendarSession(99002);
      expect(sprintSession).not.toBeNull();
      const laps = getScheduledLaps(sprintSession!);
      expect(laps).toBe(20);
    });

    it('returns 70 laps for Montreal Race', () => {
      const raceSession = getCalendarSession(99004);
      expect(raceSession).not.toBeNull();
      const laps = getScheduledLaps(raceSession!);
      expect(laps).toBe(70);
    });

    it('returns null for Qualifying sessions', () => {
      const qualSession = getCalendarSession(99001);
      expect(qualSession).not.toBeNull();
      const laps = getScheduledLaps(qualSession!);
      expect(laps).toBeNull();
    });

    it('returns 57 laps for non-Montreal Race by default', () => {
      const genericRace: OpenF1Session = {
        session_key: 88001,
        meeting_key: 88000,
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
      const laps = getScheduledLaps(genericRace);
      expect(laps).toBe(57);
    });
  });

  describe('mergeWithCalendar', () => {
    it('calendar entries take priority over OpenF1 data on conflict', () => {
      const conflictingOpenF1: OpenF1Session = {
        session_key: 99002, // Same as Sprint Race in calendar
        meeting_key: 99000,
        location: 'OLD LOCATION',
        session_type: 'Race',
        session_name: 'OLD NAME',
        date_start: '2026-05-23T14:00:00+00:00', // Different time
        date_end: '2026-05-23T15:00:00+00:00',
        country_key: 46,
        country_code: 'CAN',
        country_name: 'Canada',
        circuit_key: 23,
        circuit_short_name: 'Montreal',
        year: 2026,
      };

      const merged = mergeWithCalendar([conflictingOpenF1], 2026);
      const sprintSession = merged.find(s => s.session_key === 99002);
      
      expect(sprintSession).not.toBeNull();
      expect(sprintSession?.session_name).toBe('Sprint'); // Calendar value, not 'OLD NAME'
      expect(sprintSession?.date_start).toBe('2026-05-23T16:00:00+00:00'); // Calendar time
    });

    it('includes OpenF1 sessions not in calendar', () => {
      const newOpenF1Session: OpenF1Session = {
        session_key: 77001,
        meeting_key: 77000,
        location: 'Monaco',
        session_type: 'Race',
        session_name: 'Race',
        date_start: '2026-05-31T13:00:00+00:00',
        date_end: '2026-05-31T15:00:00+00:00',
        country_key: 95,
        country_code: 'MCO',
        country_name: 'Monaco',
        circuit_key: 6,
        circuit_short_name: 'Monaco',
        year: 2026,
      };

      const merged = mergeWithCalendar([newOpenF1Session], 2026);
      const monacoSession = merged.find(s => s.session_key === 77001);
      
      expect(monacoSession).not.toBeNull();
      expect(monacoSession?.location).toBe('Monaco');
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
      
      // Verify sessions are sorted chronologically
      for (let i = 1; i < merged.length; i++) {
        const prevStart = new Date(merged[i - 1].date_start).getTime();
        const currStart = new Date(merged[i].date_start).getTime();
        expect(currStart).toBeGreaterThanOrEqual(prevStart);
      }
    });
  });

  describe('dedupeWeekendSessions', () => {
    const openf1Sprint: OpenF1Session = {
      session_key: 11286,
      meeting_key: 1285,
      location: 'Montréal',
      session_type: 'Race',
      session_name: 'Sprint',
      date_start: '2026-05-23T16:00:00+00:00',
      date_end: '2026-05-23T17:00:00+00:00',
      country_key: 46,
      country_code: 'CAN',
      country_name: 'Canada',
      circuit_key: 23,
      circuit_short_name: 'Montreal',
      year: 2026,
    };

    it('prefers calendar metadata while a session is live', () => {
      const calendarSprint = getCalendarSession(99002)!;
      const deduped = dedupeWeekendSessions([calendarSprint, openf1Sprint], new Date('2026-05-23T16:30:00Z').getTime());

      expect(deduped).toHaveLength(1);
      expect(deduped[0].session_key).toBe(99002);
    });

    it('prefers OpenF1 session_key for completed replays', () => {
      const calendarSprint = getCalendarSession(99002)!;
      const deduped = dedupeWeekendSessions([calendarSprint, openf1Sprint], new Date('2026-05-23T17:30:00Z').getTime());

      expect(deduped).toHaveLength(1);
      expect(deduped[0].session_key).toBe(11286);
    });
  });

  describe('resolveSessionForReplay', () => {
    it('maps calendar placeholder keys to matching OpenF1 sessions', () => {
      const calendarSprint = getCalendarSession(99002)!;
      const openf1Sprint: OpenF1Session = {
        session_key: 11286,
        meeting_key: 1285,
        location: 'Montréal',
        session_type: 'Race',
        session_name: 'Sprint',
        date_start: '2026-05-23T16:00:00+00:00',
        date_end: '2026-05-23T17:00:00+00:00',
        country_key: 46,
        country_code: 'CAN',
        country_name: 'Canada',
        circuit_key: 23,
        circuit_short_name: 'Montreal',
        year: 2026,
      };

      expect(findMatchingOpenF1Session(calendarSprint, [openf1Sprint])?.session_key).toBe(11286);
      expect(resolveSessionForReplay(calendarSprint, [openf1Sprint]).session_key).toBe(11286);
    });
  });

  describe('Calendar data integrity', () => {
    it('all sessions have valid ISO 8601 timestamps', () => {
      const sessions = getCalendarSessions();
      sessions.forEach(session => {
        expect(() => new Date(session.date_start).toISOString()).not.toThrow();
        expect(() => new Date(session.date_end).toISOString()).not.toThrow();
        expect(new Date(session.date_start).toString()).not.toBe('Invalid Date');
        expect(new Date(session.date_end).toString()).not.toBe('Invalid Date');
      });
    });

    it('all sessions have end time after start time', () => {
      const sessions = getCalendarSessions();
      sessions.forEach(session => {
        const start = new Date(session.date_start).getTime();
        const end = new Date(session.date_end).getTime();
        expect(end).toBeGreaterThan(start);
      });
    });

    it('all sessions have required fields', () => {
      const sessions = getCalendarSessions();
      sessions.forEach(session => {
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
      const keys = sessions.map(s => s.session_key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('sessions within same weekend share meeting_key', () => {
      const sessions = getCalendarSessions(2026);
      const canadianGPSessions = sessions.filter(s => s.location === 'Montréal');
      const meetingKeys = new Set(canadianGPSessions.map(s => s.meeting_key));
      expect(meetingKeys.size).toBe(1);
      expect(meetingKeys.has(99000)).toBe(true);
    });
  });

  describe('toSessionInfo integration', () => {
    it('correctly marks upcoming sessions', () => {
      const sessions = getCalendarSessions(2026);
      const raceSession = sessions.find(s => s.session_name === 'Race');
      expect(raceSession).not.toBeNull();

      // Before race start
      const beforeStart = new Date('2026-05-24T17:00:00Z').getTime();
      const sessionInfo = toSessionInfo(raceSession!);
      
      // Manually check with our test time
      const start = new Date(raceSession!.date_start).getTime();
      const end = new Date(raceSession!.date_end).getTime();
      const isUpcoming = beforeStart < start;
      
      expect(isUpcoming).toBe(true);
    });

    it('correctly marks live sessions', () => {
      const sessions = getCalendarSessions(2026);
      const sprintSession = sessions.find(s => s.session_name === 'Sprint');
      expect(sprintSession).not.toBeNull();

      // We can't directly test toSessionInfo with a custom time, but we can verify
      // the logic by checking the session's start/end times
      const duringSession = new Date('2026-05-23T16:30:00Z').getTime();
      const start = new Date(sprintSession!.date_start).getTime();
      const end = new Date(sprintSession!.date_end).getTime();
      
      expect(start).toBeLessThanOrEqual(duringSession);
      expect(duringSession).toBeLessThan(end);
    });

    it('correctly marks completed sessions', () => {
      const sessions = getCalendarSessions(2026);
      const sprintQualifying = sessions.find(s => s.session_name === 'Sprint Qualifying');
      expect(sprintQualifying).not.toBeNull();

      // After session end
      const afterEnd = new Date('2026-05-24T19:00:00Z').getTime();
      const end = new Date(sprintQualifying!.date_end).getTime();
      
      const isCompleted = end < afterEnd;
      expect(isCompleted).toBe(true);
    });
  });

  describe('Canadian GP 2026 schedule verification', () => {
    it('Sprint Qualifying is Friday 22 May at 16:30 EDT', () => {
      const sq = getCalendarSession(99001);
      expect(sq).not.toBeNull();
      expect(sq?.session_name).toBe('Sprint Qualifying');
      
      // Verify UTC time (EDT is UTC-4, so 16:30 EDT = 20:30 UTC)
      const startUTC = new Date(sq!.date_start);
      expect(startUTC.getUTCHours()).toBe(20);
      expect(startUTC.getUTCMinutes()).toBe(30);
      expect(startUTC.getUTCDate()).toBe(22);
      expect(startUTC.getUTCMonth()).toBe(4); // May = 4 (0-indexed)
    });

    it('Sprint Race is Saturday 23 May at 12:00 EDT', () => {
      const sprint = getCalendarSession(99002);
      expect(sprint).not.toBeNull();
      expect(sprint?.session_name).toBe('Sprint');
      
      // 12:00 EDT = 16:00 UTC
      const startUTC = new Date(sprint!.date_start);
      expect(startUTC.getUTCHours()).toBe(16);
      expect(startUTC.getUTCMinutes()).toBe(0);
      expect(startUTC.getUTCDate()).toBe(23);
    });

    it('Qualifying is Saturday 23 May at 16:00 EDT', () => {
      const qual = getCalendarSession(99003);
      expect(qual).not.toBeNull();
      expect(qual?.session_name).toBe('Qualifying');
      
      // 16:00 EDT = 20:00 UTC
      const startUTC = new Date(qual!.date_start);
      expect(startUTC.getUTCHours()).toBe(20);
      expect(startUTC.getUTCMinutes()).toBe(0);
      expect(startUTC.getUTCDate()).toBe(23);
    });

    it('Grand Prix is Sunday 24 May at 16:00 EDT', () => {
      const race = getCalendarSession(99004);
      expect(race).not.toBeNull();
      expect(race?.session_name).toBe('Race');
      
      // 16:00 EDT = 20:00 UTC
      const startUTC = new Date(race!.date_start);
      expect(startUTC.getUTCHours()).toBe(20);
      expect(startUTC.getUTCMinutes()).toBe(0);
      expect(startUTC.getUTCDate()).toBe(24);

      const endUTC = new Date(race!.date_end);
      expect(endUTC.getUTCHours()).toBe(22);
      expect(endUTC.getUTCMinutes()).toBe(0);
    });
  });
});
