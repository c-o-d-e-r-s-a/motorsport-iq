import type {
  OpenF1Driver,
  OpenF1Interval,
  OpenF1Lap,
  OpenF1Position,
  OpenF1RaceControl,
  OpenF1Stint,
} from '../types';
import { SnapshotStore } from './snapshotStore';

function createDriver(overrides: Partial<OpenF1Driver> = {}): OpenF1Driver {
  return {
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
    session_key: 1001,
    meeting_key: 2001,
    ...overrides,
  };
}

function createLap(overrides: Partial<OpenF1Lap> = {}): OpenF1Lap {
  return {
    session_key: 1001,
    meeting_key: 2001,
    driver_number: 1,
    lap_number: 1,
    lap_duration: 90,
    lap_time: null,
    is_pit_out_lap: false,
    date_start: '2025-09-01T13:00:00Z',
    duration_sector_1: null,
    duration_sector_2: null,
    duration_sector_3: null,
    segments_sector_1: [],
    segments_sector_2: [],
    segments_sector_3: [],
    ...overrides,
  };
}

function createRaceControl(overrides: Partial<OpenF1RaceControl> = {}): OpenF1RaceControl {
  return {
    date: '2025-09-01T13:05:00Z',
    session_key: 1001,
    meeting_key: 2001,
    category: 'Flag',
    flag: 'YELLOW',
    scope: 'Track',
    sector: 0,
    driver_number: 0,
    message: 'YELLOW FLAG',
    lap_number: 1,
    ...overrides,
  };
}

function createPosition(overrides: Partial<OpenF1Position> = {}): OpenF1Position {
  return {
    date: '2025-09-01T13:05:00Z',
    meeting_key: 2001,
    session_key: 1001,
    driver_number: 1,
    position: 1,
    ...overrides,
  };
}

function createInterval(overrides: Partial<OpenF1Interval> = {}): OpenF1Interval {
  return {
    date: '2025-09-01T13:05:00Z',
    meeting_key: 2001,
    session_key: 1001,
    driver_number: 1,
    gap_to_leader: 0,
    interval: null,
    ...overrides,
  };
}

function createStint(overrides: Partial<OpenF1Stint> = {}): OpenF1Stint {
  return {
    date: '2025-09-01T13:05:00Z',
    session_key: 1001,
    meeting_key: 2001,
    driver_number: 1,
    stint_number: 1,
    lap_start: 1,
    lap_end: null,
    compound: 'SOFT',
    tyre_age_at_start: 0,
    ...overrides,
  };
}

