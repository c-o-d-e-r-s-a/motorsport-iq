import { buildReplayTimeline, determineReplayStartTime } from './replayTimeline';

describe('replayTimeline', () => {
  it('starts replay at the first session started event instead of pre-session green flags', () => {
    const startTime = determineReplayStartTime([
      {
        date: '2024-11-03T14:50:01+00:00',
        session_key: 1,
        meeting_key: 1,
        category: 'Flag',
        flag: 'GREEN',
        scope: 'Track',
        sector: 0 as never,
        driver_number: 0 as never,
        message: 'GREEN LIGHT - PIT EXIT OPEN',
        lap_number: 1,
      },
      {
        date: '2024-11-03T15:49:57.515000+00:00',
        session_key: 1,
        meeting_key: 1,
        category: 'SessionStatus',
        flag: null as never,
        scope: null as never,
        sector: 0 as never,
        driver_number: 0 as never,
        message: 'SESSION STARTED',
        lap_number: 1,
      },
    ]);

    expect(startTime).toBe(new Date('2024-11-03T15:49:57.515000+00:00').getTime());
  });

  it('sorts equal-timestamp events by deterministic gameplay order', () => {
    const timeline = buildReplayTimeline({
      raceControl: [
        {
          date: '2024-11-03T15:50:00+00:00',
          session_key: 1,
          meeting_key: 1,
          category: 'SessionStatus',
          flag: null as never,
          scope: null as never,
          sector: 0 as never,
          driver_number: 0 as never,
          message: 'SESSION STARTED',
          lap_number: 1,
        },
        {
          date: '2024-11-03T15:50:05+00:00',
          session_key: 1,
          meeting_key: 1,
          category: 'Flag',
          flag: 'GREEN',
          scope: 'Track',
          sector: 0 as never,
          driver_number: 0 as never,
          message: 'GREEN FLAG',
          lap_number: 1,
        },
      ],
      positions: [
        {
          date: '2024-11-03T15:50:05+00:00',
          session_key: 1,
          meeting_key: 1,
          driver_number: 1,
          position: 1,
        },
      ],
      intervals: [
        {
          date: '2024-11-03T15:50:05+00:00',
          session_key: 1,
          meeting_key: 1,
          driver_number: 1,
          gap_to_leader: 0,
          interval: 0,
        },
      ],
      pits: [
        {
          date: '2024-11-03T15:50:05+00:00',
          session_key: 1,
          meeting_key: 1,
          driver_number: 1,
          pit_duration: 20,
          lap_number: 1,
          number: 1,
        },
      ],
      laps: [
        {
          session_key: 1,
          meeting_key: 1,
          driver_number: 1,
          lap_number: 1,
          lap_duration: 90,
          lap_time: null,
          is_pit_out_lap: false,
          date_start: '2024-11-03T15:48:35+00:00',
          duration_sector_1: null,
          duration_sector_2: null,
          duration_sector_3: null,
          segments_sector_1: [],
          segments_sector_2: [],
          segments_sector_3: [],
        },
      ],
    });

    expect(timeline.map((event) => event.type)).toEqual([
      'race_control',
      'race_control',
      'position',
      'interval',
      'pit',
      'lap',
    ]);
  });

  it('seeds the starting grid so a wire-to-wire leader is present from the start', () => {
    const sessionStart = '2026-06-14T13:03:27+00:00';
    const startMs = new Date(sessionStart).getTime();
    const timeline = buildReplayTimeline({
      raceControl: [
        {
          date: sessionStart,
          session_key: 1,
          meeting_key: 1,
          category: 'SessionStatus',
          flag: null as never,
          scope: null as never,
          sector: 0 as never,
          driver_number: 0 as never,
          message: 'SESSION STARTED',
          lap_number: 1,
        },
      ],
      positions: [
        // Pole sitter — only ever recorded on the grid (well before start).
        { date: '2026-06-14T12:09:53+00:00', session_key: 1, meeting_key: 1, driver_number: 63, position: 1 },
        { date: '2026-06-14T12:09:53+00:00', session_key: 1, meeting_key: 1, driver_number: 3, position: 5 },
        // Driver 3 changes position after the start; driver 63 never does.
        { date: '2026-06-14T13:05:00+00:00', session_key: 1, meeting_key: 1, driver_number: 3, position: 4 },
      ],
      intervals: [],
      pits: [],
      laps: [],
    });

    const positionEvents = timeline.filter((event) => event.type === 'position');
    const leaderSeed = positionEvents.find(
      (event) => (event.data as { driver_number: number }).driver_number === 63
    );

    expect(leaderSeed).toBeDefined();
    expect((leaderSeed!.data as { position: number }).position).toBe(1);
    expect(leaderSeed!.timestamp).toBe(startMs);
    // No pre-start (grid) event should leak through with its original timestamp.
    expect(positionEvents.every((event) => event.timestamp >= startMs)).toBe(true);
  });

  it('completes the standing-start lap 1 at lap 2 start, not the race-start instant', () => {
    const sessionStart = '2026-03-08T04:03:26+00:00';
    const lap2Start = '2026-03-08T04:05:00+00:00';
    const timeline = buildReplayTimeline({
      raceControl: [
        {
          date: sessionStart,
          session_key: 1,
          meeting_key: 1,
          category: 'SessionStatus',
          flag: null as never,
          scope: null as never,
          sector: 0 as never,
          driver_number: 0 as never,
          message: 'SESSION STARTED',
          lap_number: 1,
        },
      ],
      positions: [],
      intervals: [],
      pits: [],
      laps: [
        {
          session_key: 1,
          meeting_key: 1,
          driver_number: 63,
          lap_number: 1,
          // OpenF1 leaves lap 1 duration null for standing starts.
          lap_duration: null as never,
          lap_time: null,
          is_pit_out_lap: true,
          date_start: sessionStart,
          duration_sector_1: null,
          duration_sector_2: null,
          duration_sector_3: null,
          segments_sector_1: [],
          segments_sector_2: [],
          segments_sector_3: [],
        },
        {
          session_key: 1,
          meeting_key: 1,
          driver_number: 63,
          lap_number: 2,
          lap_duration: 84,
          lap_time: null,
          is_pit_out_lap: false,
          date_start: lap2Start,
          duration_sector_1: null,
          duration_sector_2: null,
          duration_sector_3: null,
          segments_sector_1: [],
          segments_sector_2: [],
          segments_sector_3: [],
        },
      ],
    });

    const lapOne = timeline.find(
      (event) => event.type === 'lap' && (event.data as { lap_number: number }).lap_number === 1
    );

    expect(lapOne).toBeDefined();
    // The fix: lap 1 completes when lap 2 starts, never at the race-start instant.
    expect(lapOne!.timestamp).toBe(new Date(lap2Start).getTime());
    expect(lapOne!.timestamp).not.toBe(new Date(sessionStart).getTime());
  });

  it('keeps lap events when lap_duration is zero (uses completion timestamp)', () => {
    const sessionStart = '2024-11-03T15:50:00+00:00';
    const timeline = buildReplayTimeline({
      raceControl: [
        {
          date: sessionStart,
          session_key: 1,
          meeting_key: 1,
          category: 'SessionStatus',
          flag: null as never,
          scope: null as never,
          sector: 0 as never,
          driver_number: 0 as never,
          message: 'SESSION STARTED',
          lap_number: 1,
        },
      ],
      positions: [],
      intervals: [],
      pits: [],
      laps: [
        {
          session_key: 1,
          meeting_key: 1,
          driver_number: 1,
          lap_number: 1,
          lap_duration: 0,
          lap_time: null,
          is_pit_out_lap: false,
          date_start: sessionStart,
          duration_sector_1: null,
          duration_sector_2: null,
          duration_sector_3: null,
          segments_sector_1: [],
          segments_sector_2: [],
          segments_sector_3: [],
        },
        {
          session_key: 1,
          meeting_key: 1,
          driver_number: 1,
          lap_number: 2,
          lap_duration: 90,
          lap_time: null,
          is_pit_out_lap: false,
          date_start: '2024-11-03T15:51:30+00:00',
          duration_sector_1: null,
          duration_sector_2: null,
          duration_sector_3: null,
          segments_sector_1: [],
          segments_sector_2: [],
          segments_sector_3: [],
        },
      ],
    });

    const lapEvents = timeline.filter((event) => event.type === 'lap');
    expect(lapEvents).toHaveLength(2);
    expect(lapEvents.map((event) => (event.data as { lap_number: number }).lap_number)).toEqual([1, 2]);
  });
});
