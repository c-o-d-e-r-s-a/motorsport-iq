import { SessionRuntimeManager, toSessionInfo } from './sessionRuntimeManager';
import { OpenF1Client } from '../data/openf1Client';
import type { OpenF1Session } from '../types';

function createSession(overrides: Partial<OpenF1Session> = {}): OpenF1Session {
  return {
    session_key: 1001,
    meeting_key: 2001,
    location: 'Monza',
    session_type: 'Race',
    session_name: 'Race',
    date_start: '2025-09-01T13:00:00Z',
    date_end: '2025-09-01T15:00:00Z',
    country_key: 1,
    country_code: 'ITA',
    country_name: 'Italy',
    circuit_key: 1,
    circuit_short_name: 'Monza',
    year: 2025,
    ...overrides,
  };
}

describe('SessionRuntimeManager', () => {
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
          session_key: 1,
          meeting_key: 1,
        },
      ];
    }

    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as Response;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as typeof fetch);
    fetchMock.mockClear();
    OpenF1Client.resetLiveLock();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('classifies completed sessions as replay and future sessions as live', () => {
    const manager = new SessionRuntimeManager({
      onSnapshotUpdate: jest.fn(),
      onLapComplete: jest.fn(),
      onFeedStall: jest.fn(),
      onReplayComplete: jest.fn(),
      onError: jest.fn(),
    });

    expect(
      manager.getSessionMode(createSession({ date_end: '2024-09-01T15:00:00Z' }))
    ).toBe('replay');
    expect(
      manager.getSessionMode(createSession({ date_end: '2099-09-01T15:00:00Z', session_key: 1002 }))
    ).toBe('live');
  });

  it('creates isolated replay runtimes per lobby while reusing live runtimes per session', async () => {
    const manager = new SessionRuntimeManager({
      onSnapshotUpdate: jest.fn(),
      onLapComplete: jest.fn(),
      onFeedStall: jest.fn(),
      onReplayComplete: jest.fn(),
      onError: jest.fn(),
    });

    const replaySession = createSession({ date_end: '2024-09-01T15:00:00Z', session_key: 3001 });
    const replayRuntimeA = await manager.attachLobbyToSession('lobby-a', replaySession);
    const replayRuntimeB = await manager.attachLobbyToSession('lobby-b', replaySession);
    const liveRuntime = await manager.attachLobbyToSession(
      'lobby-c',
      createSession({
        date_end: '2099-09-01T15:00:00Z',
        session_key: 3002,
      })
    );
    const liveRuntimeAgain = await manager.attachLobbyToSession(
      'lobby-d',
      createSession({
        date_end: '2099-09-01T15:00:00Z',
        session_key: 3002,
      })
    );

    expect(replayRuntimeA).not.toBe(replayRuntimeB);
    expect(replayRuntimeA).not.toBe(liveRuntime);
    expect(replayRuntimeA.mode).toBe('replay');
    expect(liveRuntime.mode).toBe('live');
    expect(liveRuntime).toBe(liveRuntimeAgain);
    expect(manager.getRuntimeForLobby('lobby-a')).toBe(replayRuntimeA);
    expect(manager.getRuntimeForLobby('lobby-b')).toBe(replayRuntimeB);
    expect(manager.getRuntimeForLobby('lobby-c')).toBe(liveRuntime);
    expect(manager.getRuntime('3002')).toBe(liveRuntime);

    replayRuntimeA.stop();
    replayRuntimeB.stop();
    liveRuntime.stop();
  });

  it('removes replay runtimes when the owning lobby detaches', async () => {
    const manager = new SessionRuntimeManager({
      onSnapshotUpdate: jest.fn(),
      onLapComplete: jest.fn(),
      onFeedStall: jest.fn(),
      onReplayComplete: jest.fn(),
      onError: jest.fn(),
    });

    const replaySession = createSession({ date_end: '2024-09-01T15:00:00Z', session_key: 3004 });
    const replayRuntime = await manager.attachLobbyToSession('lobby-a', replaySession);

    manager.detachLobbyFromSession('lobby-a');

    expect(manager.getRuntimeForLobby('lobby-a')).toBeNull();

    const replayRuntimeAgain = await manager.attachLobbyToSession('lobby-a', replaySession);
    expect(replayRuntimeAgain).not.toBe(replayRuntime);

    replayRuntimeAgain.stop();
  });

  it('adds derived session info for the picker', () => {
    const completed = toSessionInfo(createSession({ date_end: '2024-09-01T15:00:00Z' }));
    expect(completed.isCompleted).toBe(true);
    expect(completed.isLive).toBe(false);
    expect(completed.mode).toBe('replay');

    const upcoming = toSessionInfo(createSession({
      date_start: '2099-01-01T15:00:00Z',
      date_end: '2099-01-01T16:00:00Z',
    }));
    expect(upcoming.isCompleted).toBe(false);
    expect(upcoming.isLive).toBe(false);
    expect(upcoming.mode).toBe('replay');
  });

  it('initializes replay runtimes with the actual race distance from lap data', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
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
            session_key: 1,
            meeting_key: 1,
          },
        ];
      }

      if (pathname.endsWith('/laps')) {
        payload = [
          {
            session_key: 1,
            meeting_key: 1,
            driver_number: 1,
            lap_number: 58,
            lap_duration: 90,
            lap_time: null,
            is_pit_out_lap: false,
            date_start: '2024-09-01T13:00:00Z',
            duration_sector_1: null,
            duration_sector_2: null,
            duration_sector_3: null,
            segments_sector_1: [],
            segments_sector_2: [],
            segments_sector_3: [],
          },
        ];
      }

      if (pathname.endsWith('/race_control')) {
        payload = [
          {
            date: '2024-09-01T13:00:00Z',
            session_key: 1,
            meeting_key: 1,
            category: 'SessionStatus',
            flag: null,
            scope: null,
            sector: 0,
            driver_number: 0,
            message: 'SESSION STARTED',
            lap_number: 1,
          },
        ];
      }

      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response;
    });

    const onSnapshotUpdate = jest.fn();
    const manager = new SessionRuntimeManager({
      onSnapshotUpdate,
      onLapComplete: jest.fn(),
      onFeedStall: jest.fn(),
      onReplayComplete: jest.fn(),
      onError: jest.fn(),
    });

    const runtime = await manager.attachLobbyToSession(
      'lobby-replay',
      createSession({ date_end: '2024-09-01T15:00:00Z', session_key: 3003 })
    );

    jest.runOnlyPendingTimers();

    const snapshot = runtime.getCurrentSnapshot();
    expect(runtime.mode).toBe('replay');
    expect(snapshot?.totalLaps).toBe(58);

    runtime.stop();
  });
});