describe('SnapshotStore race control updates', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rebuilds and emits the snapshot immediately when track status changes', async () => {
    const onSnapshotUpdate = jest.fn();
    const parseTrackStatus = jest.fn(() => 'YELLOW' as const);
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus,
    } as any;

    const store = new SnapshotStore(client, { onSnapshotUpdate });
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });
    store.processLapCompletion(createLap());

    onSnapshotUpdate.mockClear();
    store.processRaceControlUpdate([createRaceControl()]);

    expect(parseTrackStatus).toHaveBeenCalledWith([createRaceControl()]);
    expect(onSnapshotUpdate).toHaveBeenCalledTimes(1);
    expect(store.getCurrentSnapshot()?.trackStatus).toBe('YELLOW');
  });

  it('prefers OpenF1 full_name over broadcast_name for displayed identity', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver({ full_name: 'Max Verstappen', broadcast_name: 'VER' })]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });
    store.processPositionUpdate([createPosition({ position: 1 })]);
    store.processIntervalUpdate([createInterval()]);
    store.processStintUpdate([createStint()]);
    store.processLapCompletion(createLap());

    expect(store.getCurrentSnapshot()?.drivers[0]?.name).toBe('Max Verstappen');
    expect(store.getCurrentSnapshot()?.drivers[0]?.nameSource).toBe('full_name');
  });

  it('keeps newest telemetry records by timestamp for position, interval, and stint', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processPositionUpdate([
      createPosition({ date: '2025-09-01T13:06:00Z', position: 2 }),
      createPosition({ date: '2025-09-01T13:05:00Z', position: 5 }),
    ]);
    store.processIntervalUpdate([
      createInterval({ date: '2025-09-01T13:06:00Z', gap_to_leader: 1.2, interval: 0.8 }),
      createInterval({ date: '2025-09-01T13:05:00Z', gap_to_leader: 3.4, interval: 2.1 }),
    ]);
    store.processStintUpdate([
      createStint({ date: '2025-09-01T13:06:00Z', compound: 'MEDIUM', stint_number: 2 }),
      createStint({ date: '2025-09-01T13:05:00Z', compound: 'SOFT', stint_number: 1 }),
    ]);

    store.processLapCompletion(createLap({ lap_number: 2 }));
    const leader = store.getCurrentSnapshot()?.drivers[0];

    expect(leader?.position).toBe(2);
    expect(leader?.gap).toBe(1.2);
    expect(leader?.interval).toBe(0.8);
    expect(leader?.tyreCompound).toBe('MEDIUM');
  });

  it('selects the opening stint at race start even when future stints are already loaded', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: 19, compound: 'SOFT' }),
      createStint({ stint_number: 2, lap_start: 20, lap_end: 40, compound: 'MEDIUM' }),
    ]);
    store.processLapCompletion(createLap({ lap_number: 1, date_start: '2025-09-01T13:00:00Z' }));

    const leader = store.getCurrentSnapshot()?.drivers[0];
    expect(leader?.stintNumber).toBe(1);
    expect(leader?.tyreCompound).toBe('SOFT');
    expect(store.getCurrentSnapshot()?.leaderLapStartTime).toBe('2025-09-01T13:00:00Z');
  });

  it('switches stints only when current lap enters the next stint window', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: 19, compound: 'SOFT' }),
      createStint({ stint_number: 2, lap_start: 20, lap_end: 40, compound: 'MEDIUM' }),
    ]);

    store.processLapCompletion(createLap({ lap_number: 19 }));
    expect(store.getCurrentSnapshot()?.drivers[0]?.stintNumber).toBe(1);

    store.processLapCompletion(createLap({ lap_number: 20 }));
    expect(store.getCurrentSnapshot()?.drivers[0]?.stintNumber).toBe(2);
    expect(store.getCurrentSnapshot()?.drivers[0]?.tyreCompound).toBe('MEDIUM');
  });

  it('uses completed lap numbers in replay mode and current lap in live mode', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const replayStore = new SnapshotStore(client);
    await replayStore.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });
    replayStore.processLapCompletion(createLap({ lap_number: 14 }));
    expect(replayStore.getCurrentSnapshot()?.lapNumber).toBe(14);
    replayStore.syncLapNumber(99);
    expect(replayStore.getCurrentSnapshot()?.lapNumber).toBe(14);

    const liveStore = new SnapshotStore(client);
    await liveStore.initialize(1002, { sessionMode: 'live', skipDriverPreload: true });
    liveStore.processLapCompletion(createLap({ lap_number: 14 }));
    expect(liveStore.getCurrentSnapshot()?.lapNumber).toBe(15);
  });

  it('emits HUD snapshot updates on telemetry changes with a 1s throttle', async () => {
    const onSnapshotUpdate = jest.fn();
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client, { onSnapshotUpdate });
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });
    store.processLapCompletion(createLap());
    onSnapshotUpdate.mockClear();

    store.processPositionUpdate([createPosition({ date: '2025-09-01T13:06:00Z', position: 2 })]);
    expect(onSnapshotUpdate).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(onSnapshotUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous known leader when incoming position telemetry is 0', async () => {
    const client = {
      getDrivers: jest.fn(async () => [
        createDriver({ driver_number: 1, full_name: 'Driver One', broadcast_name: 'ONE' }),
        createDriver({ driver_number: 2, full_name: 'Driver Two', broadcast_name: 'TWO' }),
      ]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processPositionUpdate([
      createPosition({ driver_number: 1, position: 2, date: '2025-09-01T13:05:00Z' }),
      createPosition({ driver_number: 2, position: 1, date: '2025-09-01T13:05:00Z' }),
    ]);
    store.processLapCompletion(createLap({ driver_number: 1, lap_number: 1 }));

    store.processPositionUpdate([
      createPosition({ driver_number: 1, position: 0, date: '2025-09-01T13:06:00Z' }),
      createPosition({ driver_number: 2, position: 0, date: '2025-09-01T13:06:00Z' }),
    ]);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(store.getCurrentSnapshot()?.drivers[0]?.name).toBe('Driver Two');
  });
});
