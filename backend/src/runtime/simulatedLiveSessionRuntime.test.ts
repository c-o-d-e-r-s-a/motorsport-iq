import { OpenF1Client } from '../data/openf1Client';
import { computeReplayEventDelayMs } from './sessionRuntimeBase';
import type { ReplayEvent } from './replayTimeline';

describe('computeReplayEventDelayMs', () => {
  it('schedules events at 1× using original timestamp deltas', () => {
    const current: ReplayEvent = {
      type: 'position',
      timestamp: 0,
      sequence: 0,
      data: {} as ReplayEvent['data'],
    };
    const next: ReplayEvent = {
      type: 'position',
      timestamp: 5_000,
      sequence: 1,
      data: {} as ReplayEvent['data'],
    };

    expect(computeReplayEventDelayMs(current, next, 1)).toBe(5_000);
    expect(computeReplayEventDelayMs(current, next, 10)).toBe(500);
  });

  it('never returns negative delays', () => {
    const current: ReplayEvent = {
      type: 'lap',
      timestamp: 10_000,
      sequence: 0,
      data: {} as ReplayEvent['data'],
    };
    const next: ReplayEvent = {
      type: 'lap',
      timestamp: 9_000,
      sequence: 1,
      data: {} as ReplayEvent['data'],
    };

    expect(computeReplayEventDelayMs(current, next, 1)).toBe(0);
  });
});

describe('SimulatedLiveSessionRuntime scheduling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    OpenF1Client.resetLiveLock();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('plays a mock timeline at 1× speed', async () => {
    const fetchMock = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const pathname = new URL(url).pathname;

      let payload: unknown = [];
      if (pathname.endsWith('/drivers')) {
        payload = [
          {
            driver_number: 1,
            broadcast_name: 'VER',
            full_name: 'Max Verstappen',
            name_acronym: 'VER',
            team_name: 'Red Bull',
            team_colour: '3671C6',
            first_name: 'Max',
            last_name: 'Verstappen',
            headshot_url: '',
            country_code: 'NLD',
            session_key: 99004,
            meeting_key: 99000,
          },
        ];
      } else if (pathname.endsWith('/race_control')) {
        payload = [
          {
            date: '2026-05-24T20:00:00+00:00',
            session_key: 99004,
            meeting_key: 99000,
            category: 'SessionStatus',
            flag: null,
            scope: null,
            sector: 0,
            driver_number: 0,
            message: 'SESSION STARTED',
            lap_number: 1,
          },
          {
            date: '2026-05-24T20:00:03+00:00',
            session_key: 99004,
            meeting_key: 99000,
            category: 'Flag',
            flag: 'GREEN',
            scope: 'Track',
            sector: 0,
            driver_number: 0,
            message: 'GREEN LIGHT',
            lap_number: 1,
          },
        ];
      } else if (pathname.endsWith('/position')) {
        payload = [
          {
            date: '2026-05-24T20:00:05+00:00',
            session_key: 99004,
            meeting_key: 99000,
            driver_number: 1,
            position: 1,
          },
        ];
      }

      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response;
    });

    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as typeof fetch);

    const { SessionRuntimeManager } = await import('./sessionRuntimeManager');
    const onSnapshotUpdate = jest.fn();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const manager = new SessionRuntimeManager({
      onSnapshotUpdate,
      onLapComplete: jest.fn(),
      onFeedStall: jest.fn(),
      onReplayComplete: jest.fn(),
      onError: jest.fn(),
    });

    const runtime = await manager.attachLobbyToSimulation('sim-lobby', {
      session_key: 11234,
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
    });

    expect(runtime.mode).toBe('live');
    expect(runtime.replaySpeed).toBeNull();

    const scheduledDelays = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((delay): delay is number => typeof delay === 'number');

    expect(scheduledDelays).toContain(3_000);

    await jest.advanceTimersByTimeAsync(3_000);

    const allDelays = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((delay): delay is number => typeof delay === 'number');
    expect(allDelays).toContain(2_000);

    setTimeoutSpy.mockRestore();
    runtime.stop();
  });
});
