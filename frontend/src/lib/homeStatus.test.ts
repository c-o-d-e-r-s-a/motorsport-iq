import { describe, it, expect } from '@jest/globals';
import { deriveHomeOpenF1Status } from './homeStatus';
import type { SessionInfo } from './types';

describe('Home Status - Calendar Integration', () => {
  const mockCanadianGPSessions: SessionInfo[] = [
    {
      session_key: 99001,
      meeting_key: 99000,
      location: 'Montréal',
      session_type: 'Qualifying',
      session_name: 'Sprint Qualifying',
      date_start: '2026-05-22T20:30:00+00:00',
      date_end: '2026-05-22T21:14:00+00:00',
      country_name: 'Canada',
      circuit_short_name: 'Montréal',
      year: 2026,
      isCompleted: false,
      isLive: false,
      isPreRace: false,
      mode: 'replay',
    },
    {
      session_key: 99002,
      meeting_key: 99000,
      location: 'Montréal',
      session_type: 'Race',
      session_name: 'Sprint',
      date_start: '2026-05-23T16:00:00+00:00',
      date_end: '2026-05-23T17:00:00+00:00',
      country_name: 'Canada',
      circuit_short_name: 'Montréal',
      year: 2026,
      isCompleted: false,
      isLive: false,
      isPreRace: false,
      mode: 'replay',
    },
    {
      session_key: 99003,
      meeting_key: 99000,
      location: 'Montréal',
      session_type: 'Qualifying',
      session_name: 'Qualifying',
      date_start: '2026-05-23T20:00:00+00:00',
      date_end: '2026-05-23T21:00:00+00:00',
      country_name: 'Canada',
      circuit_short_name: 'Montréal',
      year: 2026,
      isCompleted: false,
      isLive: false,
      isPreRace: false,
      mode: 'replay',
    },
    {
      session_key: 99004,
      meeting_key: 99000,
      location: 'Montréal',
      session_type: 'Race',
      session_name: 'Race',
      date_start: '2026-05-24T20:00:00+00:00',
      date_end: '2026-05-24T22:00:00+00:00',
      country_name: 'Canada',
      circuit_short_name: 'Montréal',
      year: 2026,
      isCompleted: false,
      isLive: false,
      isPreRace: false,
      mode: 'replay',
    },
  ];

  describe('Status phases', () => {
    it('shows upcoming status before Sprint Race', () => {
      // Friday evening, before Sprint Race (Sprint is Saturday 12:00 EDT)
      const now = new Date('2026-05-22T22:00:00Z').getTime(); // Friday 6 PM EDT
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.kind).toBe('ready');
      expect(status.phase).toBe('upcoming');
      expect(status.isLive).toBe(false);
      expect(status.joinable).toBe(false);
      expect(status.trackStatusText).toBe('Upcoming');
      expect(status.sessionPrimary).toContain('Sprint');
      expect(status.selectedSessionKey).toBe(99002);
    });

    it('shows live status during Sprint Race', () => {
      // Saturday 12:30 PM EDT = 16:30 UTC (Sprint: 16:00-17:00 UTC)
      const now = new Date('2026-05-23T16:30:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.kind).toBe('ready');
      expect(status.phase).toBe('live');
      expect(status.isLive).toBe(true);
      expect(status.joinable).toBe(true); // Sprint is joinable
      expect(status.trackStatusText).toBe('Live');
      expect(status.progressText).toBe('In Progress');
      expect(status.sessionPrimary).toContain('Sprint');
      expect(status.selectedSessionKey).toBe(99002);
    });

    it('shows live status during Grand Prix', () => {
      // Sunday 4:30 PM EDT = 20:30 UTC (Race: 20:00-22:00 UTC)
      const now = new Date('2026-05-24T20:30:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.kind).toBe('ready');
      expect(status.phase).toBe('live');
      expect(status.isLive).toBe(true);
      expect(status.joinable).toBe(true); // Race is joinable
      expect(status.trackStatusText).toBe('Live');
      expect(status.sessionPrimary).toContain('Race');
      expect(status.selectedSessionKey).toBe(99004);
    });

    it('shows finished status after all sessions complete', () => {
      // Monday after race weekend
      const now = new Date('2026-05-25T12:00:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.kind).toBe('ready');
      expect(status.phase).toBe('finished');
      expect(status.isLive).toBe(false);
      expect(status.joinable).toBe(false);
      expect(status.trackStatusText).toBe('Finished');
      expect(status.progressText).toBe('Finalized');
      expect(status.selectedSessionKey).toBe(99004); // Last session (Race)
    });
  });

  describe('Session selection priority', () => {
    it('prioritizes live session over upcoming', () => {
      // During Sprint Race, should show Sprint even though Grand Prix is upcoming
      const now = new Date('2026-05-23T16:30:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.selectedSessionKey).toBe(99002); // Sprint, not Race
      expect(status.sessionPrimary).toContain('Sprint');
    });

    it('shows next upcoming session when none are live', () => {
      // Between Sprint Race and Grand Prix
      const now = new Date('2026-05-24T12:00:00Z').getTime(); // Sunday morning
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.phase).toBe('upcoming');
      expect(status.selectedSessionKey).toBe(99004); // Grand Prix is next
      expect(status.sessionPrimary).toContain('Race');
    });

    it('shows qualifying sessions when live (for info display)', () => {
      // During Qualifying session
      const now = new Date('2026-05-23T20:30:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      // Qualifying IS shown when live (for display purposes)
      expect(status.phase).toBe('live');
      expect(status.isLive).toBe(true);
      expect(status.joinable).toBe(false); // But NOT joinable (only Race/Sprint are)
      expect(status.sessionPrimary).toContain('Qualifying');
    });
  });

  describe('Joinability rules', () => {
    it('Sprint Race is joinable when live', () => {
      const now = new Date('2026-05-23T16:30:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.isLive).toBe(true);
      expect(status.joinable).toBe(true);
      expect(status.sessionPrimary).toContain('Sprint');
    });

    it('Grand Prix is joinable when live', () => {
      const now = new Date('2026-05-24T20:30:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.isLive).toBe(true);
      expect(status.joinable).toBe(true);
      expect(status.sessionPrimary).toContain('Race');
    });

    it('upcoming sessions are not joinable', () => {
      const now = new Date('2026-05-23T15:00:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.phase).toBe('upcoming');
      expect(status.joinable).toBe(false);
    });

    it('finished sessions are not joinable', () => {
      const now = new Date('2026-05-25T12:00:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.phase).toBe('finished');
      expect(status.joinable).toBe(false);
    });
  });

  describe('Time formatting', () => {
    it('formats minutes correctly for upcoming sessions', () => {
      // 45 minutes before Sprint Race
      const now = new Date('2026-05-23T15:15:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.progressText).toMatch(/Starts in \d+m/);
    });

    it('formats hours correctly for upcoming sessions', () => {
      // 3 hours before Sprint Race
      const now = new Date('2026-05-23T13:00:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.progressText).toMatch(/Starts in \d+h/);
    });

    it('formats days correctly for upcoming sessions', () => {
      // 2 days before Sprint Race
      const now = new Date('2026-05-21T12:00:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      expect(status.progressText).toMatch(/Starts in \d+d/);
    });

    it('shows "Starting soon" when start time is very close', () => {
      // 30 seconds after scheduled start (edge case handling)
      const now = new Date('2026-05-23T16:00:30Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      // At this point, it should be marked as live since we're past start time
      expect(status.isLive).toBe(true);
    });
  });

  describe('Error and loading states', () => {
    it('shows loading state', () => {
      const status = deriveHomeOpenF1Status({
        sessions: [],
        isLoading: true,
        hasError: false,
        year: 2026,
      });

      expect(status.kind).toBe('loading');
      expect(status.isLive).toBe(false);
      expect(status.joinable).toBe(false);
      expect(status.trackStatusText).toBe('Loading');
      expect(status.sessionPrimary).toContain('Loading');
    });

    it('shows error state', () => {
      const status = deriveHomeOpenF1Status({
        sessions: [],
        isLoading: false,
        hasError: true,
        year: 2026,
      });

      expect(status.kind).toBe('error');
      expect(status.isLive).toBe(false);
      expect(status.joinable).toBe(false);
      expect(status.trackStatusText).toBe('Unavailable');
      expect(status.sessionPrimary).toContain('unavailable');
    });

    it('shows empty state when no sessions available', () => {
      const status = deriveHomeOpenF1Status({
        sessions: [],
        isLoading: false,
        hasError: false,
        year: 2026,
      });

      expect(status.kind).toBe('empty');
      expect(status.isLive).toBe(false);
      expect(status.joinable).toBe(false);
      expect(status.trackStatusText).toBe('No data');
      expect(status.sessionPrimary).toContain('No race status');
    });
  });

  describe('Real-world timing scenarios', () => {
    it('handles session transition from upcoming to live', () => {
      // 1 second before start
      const beforeStart = new Date('2026-05-23T15:59:59Z').getTime();
      const statusBefore = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now: beforeStart,
      });

      expect(statusBefore.phase).toBe('upcoming');
      expect(statusBefore.isLive).toBe(false);

      // 1 second after start
      const afterStart = new Date('2026-05-23T16:00:01Z').getTime();
      const statusAfter = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now: afterStart,
      });

      expect(statusAfter.phase).toBe('live');
      expect(statusAfter.isLive).toBe(true);
      expect(statusAfter.joinable).toBe(true);
    });

    it('handles session transition from live to finished', () => {
      // 1 second before end
      const beforeEnd = new Date('2026-05-23T16:59:59Z').getTime();
      const statusBefore = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now: beforeEnd,
      });

      expect(statusBefore.phase).toBe('live');
      expect(statusBefore.isLive).toBe(true);

      // 1 second after scheduled end — still live during overtime window
      const afterScheduledEnd = new Date('2026-05-23T17:00:01Z').getTime();
      const statusDuringOvertime = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now: afterScheduledEnd,
      });

      expect(statusDuringOvertime.phase).toBe('live');
      expect(statusDuringOvertime.isLive).toBe(true);

      // After sprint overtime and qualifying have both finished
      const afterWeekendGap = new Date('2026-05-23T21:01:00Z').getTime();
      const statusAfter = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now: afterWeekendGap,
      });

      expect(statusAfter.phase).toBe('upcoming'); // Shows next session (Grand Prix)
      expect(statusAfter.isLive).toBe(false);
      expect(statusAfter.joinable).toBe(false);
    });

    it('handles exact start time', () => {
      // Exactly at start time
      const exactStart = new Date('2026-05-23T16:00:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now: exactStart,
      });

      // start <= now < end, so should be live
      expect(status.phase).toBe('live');
      expect(status.isLive).toBe(true);
    });

    it('handles exact scheduled end time as still live during overtime', () => {
      const exactScheduledEnd = new Date('2026-05-23T17:00:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: mockCanadianGPSessions,
        isLoading: false,
        hasError: false,
        year: 2026,
        now: exactScheduledEnd,
      });

      expect(status.phase).toBe('live');
      expect(status.isLive).toBe(true);
    });
  });

  describe('Practice session filtering', () => {
    it('excludes practice sessions from display', () => {
      const sessionsWithPractice: SessionInfo[] = [
        {
          session_key: 98001,
          meeting_key: 99000,
          location: 'Montréal',
          session_type: 'Practice',
          session_name: 'Practice 1',
          date_start: '2026-05-22T14:00:00+00:00',
          date_end: '2026-05-22T15:00:00+00:00',
          country_name: 'Canada',
          circuit_short_name: 'Montréal',
          year: 2026,
          isCompleted: false,
          isLive: false,
          isPreRace: false,
          mode: 'replay',
        },
        ...mockCanadianGPSessions,
      ];

      // During Practice 1
      const now = new Date('2026-05-22T14:30:00Z').getTime();
      const status = deriveHomeOpenF1Status({
        sessions: sessionsWithPractice,
        isLoading: false,
        hasError: false,
        year: 2026,
        now,
      });

      // Should skip Practice and show upcoming Sprint
      expect(status.sessionPrimary).not.toContain('Practice');
      expect(status.sessionPrimary).toContain('Sprint');
      expect(status.phase).toBe('upcoming');
    });
  });
});
