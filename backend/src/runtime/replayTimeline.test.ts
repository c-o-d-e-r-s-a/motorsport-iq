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
